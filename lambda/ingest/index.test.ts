/**
 * Unit tests for main lambda handler
 */

import { S3Event } from "aws-lambda";
import { handler, runLocal } from "./index";

// Mock all dependencies
jest.mock("./config");
jest.mock("./cache");
jest.mock("./entities");
jest.mock("./file-input-handlers");
jest.mock("./error-reporter");
jest.mock("./processing-pipeline");
jest.mock("axios");

// Mock S3 event for testing
const mockS3Event: S3Event = {
  Records: [
    {
      eventVersion: "2.1",
      eventSource: "aws:s3",
      awsRegion: "us-east-1",
      eventTime: "2023-01-01T00:00:00.000Z",
      eventName: "ObjectCreated:Put",
      userIdentity: { principalId: "test" },
      requestParameters: { sourceIPAddress: "127.0.0.1" },
      responseElements: {
        "x-amz-request-id": "test",
        "x-amz-id-2": "test"
      },
      s3: {
        s3SchemaVersion: "1.0",
        configurationId: "test",
        bucket: {
          name: "test-bucket",
          ownerIdentity: { principalId: "test" },
          arn: "arn:aws:s3:::test-bucket"
        },
        object: {
          key: "test.csv",
          size: 1024,
          eTag: "test",
          sequencer: "test"
        }
      }
    }
  ]
};

describe("Lambda Handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset environment variables
    delete process.env.STRAPI_BASE_URL;
    delete process.env.STRAPI_TOKEN;
  });

  describe("handler", () => {
    it("should handle S3 events successfully", async () => {
      // Mock successful configuration and processing
      const { loadEnvironmentConfig, validateConfiguration } = require("./config");
      const { createFileInputHandler } = require("./file-input-handlers");
      const { createErrorReporter } = require("./error-reporter");
      
      loadEnvironmentConfig.mockReturnValue({
        strapiBaseUrl: "https://api.example.com",
        strapiToken: "test-token",
        processMode: "parallel",
        omitGet: false,
        batchSize: 100,
        chunkSize: 150
      });
      
      validateConfiguration.mockReturnValue({ isValid: true, errors: [], warnings: [] });
      
      const mockFileHandler = {
        getParticipationsCsv: jest.fn().mockResolvedValue(null),
        getCctsCsv: jest.fn().mockResolvedValue(null),
        getExecutionMode: jest.fn().mockReturnValue("aws")
      };
      createFileInputHandler.mockReturnValue(mockFileHandler);
      
      const mockErrorReporter = {
        logError: jest.fn(),
        getErrorCount: jest.fn().mockReturnValue(0),
        saveErrorReport: jest.fn().mockResolvedValue("")
      };
      createErrorReporter.mockReturnValue(mockErrorReporter);

      // Mock processing pipeline
      const { CsvAnalysisPhase, EntityCreationPhase, BatchProcessingPhase } = require("./processing-pipeline");
      
      const mockAnalysisPhase = {
        analyzeCsv: jest.fn().mockResolvedValue({
          records: [],
          uniqueSets: {
            programas: new Set(),
            implementaciones: new Map(),
            ccts: new Set(),
            asistenciaFields: new Set(),
            asistenciaModalities: new Map(),
            trabajoFields: new Set()
          },
          stats: { recordsProcessed: 0 }
        })
      };
      CsvAnalysisPhase.mockImplementation(() => mockAnalysisPhase);
      
      const mockCreationPhase = {
        executeCreationPhase: jest.fn().mockResolvedValue(undefined)
      };
      EntityCreationPhase.mockImplementation(() => mockCreationPhase);
      
      const mockBatchPhase = {
        executeBatchProcessing: jest.fn().mockResolvedValue({
          totalRecords: 0,
          successCount: 0,
          errorCount: 0
        })
      };
      BatchProcessingPhase.mockImplementation(() => mockBatchPhase);

      const mockContext = {} as any;
      const mockCallback = jest.fn();
      await expect(handler(mockS3Event, mockContext, mockCallback)).resolves.not.toThrow();
    });

    it("should handle configuration validation errors", async () => {
      const { loadEnvironmentConfig, validateConfiguration } = require("./config");
      
      loadEnvironmentConfig.mockReturnValue({
        strapiBaseUrl: "",
        strapiToken: "",
        processMode: "parallel",
        omitGet: false,
        batchSize: 100,
        chunkSize: 150
      });
      
      validateConfiguration.mockReturnValue({
        isValid: false,
        errors: ["STRAPI_BASE_URL is required"],
        warnings: []
      });

      const mockContext = {} as any;
      const mockCallback = jest.fn();
      await expect(handler(mockS3Event, mockContext, mockCallback)).rejects.toThrow("Configuration validation failed");
    });

    it("should handle processing errors gracefully", async () => {
      const { loadEnvironmentConfig, validateConfiguration } = require("./config");
      const { createFileInputHandler } = require("./file-input-handlers");
      
      loadEnvironmentConfig.mockReturnValue({
        strapiBaseUrl: "https://api.example.com",
        strapiToken: "test-token",
        processMode: "parallel",
        omitGet: false,
        batchSize: 100,
        chunkSize: 150
      });
      
      validateConfiguration.mockReturnValue({ isValid: true, errors: [], warnings: [] });
      
      // Mock file handler that throws an error
      createFileInputHandler.mockImplementation(() => {
        throw new Error("File handler creation failed");
      });

      const mockContext = {} as any;
      const mockCallback = jest.fn();
      await expect(handler(mockS3Event, mockContext, mockCallback)).rejects.toThrow("File handler creation failed");
    });
  });

  describe("runLocal", () => {
    it("should run local migration successfully", async () => {
      const { loadEnvironmentConfig, validateConfiguration } = require("./config");
      const { createFileInputHandler } = require("./file-input-handlers");
      const { createErrorReporter } = require("./error-reporter");
      
      loadEnvironmentConfig.mockReturnValue({
        strapiBaseUrl: "https://api.example.com",
        strapiToken: "test-token",
        processMode: "parallel",
        omitGet: false,
        batchSize: 100,
        chunkSize: 150
      });
      
      validateConfiguration.mockReturnValue({ isValid: true, errors: [], warnings: [] });
      
      const mockFileHandler = {
        getParticipationsCsv: jest.fn().mockResolvedValue(null),
        getCctsCsv: jest.fn().mockResolvedValue(null),
        getExecutionMode: jest.fn().mockReturnValue("local")
      };
      createFileInputHandler.mockReturnValue(mockFileHandler);
      
      const mockErrorReporter = {
        logError: jest.fn(),
        getErrorCount: jest.fn().mockReturnValue(0),
        saveErrorReport: jest.fn().mockResolvedValue("")
      };
      createErrorReporter.mockReturnValue(mockErrorReporter);

      // Mock processing pipeline
      const { CsvAnalysisPhase, EntityCreationPhase, BatchProcessingPhase } = require("./processing-pipeline");
      
      const mockAnalysisPhase = {
        analyzeCsv: jest.fn().mockResolvedValue({
          records: [],
          uniqueSets: {
            programas: new Set(),
            implementaciones: new Map(),
            ccts: new Set(),
            asistenciaFields: new Set(),
            asistenciaModalities: new Map(),
            trabajoFields: new Set()
          },
          stats: { recordsProcessed: 0 }
        })
      };
      CsvAnalysisPhase.mockImplementation(() => mockAnalysisPhase);
      
      const mockCreationPhase = {
        executeCreationPhase: jest.fn().mockResolvedValue(undefined)
      };
      EntityCreationPhase.mockImplementation(() => mockCreationPhase);
      
      const mockBatchPhase = {
        executeBatchProcessing: jest.fn().mockResolvedValue({
          totalRecords: 0,
          successCount: 0,
          errorCount: 0
        })
      };
      BatchProcessingPhase.mockImplementation(() => mockBatchPhase);

      await expect(runLocal("test.csv")).resolves.not.toThrow();
    });

    it("should handle local migration errors", async () => {
      const { loadEnvironmentConfig, validateConfiguration } = require("./config");
      
      loadEnvironmentConfig.mockReturnValue({
        strapiBaseUrl: "",
        strapiToken: "",
        processMode: "parallel",
        omitGet: false,
        batchSize: 100,
        chunkSize: 150
      });
      
      validateConfiguration.mockReturnValue({
        isValid: false,
        errors: ["STRAPI_BASE_URL is required"],
        warnings: []
      });

      await expect(runLocal("test.csv")).rejects.toThrow("Configuration validation failed");
    });
  });
});