/**
 * Unit tests for development utilities
 */

import { DevUtils } from "../../dev-utils";

// Mock dependencies
jest.mock("node:fs/promises");
jest.mock("node:fs");
jest.mock("../../config");
jest.mock("../../local-test-runner");

describe("DevUtils", () => {
  let devUtils: DevUtils;

  beforeEach(() => {
    // Reset singleton
    (DevUtils as any).instance = undefined;
    jest.clearAllMocks();
  });

  describe("getInstance", () => {
    it("should return singleton instance", () => {
      const instance1 = DevUtils.getInstance();
      const instance2 = DevUtils.getInstance();

      expect(instance1).toBe(instance2);
      expect(instance1).toBeInstanceOf(DevUtils);
    });
  });

  describe("validateEnvironmentSetup", () => {
    it("should validate complete environment setup", () => {
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

      devUtils = DevUtils.getInstance();
      const result = devUtils.validateEnvironmentSetup();

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it("should detect environment validation errors", () => {
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
        errors: ["STRAPI_BASE_URL is required", "STRAPI_TOKEN is required"],
        warnings: [],
      });

      devUtils = DevUtils.getInstance();
      const result = devUtils.validateEnvironmentSetup();

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("STRAPI_BASE_URL is required");
      expect(result.errors).toContain("STRAPI_TOKEN is required");
    });
  });

  describe("createTestEnvironment", () => {
    it("should create test environment successfully", async () => {
      const { writeFile, mkdir } = require("node:fs/promises");
      const { existsSync } = require("node:fs");

      existsSync.mockReturnValue(false);
      writeFile.mockResolvedValue(undefined);
      mkdir.mockResolvedValue(undefined);

      devUtils = DevUtils.getInstance();
      const result = await devUtils.createTestEnvironment();

      expect(result.testDir).toBeDefined();
      expect(result.sampleCsv).toBeDefined();
      expect(mkdir).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalled();
    });

    it("should handle creation errors", async () => {
      const { writeFile, mkdir } = require("node:fs/promises");
      const { existsSync } = require("node:fs");

      existsSync.mockReturnValue(false);
      mkdir.mockRejectedValue(new Error("Permission denied"));

      devUtils = DevUtils.getInstance();

      await expect(devUtils.createTestEnvironment()).rejects.toThrow(
        "Permission denied",
      );
    });
  });

  describe("generateSampleCsv", () => {
    it("should generate sample CSV data", async () => {
      const { writeFile } = require("node:fs/promises");
      writeFile.mockResolvedValue(undefined);

      devUtils = DevUtils.getInstance();
      const result = await devUtils.generateSampleCsv("test.csv", 3);

      expect(result).toBe("test.csv");
      expect(writeFile).toHaveBeenCalled();
    });

    it("should generate default number of records", async () => {
      const { writeFile } = require("node:fs/promises");
      writeFile.mockResolvedValue(undefined);

      devUtils = DevUtils.getInstance();
      const result = await devUtils.generateSampleCsv("test.csv");

      expect(result).toBe("test.csv");
      expect(writeFile).toHaveBeenCalled();
    });
  });

  describe("generateSampleCctsCsv", () => {
    it("should generate sample CCTs CSV", async () => {
      const { writeFile } = require("node:fs/promises");
      writeFile.mockResolvedValue(undefined);

      devUtils = DevUtils.getInstance();
      const result = await devUtils.generateSampleCctsCsv("ccts.csv", 5);

      expect(result).toBe("ccts.csv");
      expect(writeFile).toHaveBeenCalled();
    });

    it("should handle file creation errors", async () => {
      const { writeFile } = require("node:fs/promises");
      writeFile.mockRejectedValue(new Error("Write failed"));

      devUtils = DevUtils.getInstance();

      await expect(devUtils.generateSampleCctsCsv("ccts.csv")).rejects.toThrow(
        "Write failed",
      );
    });
  });

  describe("displayEnvironmentSummary", () => {
    it("should display environment summary", () => {
      const { loadEnvironmentConfig } = require("../../config");
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      loadEnvironmentConfig.mockReturnValue({
        strapiBaseUrl: "https://api.example.com",
        strapiToken: "test-token",
        processMode: "parallel",
        omitGet: false,
        batchSize: 100,
        chunkSize: 150,
      });

      devUtils = DevUtils.getInstance();
      devUtils.displayEnvironmentSummary();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Environment Configuration Summary"),
      );
      consoleSpy.mockRestore();
    });
  });

  describe("runQuickTest", () => {
    it("should run quick test successfully", async () => {
      const {
        createLocalTestRunner,
      } = require("lambda/ingest/__tests__/unit/local-test-runner");
      const { writeFile } = require("node:fs/promises");

      writeFile.mockResolvedValue(undefined);

      const mockTestRunner = {
        validateEnvironment: jest.fn().mockReturnValue(true),
        runWithCsv: jest.fn().mockResolvedValue({
          totalRecords: 5,
          successCount: 5,
          errorCount: 0,
          processingTime: 1000,
        }),
      };
      createLocalTestRunner.mockReturnValue(mockTestRunner);

      devUtils = DevUtils.getInstance();
      const result = await devUtils.runQuickTest();

      expect(result.timestamp).toBeDefined();
      expect(result.environment).toBeDefined();
      expect(result.result).toBeDefined();
    });

    it("should handle test execution errors", async () => {
      const {
        createLocalTestRunner,
      } = require("lambda/ingest/__tests__/unit/local-test-runner");
      const { writeFile } = require("node:fs/promises");

      writeFile.mockResolvedValue(undefined);

      const mockTestRunner = {
        validateEnvironment: jest.fn().mockReturnValue(true),
        runWithCsv: jest.fn().mockRejectedValue(new Error("Test failed")),
      };
      createLocalTestRunner.mockReturnValue(mockTestRunner);

      devUtils = DevUtils.getInstance();

      await expect(devUtils.runQuickTest()).rejects.toThrow("Test failed");
    });
  });
});
