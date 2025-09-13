/**
 * Tests for configuration management and execution mode detection
 */

import { 
  detectExecutionMode, 
  loadEnvironmentConfig, 
  createProcessingConfig,
  validateConfiguration,
  DefaultConfigValidator
} from "./config";
import { S3Event } from "aws-lambda";
import { ExecutionMode, LocalConfig } from "./types";

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

describe("Configuration Management", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.LAMBDA_RUNTIME_DIR;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("detectExecutionMode", () => {
    test("should detect AWS mode when S3 event is provided", () => {
      const mode = detectExecutionMode(mockS3Event);
      expect(mode).toBe("aws");
    });

    test("should detect local mode when local config is provided", () => {
      const localConfig: LocalConfig = {
        participationsCsvPath: "/path/to/file.csv"
      };
      const mode = detectExecutionMode(undefined, localConfig);
      expect(mode).toBe("local");
    });

    test("should detect AWS mode when Lambda environment variables are present", () => {
      process.env.AWS_LAMBDA_FUNCTION_NAME = "test-function";
      const mode = detectExecutionMode();
      expect(mode).toBe("aws");
    });

    test("should default to local mode", () => {
      const mode = detectExecutionMode();
      expect(mode).toBe("local");
    });
  });

  describe("loadEnvironmentConfig", () => {
    test("should load configuration from environment variables", () => {
      process.env.STRAPI_BASE_URL = "https://api.example.com";
      process.env.STRAPI_TOKEN = "test-token";
      process.env.PROCESS_MODE = "sequential";
      process.env.OMIT_GET = "true";
      process.env.BATCH_SIZE = "50";
      process.env.CHUNK_SIZE = "200";

      const config = loadEnvironmentConfig();

      expect(config.strapiBaseUrl).toBe("https://api.example.com");
      expect(config.strapiToken).toBe("test-token");
      expect(config.processMode).toBe("sequential");
      expect(config.omitGet).toBe(true);
      expect(config.batchSize).toBe(50);
      expect(config.chunkSize).toBe(200);
    });

    test("should use defaults for missing environment variables", () => {
      const config = loadEnvironmentConfig();

      expect(config.processMode).toBe("parallel");
      expect(config.omitGet).toBe(false);
      expect(config.batchSize).toBe(100);
      expect(config.chunkSize).toBe(150);
    });
  });

  describe("createProcessingConfig", () => {
    test("should create config with overrides", () => {
      process.env.PROCESS_MODE = "parallel";
      process.env.BATCH_SIZE = "100";

      const config = createProcessingConfig({
        processMode: "sequential",
        batchSize: 50
      });

      expect(config.processMode).toBe("sequential");
      expect(config.batchSize).toBe(50);
    });
  });

  describe("DefaultConfigValidator", () => {
    const validator = new DefaultConfigValidator();

    test("should validate environment config correctly", () => {
      const validConfig = {
        strapiBaseUrl: "https://api.example.com",
        strapiToken: "test-token",
        processMode: "parallel" as const,
        omitGet: false,
        batchSize: 100,
        chunkSize: 150
      };

      const result = validator.validateEnvironmentConfig(validConfig);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("should detect missing required fields", () => {
      const invalidConfig = {
        strapiBaseUrl: "",
        strapiToken: ""
      };

      const result = validator.validateEnvironmentConfig(invalidConfig);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("STRAPI_BASE_URL is required");
      expect(result.errors).toContain("STRAPI_TOKEN is required");
    });

    test("should validate invalid URL", () => {
      const invalidConfig = {
        strapiBaseUrl: "not-a-url",
        strapiToken: "test-token"
      };

      const result = validator.validateEnvironmentConfig(invalidConfig);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("STRAPI_BASE_URL must be a valid URL");
    });
  });

  describe("validateConfiguration", () => {
    test("should validate complete configuration", () => {
      const envConfig = {
        strapiBaseUrl: "https://api.example.com",
        strapiToken: "test-token",
        processMode: "parallel" as const,
        omitGet: false,
        batchSize: 100,
        chunkSize: 150
      };

      const result = validateConfiguration("aws", envConfig);
      expect(result.isValid).toBe(true);
    });
  });
});