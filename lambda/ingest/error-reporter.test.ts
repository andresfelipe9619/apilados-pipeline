/**
 * Unit tests for ErrorReporter implementation
 */

import { writeFile } from "node:fs/promises";
import { MigrationErrorReporter, createErrorReporter } from "./error-reporter";

// Mock fs/promises
jest.mock("node:fs/promises", () => ({
  writeFile: jest.fn()
}));



describe("MigrationErrorReporter", () => {
  let errorReporter: MigrationErrorReporter;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorReporter = new MigrationErrorReporter("local");
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy.mockRestore();
  });

  describe("logError", () => {
    it("should log error with all parameters", () => {
      errorReporter.logError("PART001", "test@example.com", "Test error", 5);

      const errors = errorReporter.getErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual({
        participantId: "PART001",
        email: "test@example.com",
        error: "Test error",
        rowNumber: 5
      });
    });

    it("should log error without row number", () => {
      errorReporter.logError("PART002", "user@test.com", "Another error");

      const errors = errorReporter.getErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual({
        participantId: "PART002",
        email: "user@test.com",
        error: "Another error",
        rowNumber: undefined
      });
    });

    it("should handle empty or undefined values", () => {
      errorReporter.logError("", "", "");

      const errors = errorReporter.getErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual({
        participantId: "UNKNOWN",
        email: "NO_EMAIL",
        error: "Unknown error",
        rowNumber: undefined
      });
    });

    it("should log to console", () => {
      errorReporter.logError("PART001", "test@example.com", "Test error", 5);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error processing participant PART001 (test@example.com) at row 5: Test error"
      );
    });

    it("should log to console without row number", () => {
      errorReporter.logError("PART001", "test@example.com", "Test error");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error processing participant PART001 (test@example.com): Test error"
      );
    });
  });

  describe("getErrors", () => {
    it("should return empty array when no errors", () => {
      const errors = errorReporter.getErrors();
      expect(errors).toEqual([]);
    });

    it("should return copy of errors array", () => {
      errorReporter.logError("PART001", "test@example.com", "Test error");
      
      const errors1 = errorReporter.getErrors();
      const errors2 = errorReporter.getErrors();
      
      expect(errors1).toEqual(errors2);
      expect(errors1).not.toBe(errors2); // Different array instances
    });

    it("should return all logged errors", () => {
      errorReporter.logError("PART001", "test1@example.com", "Error 1");
      errorReporter.logError("PART002", "test2@example.com", "Error 2");
      errorReporter.logError("PART003", "test3@example.com", "Error 3");

      const errors = errorReporter.getErrors();
      expect(errors).toHaveLength(3);
      expect(errors[0].participantId).toBe("PART001");
      expect(errors[1].participantId).toBe("PART002");
      expect(errors[2].participantId).toBe("PART003");
    });
  });

  describe("getErrorCount", () => {
    it("should return 0 when no errors", () => {
      expect(errorReporter.getErrorCount()).toBe(0);
    });

    it("should return correct count after logging errors", () => {
      errorReporter.logError("PART001", "test@example.com", "Error 1");
      expect(errorReporter.getErrorCount()).toBe(1);

      errorReporter.logError("PART002", "test@example.com", "Error 2");
      expect(errorReporter.getErrorCount()).toBe(2);
    });
  });

  describe("clearErrors", () => {
    it("should clear all errors", () => {
      errorReporter.logError("PART001", "test@example.com", "Error 1");
      errorReporter.logError("PART002", "test@example.com", "Error 2");
      
      expect(errorReporter.getErrorCount()).toBe(2);
      
      errorReporter.clearErrors();
      
      expect(errorReporter.getErrorCount()).toBe(0);
      expect(errorReporter.getErrors()).toEqual([]);
    });
  });

  describe("generateErrorCsv", () => {
    it("should return no errors message when no errors logged", () => {
      const csv = errorReporter.generateErrorCsv();
      expect(csv).toBe("No errors to report");
    });

    it("should generate proper CSV format with summary", () => {
      errorReporter.logError("PART001", "test@example.com", "Test error", 5);
      
      const csv = errorReporter.generateErrorCsv();
      const lines = csv.split("\n");
      
      // Check for summary header
      expect(lines[0]).toBe("# Migration Error Report");
      expect(lines[2]).toBe("# Total Errors: 1");
      expect(lines[3]).toBe("# Participants with Errors: 1");
      
      // Find the CSV headers line
      const headerLineIndex = lines.findIndex(line => line.startsWith("Participant ID"));
      expect(headerLineIndex).toBeGreaterThan(0);
      expect(lines[headerLineIndex]).toBe("Participant ID,Email,Row Number,Error Category,Error Description,Timestamp");
      
      // Check data row
      const dataLine = lines[headerLineIndex + 1];
      expect(dataLine).toMatch(/^PART001,test@example\.com,5,General Error,Test error,\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it("should handle CSV escaping for commas", () => {
      errorReporter.logError("PART001", "test@example.com", "Error with, comma");
      
      const csv = errorReporter.generateErrorCsv();
      const lines = csv.split("\n");
      
      expect(lines[1]).toContain('"Error with, comma"');
    });

    it("should handle CSV escaping for quotes", () => {
      errorReporter.logError("PART001", "test@example.com", 'Error with "quotes"');
      
      const csv = errorReporter.generateErrorCsv();
      const lines = csv.split("\n");
      
      expect(lines[1]).toContain('"Error with ""quotes"""');
    });

    it("should handle CSV escaping for newlines", () => {
      errorReporter.logError("PART001", "test@example.com", "Error with\nnewline");
      
      const csv = errorReporter.generateErrorCsv();
      
      // Check that the CSV contains the escaped newline content
      expect(csv).toContain('"Error with\nnewline"');
    });

    it("should handle missing row numbers", () => {
      errorReporter.logError("PART001", "test@example.com", "Test error");
      
      const csv = errorReporter.generateErrorCsv();
      const lines = csv.split("\n");
      
      // Find the data line (after headers and summary)
      const dataLineIndex = lines.findIndex(line => line.startsWith("PART001"));
      expect(dataLineIndex).toBeGreaterThan(0);
      expect(lines[dataLineIndex]).toContain(",Test error,");
    });

  describe("saveErrorReport", () => {
    const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;

    it("should skip saving when no errors", async () => {
      const result = await errorReporter.saveErrorReport();
      
      expect(result).toBe("");
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it("should save to local file in local mode", async () => {
      errorReporter.logError("PART001", "test@example.com", "Test error");
      
      const result = await errorReporter.saveErrorReport("test-errors.csv");
      
      expect(result).toBe("test-errors.csv");
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining("test-errors.csv"),
        expect.stringContaining("PART001,test@example.com"),
        "utf-8"
      );
    });

    it("should generate default filename with timestamp", async () => {
      errorReporter.logError("PART001", "test@example.com", "Test error");
      
      const result = await errorReporter.saveErrorReport();
      
      expect(result).toMatch(/^migration-errors-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.csv$/);
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it("should handle file write errors", async () => {
      mockWriteFile.mockRejectedValueOnce(new Error("Write failed"));
      errorReporter.logError("PART001", "test@example.com", "Test error");
      
      await expect(errorReporter.saveErrorReport("test.csv")).rejects.toThrow("Failed to save error report: Write failed");
    });

    it("should use constructor output path as default", async () => {
      const reporterWithPath = new MigrationErrorReporter("local", "default-errors.csv");
      reporterWithPath.logError("PART001", "test@example.com", "Test error");
      
      const result = await reporterWithPath.saveErrorReport();
      
      expect(result).toBe("default-errors.csv");
    });
  });

  describe("getErrorSummary", () => {
    it("should return empty summary when no errors", () => {
      const summary = errorReporter.getErrorSummary();
      
      expect(summary).toEqual({
        totalErrors: 0,
        errorsByType: {},
        participantsWithErrors: 0
      });
    });

    it("should categorize errors correctly", () => {
      errorReporter.logError("PART001", "test@example.com", "Validation failed");
      errorReporter.logError("PART002", "test@example.com", "API request timeout");
      errorReporter.logError("PART003", "test@example.com", "Invalid email format");
      errorReporter.logError("PART001", "test@example.com", "Another validation error");
      
      const summary = errorReporter.getErrorSummary();
      
      expect(summary.totalErrors).toBe(4);
      expect(summary.participantsWithErrors).toBe(3);
      expect(summary.errorsByType).toEqual({
        "Validation Error": 2,
        "API Error": 1,
        "Email Error": 1
      });
    });

    it("should handle general errors", () => {
      errorReporter.logError("PART001", "test@example.com", "Something went wrong");
      
      const summary = errorReporter.getErrorSummary();
      
      expect(summary.errorsByType).toEqual({
        "General Error": 1
      });
    });
  });

  describe("AWS mode", () => {
    let awsReporter: MigrationErrorReporter;
    let consoleLogSpy: jest.SpyInstance;

    beforeEach(() => {
      awsReporter = new MigrationErrorReporter("aws");
      consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
    });

    it("should log CSV content in AWS mode instead of saving to file", async () => {
      awsReporter.logError("PART001", "test@example.com", "Test error");
      
      const result = await awsReporter.saveErrorReport("test.csv");
      
      expect(result).toBe("test.csv");
      expect(consoleLogSpy).toHaveBeenCalledWith(
        "Error report content (AWS mode):",
        expect.stringContaining("PART001,test@example.com")
      );
      expect(writeFile).not.toHaveBeenCalled();
    });
  });
});

describe("createErrorReporter", () => {
  it("should create ErrorReporter with default parameters", () => {
    const reporter = createErrorReporter();
    
    expect(reporter).toBeInstanceOf(MigrationErrorReporter);
    expect(reporter.getErrorCount()).toBe(0);
  });

  it("should create ErrorReporter with custom parameters", () => {
    const reporter = createErrorReporter("aws", "custom-path.csv");
    
    expect(reporter).toBeInstanceOf(MigrationErrorReporter);
    expect(reporter.getErrorCount()).toBe(0);
  });
});