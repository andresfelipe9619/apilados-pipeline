/**
 * Unit tests for LocalTestRunner implementation
 */

import { createLocalTestRunner } from "lambda/ingest/__tests__/unit/local-test-runner";
import { LocalTestRunner } from "../../types";
import { LocalConfig, ProcessingConfig } from "../../types";

// Mock dependencies
jest.mock("../../config");
jest.mock("../../cache");
jest.mock("../../entities");
jest.mock("../../file-input-handlers");
jest.mock("../../error-reporter");
jest.mock("../../processing-pipeline");
jest.mock("axios");
jest.mock("node:fs", () => ({
  existsSync: jest.fn(),
}));

describe("LocalTestRunner", () => {
  let testRunner: LocalTestRunner;
  const mockLocalConfig: LocalConfig = {
    participationsCsvPath: "test-data/sample.csv",
    cctsCsvPath: "test-data/ccts.csv",
  };

  beforeEach(() => {
    testRunner = createLocalTestRunner();
    jest.clearAllMocks();
  });

  describe("runWithCsv", () => {
    it("should run migration with CSV file successfully", async () => {
      // Mock successful configuration
      const {
        loadEnvironmentConfig,
        validateConfiguration,
      } = require("../../config");

      loadEnvironmentConfig.mockReturnValue({
        strapiBaseUrl: "https://api.example.com",
        strapiToken: "test-token",
        processMode: "parallel",
        omitGet: false,
        batchSize: 100,
        chunkSize: 150,
      });

      validateConfiguration.mockReturnValue({
        isValid: true,
        errors: [],
        warnings: [],
      });

      // Mock file existence
      const { existsSync } = require("node:fs");
      existsSync.mockReturnValue(true);

      // Mock file input handler
      const { LocalFileInputHandler } = require("../../file-input-handlers");
      const mockFileHandler = {
        getParticipationsCsv: jest.fn().mockResolvedValue(null),
        getCctsCsv: jest.fn().mockResolvedValue(null),
        getExecutionMode: jest.fn().mockReturnValue("local"),
      };
      LocalFileInputHandler.mockImplementation(() => mockFileHandler);

      // Mock error reporter
      const { createErrorReporter } = require("../../error-reporter");
      const mockErrorReporter = {
        logError: jest.fn(),
        getErrorCount: jest.fn().mockReturnValue(0),
        saveErrorReport: jest.fn().mockResolvedValue(""),
      };
      createErrorReporter.mockReturnValue(mockErrorReporter);

      // Mock processing pipeline
      const {
        CsvAnalysisPhase,
        EntityCreationPhase,
        BatchProcessingPhase,
      } = require("../../processing-pipeline");

      const mockAnalysisPhase = {
        analyzeCsv: jest.fn().mockResolvedValue({
          records: [],
          uniqueSets: {
            programas: new Set(),
            implementaciones: new Map(),
            ccts: new Set(),
            asistenciaFields: new Set(),
            asistenciaModalities: new Map(),
            trabajoFields: new Set(),
          },
          stats: { recordsProcessed: 0 },
        }),
      };
      CsvAnalysisPhase.mockImplementation(() => mockAnalysisPhase);

      const mockCreationPhase = {
        executeCreationPhase: jest.fn().mockResolvedValue(undefined),
      };
      EntityCreationPhase.mockImplementation(() => mockCreationPhase);

      const mockBatchPhase = {
        executeBatchProcessing: jest.fn().mockResolvedValue({
          totalRecords: 0,
          successCount: 0,
          errorCount: 0,
        }),
      };
      BatchProcessingPhase.mockImplementation(() => mockBatchPhase);

      const result = await testRunner.runWithCsv("test.csv");

      expect(result).toEqual({
        totalRecords: 0,
        successCount: 0,
        errorCount: 0,
        processingTime: expect.any(Number),
      });
    });

    it("should handle missing CSV file", async () => {
      const { existsSync } = require("node:fs");
      existsSync.mockReturnValue(false);

      await expect(testRunner.runWithCsv("nonexistent.csv")).rejects.toThrow(
        "CSV file not found: nonexistent.csv",
      );
    });

    it("should handle configuration validation errors", async () => {
      const { existsSync } = require("node:fs");
      existsSync.mockReturnValue(true);

      const {
        loadEnvironmentConfig,
        validateConfiguration,
      } = require("../../config");

      loadEnvironmentConfig.mockReturnValue({
        strapiBaseUrl: "",
        strapiToken: "",
        processMode: "parallel",
        omitGet: false,
        batchSize: 100,
        chunkSize: 150,
      });

      validateConfiguration.mockReturnValue({
        isValid: false,
        errors: ["STRAPI_BASE_URL is required"],
        warnings: [],
      });

      await expect(testRunner.runWithCsv("test.csv")).rejects.toThrow(
        "Configuration validation failed",
      );
    });
  });

  describe("validateEnvironment", () => {
    it("should return true for valid environment", () => {
      const {
        loadEnvironmentConfig,
        validateConfiguration,
      } = require("../../config");

      loadEnvironmentConfig.mockReturnValue({
        strapiBaseUrl: "https://api.example.com",
        strapiToken: "test-token",
        processMode: "parallel",
        omitGet: false,
        batchSize: 100,
        chunkSize: 150,
      });

      validateConfiguration.mockReturnValue({
        isValid: true,
        errors: [],
        warnings: [],
      });

      const result = testRunner.validateEnvironment();

      expect(result).toBe(true);
    });

    it("should return false for invalid environment", () => {
      const {
        loadEnvironmentConfig,
        validateConfiguration,
      } = require("../../config");

      loadEnvironmentConfig.mockReturnValue({
        strapiBaseUrl: "",
        strapiToken: "",
        processMode: "parallel",
        omitGet: false,
        batchSize: 100,
        chunkSize: 150,
      });

      validateConfiguration.mockReturnValue({
        isValid: false,
        errors: ["STRAPI_BASE_URL is required"],
        warnings: [],
      });

      const result = testRunner.validateEnvironment();

      expect(result).toBe(false);
    });
  });

  describe("generateTestReport", () => {
    it("should generate test report with environment info", () => {
      const { loadEnvironmentConfig } = require("../../config");

      loadEnvironmentConfig.mockReturnValue({
        strapiBaseUrl: "https://api.example.com",
        strapiToken: "test-token",
        processMode: "parallel",
        omitGet: false,
        batchSize: 100,
        chunkSize: 150,
      });

      const result = testRunner.generateTestReport();

      expect(result).toEqual({
        timestamp: expect.any(String),
        environment: {
          strapiBaseUrl: "https://api.example.com",
          strapiToken: "test-token",
          processMode: "parallel",
          omitGet: false,
          batchSize: 100,
          chunkSize: 150,
        },
        systemInfo: {
          nodeVersion: expect.any(String),
          platform: expect.any(String),
          arch: expect.any(String),
          memory: expect.any(Object),
        },
      });
    });
  });
});
