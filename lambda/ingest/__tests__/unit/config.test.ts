/**
 * Tests for configuration management and execution mode detection
 */

import { 
  detectExecutionMode, 
  loadEnvironmentConfig, 
  createProcessingConfig,
  validateConfiguration,
  DefaultConfigValidator
} from "../../config";

// Import enhanced functions separately to avoid potential circular dependency issues
const config = require("../../config");
import { S3Event } from "aws-lambda";
import { ExecutionMode, LocalConfig } from "../../types";

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
    delete process.env.NODE_ENV;
    delete process.env.DATABASE_HOST;
    delete process.env.STRAPI_BASE_URL;
    delete process.env.STRAPI_URL;
    delete process.env.AWS_REGION;
    delete process.env.PROCESS_MODE;
    delete process.env.OMIT_GET;
    delete process.env.BATCH_SIZE;
    delete process.env.CHUNK_SIZE;
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

  describe("Enhanced Environment Detection", () => {
    describe("detectEnvironmentType", () => {
      test("should detect production from NODE_ENV", () => {
        process.env.NODE_ENV = "production";
        const type = config.detectEnvironmentType();
        expect(type).toBe("production");
      });

      test("should detect local from NODE_ENV", () => {
        process.env.NODE_ENV = "development";
        const type = config.detectEnvironmentType();
        expect(type).toBe("local");
      });

      test("should detect production from AWS Lambda environment", () => {
        process.env.AWS_LAMBDA_FUNCTION_NAME = "test-function";
        const type = config.detectEnvironmentType();
        expect(type).toBe("production");
      });

      test("should detect production from RDS database host", () => {
        process.env.DATABASE_HOST = "mydb.abc123.us-east-1.rds.amazonaws.com";
        const type = config.detectEnvironmentType();
        expect(type).toBe("production");
      });

      test("should detect local from localhost database", () => {
        process.env.DATABASE_HOST = "localhost";
        const type = config.detectEnvironmentType();
        expect(type).toBe("local");
      });

      test("should detect local from localhost Strapi URL", () => {
        process.env.STRAPI_BASE_URL = "http://localhost:1337/api";
        const type = config.detectEnvironmentType();
        expect(type).toBe("local");
      });

      test("should default to local when indicators are equal", () => {
        // Clear all environment variables that could influence detection
        delete process.env.NODE_ENV;
        delete process.env.DATABASE_HOST;
        delete process.env.STRAPI_BASE_URL;
        delete process.env.AWS_REGION;
        
        const type = config.detectEnvironmentType();
        expect(type).toBe("local");
      });
    });

    describe("getEnvironmentDetectionDetails", () => {
      test("should provide detailed detection information", () => {
        process.env.NODE_ENV = "production";
        process.env.DATABASE_HOST = "localhost";
        
        const details = config.getEnvironmentDetectionDetails();
        
        expect(details.detectedType).toBe("production");
        expect(details.reasoning).toContain("Production score:");
        expect(details.indicators.production).toBeDefined();
        expect(details.indicators.local).toBeDefined();
        
        // Should have production indicator for NODE_ENV
        const prodNodeEnv = details.indicators.production.find(i => i.indicator.includes('NODE_ENV'));
        expect(prodNodeEnv?.present).toBe(true);
        
        // Should have local indicator for database host
        const localDbHost = details.indicators.local.find(i => i.indicator.includes('database host'));
        expect(localDbHost?.present).toBe(true);
      });
    });
  });

  describe("Enhanced Environment Validation", () => {
    describe("validateCompleteEnvironment", () => {
      test("should validate all environment components", () => {
        // Set up valid environment
        process.env.STRAPI_BASE_URL = "https://api.example.com";
        process.env.STRAPI_TOKEN = "test-token";
        process.env.DATABASE_HOST = "localhost";
        process.env.DATABASE_PORT = "5432";
        process.env.DATABASE_NAME = "testdb";
        process.env.DATABASE_USERNAME = "testuser";
        process.env.DATABASE_PASSWORD = "testpass";
        
        const result = config.validateCompleteEnvironment();
        
        expect(result.environmentType).toBe("local");
        expect(result.configurationDetails.strapi).toBeDefined();
        expect(result.configurationDetails.database).toBeDefined();
        expect(result.configurationDetails.ccts).toBeDefined();
      });

      test("should detect missing database configuration", () => {
        // Set up environment without database config
        process.env.STRAPI_BASE_URL = "https://api.example.com";
        process.env.STRAPI_TOKEN = "test-token";
        delete process.env.DATABASE_HOST;
        
        const result = validateCompleteEnvironment();
        
        expect(result.configurationDetails.database.isValid).toBe(false);
        expect(result.configurationDetails.database.errors).toContain("DATABASE_HOST is required for database operations");
      });
    });

    describe("validateEnvironmentForOperation", () => {
      test("should validate event simulation operation requirements", () => {
        process.env.STRAPI_BASE_URL = "https://api.example.com";
        process.env.STRAPI_TOKEN = "test-token";
        
        const result = validateEnvironmentForOperation("simulation");
        
        expect(result.environmentType).toBeDefined();
        expect(result.operationSupported).toBe(true);
        expect(result.missingRequirements).not.toContain("Strapi API configuration");
      });

      test("should validate dump operation requirements", () => {
        process.env.STRAPI_BASE_URL = "https://api.example.com";
        process.env.STRAPI_TOKEN = "test-token";
        // Missing database config
        delete process.env.DATABASE_HOST;
        
        const result = validateEnvironmentForOperation("dump");
        
        expect(result.operationSupported).toBe(false);
        expect(result.missingRequirements).toContain("Database configuration");
      });

      test("should support dump operation with complete database config", () => {
        process.env.STRAPI_BASE_URL = "https://api.example.com";
        process.env.STRAPI_TOKEN = "test-token";
        process.env.DATABASE_HOST = "localhost";
        process.env.DATABASE_PORT = "5432";
        process.env.DATABASE_NAME = "testdb";
        process.env.DATABASE_USERNAME = "testuser";
        process.env.DATABASE_PASSWORD = "testpass";
        
        const result = validateEnvironmentForOperation("dump");
        
        expect(result.operationSupported).toBe(true);
        expect(result.missingRequirements).toHaveLength(0);
      });
    });

    describe("getEnvironmentStatus", () => {
      test("should return ready status for valid configuration", () => {
        process.env.STRAPI_BASE_URL = "https://api.example.com";
        process.env.STRAPI_TOKEN = "test-token";
        process.env.DATABASE_HOST = "localhost";
        process.env.DATABASE_PORT = "5432";
        process.env.DATABASE_NAME = "testdb";
        process.env.DATABASE_USERNAME = "testuser";
        process.env.DATABASE_PASSWORD = "testpass";
        
        const status = getEnvironmentStatus("dump");
        
        expect(status.ready).toBe(true);
        expect(status.status).toBe("ready");
        expect(status.message).toContain("ready for dump operations");
      });

      test("should return error status for missing configuration", () => {
        delete process.env.STRAPI_BASE_URL;
        delete process.env.STRAPI_TOKEN;
        
        const status = getEnvironmentStatus("migration");
        
        expect(status.ready).toBe(false);
        expect(status.status).toBe("error");
        expect(status.quickFixes.length).toBeGreaterThan(0);
      });

      test("should provide specific quick fixes", () => {
        delete process.env.STRAPI_BASE_URL;
        delete process.env.DATABASE_HOST;
        
        const status = getEnvironmentStatus("dump");
        
        expect(status.quickFixes).toContain("Set STRAPI_BASE_URL and STRAPI_TOKEN environment variables");
        expect(status.quickFixes).toContain("Configure database environment variables (DATABASE_HOST, DATABASE_PORT, etc.)");
      });
    });

    describe("generateConfigurationErrorMessage", () => {
      test("should generate helpful error message for local environment", () => {
        const validationResult = {
          isValid: false,
          errors: ["STRAPI_BASE_URL is required", "DATABASE_HOST is required"],
          warnings: ["CCTs file not found"]
        };
        
        const message = generateConfigurationErrorMessage(validationResult, "local");
        
        expect(message).toContain("Configuration validation failed for local environment");
        expect(message).toContain("CRITICAL ERRORS");
        expect(message).toContain("STRAPI_BASE_URL is required");
        expect(message).toContain("DATABASE_HOST is required");
        expect(message).toContain("WARNINGS");
        expect(message).toContain("CCTs file not found");
        expect(message).toContain("LOCAL DEVELOPMENT SETUP");
        expect(message).toContain("Create a .env file");
      });

      test("should generate helpful error message for production environment", () => {
        const validationResult = {
          isValid: false,
          errors: ["AWS credentials not configured"],
          warnings: ["S3 bucket not specified"]
        };
        
        const message = generateConfigurationErrorMessage(validationResult, "production");
        
        expect(message).toContain("Configuration validation failed for production environment");
        expect(message).toContain("PRODUCTION DEPLOYMENT SETUP");
        expect(message).toContain("Set environment variables in your deployment platform");
        expect(message).toContain("Ensure AWS credentials are properly configured");
      });

      test("should return success message for valid configuration", () => {
        const validationResult = {
          isValid: true,
          errors: [],
          warnings: []
        };
        
        const message = generateConfigurationErrorMessage(validationResult, "local");
        
        expect(message).toBe("Configuration is valid ✅");
      });
    });
  });

  describe("Database Configuration Validation", () => {
    test("should validate complete database configuration", () => {
      const validator = new DefaultConfigValidator();
      const dbConfig = {
        host: "localhost",
        port: 5432,
        database: "testdb",
        username: "testuser",
        password: "testpass",
        ssl: false
      };
      
      const result = validator.validateDatabaseConfig(dbConfig);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("should detect missing database fields", () => {
      const validator = new DefaultConfigValidator();
      const dbConfig = {
        host: "",
        port: 0,
        database: "",
        username: "",
        password: ""
      };
      
      const result = validator.validateDatabaseConfig(dbConfig);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("DATABASE_HOST is required for database operations");
      expect(result.errors).toContain("DATABASE_PORT is required for database operations");
      expect(result.errors).toContain("DATABASE_NAME is required for database operations");
      expect(result.errors).toContain("DATABASE_USERNAME is required for database operations");
      expect(result.errors).toContain("DATABASE_PASSWORD is required for database operations");
    });

    test("should validate port range", () => {
      const validator = new DefaultConfigValidator();
      const dbConfig = {
        host: "localhost",
        port: 70000, // Invalid port
        database: "testdb",
        username: "testuser",
        password: "testpass"
      };
      
      const result = validator.validateDatabaseConfig(dbConfig);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("DATABASE_PORT must be between 1 and 65535");
    });
  });

  describe("CCTs Configuration Validation", () => {
    test("should validate local CCTs configuration", () => {
      const validator = new DefaultConfigValidator();
      const cctsConfig = {
        environment: "local" as const,
        localPath: "/path/to/ccts.csv"
      };
      
      const result = validator.validateCCTsConfig(cctsConfig);
      
      expect(result.isValid).toBe(true);
    });

    test("should validate production CCTs configuration", () => {
      const validator = new DefaultConfigValidator();
      const cctsConfig = {
        environment: "production" as const,
        s3Bucket: "my-bucket",
        s3Key: "ccts/data.csv"
      };
      
      const result = validator.validateCCTsConfig(cctsConfig);
      
      expect(result.isValid).toBe(true);
    });

    test("should warn about missing local CCTs file", () => {
      const validator = new DefaultConfigValidator();
      const cctsConfig = {
        environment: "local" as const,
        localPath: "/nonexistent/path.csv"
      };
      
      const result = validator.validateCCTsConfig(cctsConfig);
      
      expect(result.isValid).toBe(true); // Warnings don't make it invalid
      expect(result.warnings).toContain("CCTs file not found at /nonexistent/path.csv - will continue without CCTs data");
    });
  });
});