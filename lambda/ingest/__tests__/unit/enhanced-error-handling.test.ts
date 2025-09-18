/**
 * Unit tests for enhanced error handling and user feedback
 * Tests progress indicators, error messages, and recovery suggestions
 */

const {
  formatOperationError,
  formatProgressMessage,
  formatCompletionMessage,
} = require("../../dist/dev-utils");
import { DatabaseDumper } from "../../database-dump";
import { DumpOptions } from "../../types";

describe("Enhanced Error Handling", () => {
  describe("formatOperationError", () => {
    it("should format dump operation errors with recovery suggestions", () => {
      const error = "Connection failed";
      const context = {
        filePath: "/tmp/dump.sql",
        duration: 5000,
      };

      const result = formatOperationError("dump", error, context);

      expect(result).toContain("DATABASE DUMP RECOVERY SUGGESTIONS");
      expect(result).toContain("Verify database server is running");
      expect(result).toContain("Check DATABASE_* environment variables");
      expect(result).toContain("Duration: 5.00s");
      expect(result).toContain("/tmp/dump.sql");
    });

    it("should format migration operation errors with context", () => {
      const error = new Error("Strapi connection failed");
      const context = {
        recordCount: 100,
        successRate: 25.5,
      };

      const result = formatOperationError("migration", error, context);

      expect(result).toContain("MIGRATION RECOVERY SUGGESTIONS");
      expect(result).toContain("Verify Strapi server is running");
      expect(result).toContain("Records: 100");
      expect(result).toContain("Success Rate: 25.5%");
      expect(result).toContain("Low success rate indicates systematic issues");
    });

    it("should format validation errors with general suggestions", () => {
      const error = "Missing required environment variables";

      const result = formatOperationError("validation", error);

      expect(result).toContain("VALIDATION RECOVERY SUGGESTIONS");
      expect(result).toContain("Create .env file with required variables");
      expect(result).toContain("migration-cli env");
    });

    it("should format connection errors with network troubleshooting", () => {
      const error = "Connection timeout";

      const result = formatOperationError("connection", error);

      expect(result).toContain("CONNECTION RECOVERY SUGGESTIONS");
      expect(result).toContain("Check service is running");
      expect(result).toContain("Verify network connectivity");
      expect(result).toContain("Check SSL/TLS configuration");
    });
  });

  describe("formatProgressMessage", () => {
    it("should format progress with percentage and ETA", () => {
      const startTime = Date.now() - 10000; // 10 seconds ago
      const result = formatProgressMessage(25, 100, startTime, "Processing records");

      expect(result).toContain("Processing records: 25/100 (25%)");
      expect(result).toContain("Rate:");
      expect(result).toContain("ETA:");
    });

    it("should handle zero progress gracefully", () => {
      const startTime = Date.now();
      const result = formatProgressMessage(0, 100, startTime);

      expect(result).toContain("Processing: 0/100 (0%)");
      expect(result).not.toContain("Rate:");
    });

    it("should format ETA in appropriate units", () => {
      const startTime = Date.now() - 60000; // 1 minute ago
      const result = formatProgressMessage(10, 100, startTime);

      // Should show ETA in minutes for longer operations
      expect(result).toMatch(/ETA: \d+m/);
    });
  });

  describe("formatCompletionMessage", () => {
    it("should format completion with file size and duration", () => {
      const filePath = "/tmp/database_dump.sql";
      const fileSize = 1024 * 1024 * 50; // 50 MB
      const duration = 30000; // 30 seconds

      const result = formatCompletionMessage(filePath, fileSize, duration, "Database dump");

      expect(result).toContain("Database dump completed successfully!");
      expect(result).toContain(filePath);
      expect(result).toContain("50.00 MB");
      expect(result).toContain("30s");
      expect(result).toContain("Rate: 1.67 MB/s");
    });

    it("should handle small files without showing rate", () => {
      const result = formatCompletionMessage("/tmp/small.sql", 1024, 1000);

      expect(result).toContain("1.00 KB");
      expect(result).not.toContain("Rate:");
    });

    it("should format different file sizes correctly", () => {
      const testCases = [
        { size: 512, expected: "512.00 B" },
        { size: 1024, expected: "1.00 KB" },
        { size: 1024 * 1024, expected: "1.00 MB" },
        { size: 1024 * 1024 * 1024, expected: "1.00 GB" },
      ];

      testCases.forEach(({ size, expected }) => {
        const result = formatCompletionMessage("/tmp/test", size, 1000);
        expect(result).toContain(expected);
      });
    });
  });
});

describe("DatabaseDumper Enhanced Error Handling", () => {
  let dumper: DatabaseDumper;
  let mockConfig: any;

  beforeEach(() => {
    mockConfig = {
      host: "localhost",
      port: 5432,
      database: "test_db",
      username: "test_user",
      password: "test_pass",
    };
    dumper = new DatabaseDumper(mockConfig);
  });

  describe("Progress Callback Integration", () => {
    it("should call progress callback during dump creation", async () => {
      const progressMessages: string[] = [];
      const progressCallback = (message: string) => {
        progressMessages.push(message);
      };

      // Mock the validation and execution methods
      jest.spyOn(dumper, 'validateConnection').mockResolvedValue({
        success: true,
        connectionTime: 100,
      });

      // Mock file system operations
      const fs = require('fs');
      let fileExists = false;
      jest.spyOn(fs, 'existsSync').mockImplementation(() => {
        // Return false initially, true after dump is "created"
        return fileExists;
      });
      jest.spyOn(fs, 'mkdirSync').mockImplementation();
      jest.spyOn(fs, 'accessSync').mockImplementation(); // Mock access check
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 * 1024 });

      // Mock execSync for disk space check
      const { execSync } = require('child_process');
      jest.spyOn(require('child_process'), 'execSync').mockReturnValue(
        'Filesystem     Size  Used Avail Use% Mounted on\n/dev/disk1s1   234G  123G  100G  56% /'
      );

      // Mock pg_dump execution
      const { spawn } = require('child_process');
      const mockProcess = {
        stderr: { on: jest.fn() },
        stdout: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            // Simulate file creation
            fileExists = true;
            setTimeout(() => callback(0), 100);
          }
        }),
      };
      jest.spyOn(require('child_process'), 'spawn').mockReturnValue(mockProcess);

      const options: DumpOptions = {
        outputPath: "/tmp",
        timestamp: true,
        compress: false,
      };

      const result = await dumper.createDump(options, progressCallback);

      expect(result.success).toBe(true);
      expect(progressMessages.length).toBeGreaterThan(0);
      expect(progressMessages.some(msg => msg.includes("Validating database connection"))).toBe(true);
      expect(progressMessages.some(msg => msg.includes("Database connection validated"))).toBe(true);
      expect(progressMessages.some(msg => msg.includes("Output directory validated"))).toBe(true);
    });
  });

  describe("Error Message Formatting", () => {
    it("should format connection errors with recovery suggestions", async () => {
      jest.spyOn(dumper, 'validateConnection').mockResolvedValue({
        success: false,
        error: "Connection timeout",
      });

      const result = await dumper.createDump();

      expect(result.success).toBe(false);
      expect(result.error).toContain("Database connection failed");
      expect(result.error).toContain("Recovery suggestions");
      expect(result.error).toContain("Verify database server is running");
      expect(result.error).toContain("Connection timeout - check if database server is overloaded");
    });

    it("should format pg_dump errors with specific suggestions", async () => {
      jest.spyOn(dumper, 'validateConnection').mockResolvedValue({
        success: true,
        connectionTime: 100,
      });

      // Mock file system operations
      const fs = require('fs');
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      jest.spyOn(fs, 'mkdirSync').mockImplementation();
      jest.spyOn(fs, 'accessSync').mockImplementation(); // Mock access check

      // Mock execSync for disk space check
      const { execSync } = require('child_process');
      jest.spyOn(require('child_process'), 'execSync').mockReturnValue(
        'Filesystem     Size  Used Avail Use% Mounted on\n/dev/disk1s1   234G  123G  100G  56% /'
      );

      // Mock pg_dump failure
      const mockProcess = {
        stderr: { on: jest.fn() },
        stdout: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(1), 100); // Exit code 1
          }
        }),
      };
      jest.spyOn(require('child_process'), 'spawn').mockReturnValue(mockProcess);

      const result = await dumper.createDump();

      expect(result.success).toBe(false);
      expect(result.error).toContain("pg_dump failed with exit code 1");
      expect(result.error).toContain("Check database connection parameters");
      expect(result.error).toContain("Verify user has sufficient privileges");
    });
  });

  describe("Disk Space Validation", () => {
    it("should validate disk space before dump", async () => {
      const progressMessages: string[] = [];
      const progressCallback = (message: string) => {
        progressMessages.push(message);
      };

      jest.spyOn(dumper, 'validateConnection').mockResolvedValue({
        success: true,
        connectionTime: 100,
      });

      // Mock execSync to return disk space info
      const { execSync } = require('child_process');
      jest.spyOn(require('child_process'), 'execSync').mockReturnValue(
        'Filesystem     Size  Used Avail Use% Mounted on\n/dev/disk1s1   234G  123G  100G  56% /'
      );

      const fs = require('fs');
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      jest.spyOn(fs, 'mkdirSync').mockImplementation();
      jest.spyOn(fs, 'accessSync').mockImplementation(); // Mock access check
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 });

      const mockProcess = {
        stderr: { on: jest.fn() },
        stdout: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 100);
          }
        }),
      };
      jest.spyOn(require('child_process'), 'spawn').mockReturnValue(mockProcess);

      await dumper.createDump({}, progressCallback);

      expect(progressMessages.some(msg => msg.includes("Disk space validated"))).toBe(true);
      expect(progressMessages.some(msg => msg.includes("GB available"))).toBe(true);
    });

    it("should warn about insufficient disk space", async () => {
      jest.spyOn(dumper, 'validateConnection').mockResolvedValue({
        success: true,
        connectionTime: 100,
      });

      // Mock execSync to return low disk space
      jest.spyOn(require('child_process'), 'execSync').mockReturnValue(
        'Filesystem     Size  Used Avail Use% Mounted on\n/dev/disk1s1   234G  233G    0G  99% /'
      );

      const fs = require('fs');
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      jest.spyOn(fs, 'mkdirSync').mockImplementation();
      jest.spyOn(fs, 'accessSync').mockImplementation(); // Mock access check

      const result = await dumper.createDump();

      expect(result.success).toBe(false);
      expect(result.error).toContain("Insufficient disk space");
      expect(result.error).toContain("Only 0.00GB available");
    });
  });
});