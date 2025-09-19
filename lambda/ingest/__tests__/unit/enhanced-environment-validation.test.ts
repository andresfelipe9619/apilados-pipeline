/**
 * Tests for enhanced environment detection and validation
 */

const config = require("../../dist/config");

describe("Enhanced Environment Detection and Validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
    // Clear all environment variables that could influence detection
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
    delete process.env.DATABASE_PORT;
    delete process.env.DATABASE_NAME;
    delete process.env.DATABASE_USERNAME;
    delete process.env.DATABASE_PASSWORD;
    delete process.env.STRAPI_TOKEN;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

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
      const prodNodeEnv = details.indicators.production.find((i: any) => i.indicator.includes('NODE_ENV'));
      expect(prodNodeEnv?.present).toBe(true);
      
      // Should have local indicator for database host
      const localDbHost = details.indicators.local.find((i: any) => i.indicator.includes('database host'));
      expect(localDbHost?.present).toBe(true);
    });
  });

  describe("validateEnvironmentForOperation", () => {
    test("should validate event simulation operation requirements", () => {
      process.env.STRAPI_BASE_URL = "https://api.example.com";
      process.env.STRAPI_TOKEN = "test-token";
      
      const result = config.validateEnvironmentForOperation("simulation");
      
      expect(result.environmentType).toBeDefined();
      expect(result.operationSupported).toBe(true);
      expect(result.missingRequirements).not.toContain("Strapi API configuration");
    });

    test("should validate dump operation requirements", () => {
      process.env.STRAPI_BASE_URL = "https://api.example.com";
      process.env.STRAPI_TOKEN = "test-token";
      // Missing database config
      
      const result = config.validateEnvironmentForOperation("dump");
      
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
      
      const result = config.validateEnvironmentForOperation("dump");
      
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
      
      const status = config.getEnvironmentStatus("dump");
      
      expect(status.ready).toBe(true);
      expect(status.status).toBe("ready");
      expect(status.message).toContain("ready for dump operations");
    });

    test("should return error status for missing configuration", () => {
      // Test with a completely clean environment by setting NODE_ENV to test
      // and clearing all relevant environment variables
      const originalEnv = { ...process.env };
      
      // Clear all environment variables
      Object.keys(process.env).forEach(key => {
        if (key.startsWith('STRAPI_') || key.startsWith('DATABASE_') || key === 'NODE_ENV') {
          delete process.env[key];
        }
      });
      
      // Set AWS_LAMBDA_FUNCTION_NAME to avoid loading .env file
      process.env.AWS_LAMBDA_FUNCTION_NAME = "test-function";
      
      const status = config.getEnvironmentStatus("migration");
      
      expect(status.ready).toBe(false);
      expect(status.status).toBe("error");
      expect(status.quickFixes.length).toBeGreaterThan(0);
      
      // Restore environment
      process.env = originalEnv;
    });

    test("should provide specific quick fixes", () => {
      // Test with a completely clean environment
      const originalEnv = { ...process.env };
      
      // Clear all environment variables
      Object.keys(process.env).forEach(key => {
        if (key.startsWith('STRAPI_') || key.startsWith('DATABASE_') || key === 'NODE_ENV') {
          delete process.env[key];
        }
      });
      
      // Set AWS_LAMBDA_FUNCTION_NAME to avoid loading .env file
      process.env.AWS_LAMBDA_FUNCTION_NAME = "test-function";
      
      const status = config.getEnvironmentStatus("dump");
      
      expect(status.quickFixes).toContain("Set STRAPI_BASE_URL and STRAPI_TOKEN environment variables");
      expect(status.quickFixes).toContain("Configure database environment variables (DATABASE_HOST, DATABASE_PORT, etc.)");
      
      // Restore environment
      process.env = originalEnv;
    });
  });

  describe("generateConfigurationErrorMessage", () => {
    test("should generate helpful error message for local environment", () => {
      const validationResult = {
        isValid: false,
        errors: ["STRAPI_BASE_URL is required", "DATABASE_HOST is required"],
        warnings: ["CCTs file not found"]
      };
      
      const message = config.generateConfigurationErrorMessage(validationResult, "local");
      
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
      
      const message = config.generateConfigurationErrorMessage(validationResult, "production");
      
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
      
      const message = config.generateConfigurationErrorMessage(validationResult, "local");
      
      expect(message).toBe("Configuration is valid ✅");
    });
  });
});