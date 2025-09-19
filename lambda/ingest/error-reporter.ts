/**
 * Error reporting and logging system for S3 event simulation processing
 * Captures detailed error information and generates CSV reports
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ErrorRecord, ErrorReporter, ExecutionMode } from "./types.js";

/**
 * Implementation of ErrorReporter interface
 * Provides in-memory error collection and CSV report generation
 */
export class MigrationErrorReporter implements ErrorReporter {
  private errors: ErrorRecord[] = [];
  private executionMode: ExecutionMode;
  private outputPath?: string;
  private s3Client?: S3Client;
  private s3Bucket?: string;

  constructor(
    executionMode: ExecutionMode = "local",
    outputPath?: string,
    s3Config?: { client: S3Client; bucket: string },
  ) {
    this.executionMode = executionMode;
    this.outputPath = outputPath;

    if (s3Config) {
      this.s3Client = s3Config.client;
      this.s3Bucket = s3Config.bucket;
    }
  }

  /**
   * Log an error for a specific participant
   * @param participantId - Unique identifier for the participant
   * @param email - Participant's email address
   * @param error - Error message or description
   * @param rowNumber - Optional CSV row number where error occurred
   */
  logError(
    participantId: string,
    email: string,
    error: string,
    rowNumber?: number,
  ): void {
    const errorRecord: ErrorRecord = {
      participantId: participantId || "UNKNOWN",
      email: email || "NO_EMAIL",
      error: error || "Unknown error",
      rowNumber,
    };

    this.errors.push(errorRecord);

    // Also log to console for immediate visibility
    const logMessage = `Error processing participant ${participantId} (${email})${
      rowNumber ? ` at row ${rowNumber}` : ""
    }: ${error}`;

    console.error(logMessage);
  }

  /**
   * Get all logged errors
   * @returns Array of all error records
   */
  getErrors(): ErrorRecord[] {
    return [...this.errors]; // Return copy to prevent external modification
  }

  /**
   * Generate CSV content for error report with summary statistics
   * @returns CSV formatted string with all error records and summary
   */
  generateErrorCsv(): string {
    if (this.errors.length === 0) {
      return "No errors to report";
    }

    const csvLines: string[] = [];
    const timestamp = new Date().toISOString();
    const summary = this.getErrorSummary();

    // Add summary header
    csvLines.push("# S3 Event Simulation Error Report");
    csvLines.push(`# Generated: ${timestamp}`);
    csvLines.push(`# Total Errors: ${summary.totalErrors}`);
    csvLines.push(
      `# Participants with Errors: ${summary.participantsWithErrors}`,
    );
    csvLines.push("#");

    // Add error categorization summary
    csvLines.push("# Error Categories:");
    for (const [category, count] of Object.entries(summary.errorsByType)) {
      csvLines.push(`# - ${category}: ${count}`);
    }
    csvLines.push("#");

    // CSV headers for error details
    const headers = [
      "Participant ID",
      "Email",
      "Row Number",
      "Error Category",
      "Error Description",
      "Timestamp",
    ];
    csvLines.push(headers.join(","));

    // Add each error as a CSV row
    for (const error of this.errors) {
      const errorCategory = this.categorizeError(error.error);
      const row = [
        this.escapeCsvValue(error.participantId),
        this.escapeCsvValue(error.email),
        error.rowNumber?.toString() || "",
        this.escapeCsvValue(errorCategory),
        this.escapeCsvValue(error.error),
        timestamp,
      ];
      csvLines.push(row.join(","));
    }

    return csvLines.join("\n");
  }

  /**
   * Save error report to file or S3
   * @param outputPath - Optional custom output path
   * @returns Promise resolving to the path where the report was saved
   */
  async saveErrorReport(outputPath?: string): Promise<string> {
    const csvContent = this.generateErrorCsv();

    if (csvContent === "No errors to report") {
      console.log("No errors to save - skipping error report generation");
      return "";
    }

    const finalOutputPath = this.determineOutputPath(outputPath);

    if (this.executionMode === "local") {
      await this.saveToLocalFile(csvContent, finalOutputPath);
    } else {
      // AWS mode - upload to S3
      await this.saveToS3(csvContent, finalOutputPath);
    }

    return finalOutputPath;
  }

  /**
   * Get error count
   * @returns Number of errors logged
   */
  getErrorCount(): number {
    return this.errors.length;
  }

  /**
   * Clear all logged errors
   * Useful for testing or resetting state
   */
  clearErrors(): void {
    this.errors = [];
  }

  /**
   * Get error summary statistics
   * @returns Object with error categorization and counts
   */
  getErrorSummary(): {
    totalErrors: number;
    errorsByType: Record<string, number>;
    participantsWithErrors: number;
  } {
    const errorsByType: Record<string, number> = {};
    const uniqueParticipants = new Set<string>();

    for (const error of this.errors) {
      // Simple error categorization based on error message keywords
      const errorType = this.categorizeError(error.error);
      errorsByType[errorType] = (errorsByType[errorType] || 0) + 1;
      uniqueParticipants.add(error.participantId);
    }

    return {
      totalErrors: this.errors.length,
      errorsByType,
      participantsWithErrors: uniqueParticipants.size,
    };
  }

  /**
   * Escape CSV values to handle commas, quotes, and newlines
   * @param value - Value to escape
   * @returns Properly escaped CSV value
   */
  private escapeCsvValue(value: string): string {
    if (!value) return "";

    // If value contains comma, quote, or newline, wrap in quotes and escape internal quotes
    if (value.includes(",") || value.includes('"') || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`;
    }

    return value;
  }

  /**
   * Determine the output path for the error report
   * @param customPath - Optional custom path provided by caller
   * @returns Final output path to use
   */
  private determineOutputPath(customPath?: string): string {
    if (customPath) {
      return customPath;
    }

    if (this.outputPath) {
      return this.outputPath;
    }

    // Default path with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `migration-errors-${timestamp}.csv`;
  }

  /**
   * Save error report to local file system
   * @param content - CSV content to save
   * @param filePath - Path where to save the file
   */
  private async saveToLocalFile(
    content: string,
    filePath: string,
  ): Promise<void> {
    try {
      // Ensure we have an absolute path or relative to current working directory
      const fullPath = filePath.startsWith("/")
        ? filePath
        : join(process.cwd(), filePath);

      await writeFile(fullPath, content, "utf-8");
      console.log(`Error report saved to: ${fullPath}`);
    } catch (error) {
      console.error(`Failed to save error report to ${filePath}:`, error);
      throw new Error(
        `Failed to save error report: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Save error report to S3 bucket
   * @param content - CSV content to save
   * @param filePath - S3 key/path where to save the file
   */
  private async saveToS3(content: string, filePath: string): Promise<void> {
    if (!this.s3Client || !this.s3Bucket) {
      console.warn(
        "S3 client or bucket not configured, logging error report content instead",
      );
      console.log("Error report content (AWS mode):", content);
      return;
    }

    try {
      // Ensure the S3 key has a proper path structure
      const s3Key = filePath.startsWith("error-reports/")
        ? filePath
        : `error-reports/${filePath}`;

      const command = new PutObjectCommand({
        Bucket: this.s3Bucket,
        Key: s3Key,
        Body: content,
        ContentType: "text/csv",
        Metadata: {
          "generated-by": "migration-error-reporter",
          "error-count": this.errors.length.toString(),
          "generation-timestamp": new Date().toISOString(),
        },
      });

      await this.s3Client.send(command);
      console.log(
        `Error report uploaded to S3: s3://${this.s3Bucket}/${s3Key}`,
      );
    } catch (error) {
      console.error(`Failed to upload error report to S3:`, error);
      // Fallback to logging the content
      console.log("Error report content (S3 upload failed):", content);
      throw new Error(
        `Failed to upload error report to S3: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Categorize errors based on error message content
   * @param errorMessage - The error message to categorize
   * @returns Error category string
   */
  private categorizeError(errorMessage: string): string {
    const message = errorMessage.toLowerCase();

    // Check more specific categories first
    if (message.includes("email") || message.includes("correo")) {
      return "Email Error";
    }

    if (
      message.includes("api") ||
      message.includes("strapi") ||
      message.includes("request")
    ) {
      return "API Error";
    }

    if (message.includes("participant") || message.includes("participante")) {
      return "Participant Error";
    }

    if (message.includes("csv") || message.includes("parse")) {
      return "CSV Processing Error";
    }

    if (message.includes("timeout") || message.includes("network")) {
      return "Network Error";
    }

    if (message.includes("validation") || message.includes("invalid")) {
      return "Validation Error";
    }

    return "General Error";
  }
}

/**
 * Factory function to create ErrorReporter instances
 * @param executionMode - The execution mode (local or aws)
 * @param outputPath - Optional output path for error reports
 * @param s3Config - Optional S3 configuration for AWS mode
 * @returns New ErrorReporter instance
 */
export function createErrorReporter(
  executionMode: ExecutionMode = "local",
  outputPath?: string,
  s3Config?: { client: S3Client; bucket: string },
): ErrorReporter {
  return new MigrationErrorReporter(executionMode, outputPath, s3Config);
}

/**
 * Create ErrorReporter with S3 support for AWS Lambda environment
 * @param s3Client - Configured S3 client
 * @param bucket - S3 bucket name for error reports
 * @param outputPath - Optional custom output path/key
 * @returns New ErrorReporter instance configured for AWS
 */
export function createS3ErrorReporter(
  s3Client: S3Client,
  bucket: string,
  outputPath?: string,
): ErrorReporter {
  return new MigrationErrorReporter("aws", outputPath, {
    client: s3Client,
    bucket,
  });
}
