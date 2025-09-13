/**
 * Error reporting and logging system for migration processing
 * Captures detailed error information and generates CSV reports
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { ErrorReporter, ErrorRecord, ExecutionMode } from "./types.js";

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
    s3Config?: { client: S3Client; bucket: string }
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
  logError(participantId: string, email: string, error: string, rowNumber?: number): void {
    const errorRecord: ErrorRecord = {
      participantId: participantId || "UNKNOWN",
      email: email || "NO_EMAIL",
      error: error || "Unknown error",
      rowNumber
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
   * Generate CSV content for error report
   * @returns CSV formatted string with all error records
   */
  generateErrorCsv(): string {
    if (this.errors.length === 0) {
      return "No errors to report";
    }

    // CSV headers
    const headers = ["Participant ID", "Email", "Row Number", "Error Description", "Timestamp"];
    const csvLines = [headers.join(",")];

    // Add each error as a CSV row
    const timestamp = new Date().toISOString();
    for (const error of this.errors) {
      const row = [
        this.escapeCsvValue(error.participantId),
        this.escapeCsvValue(error.email),
        error.rowNumber?.toString() || "",
        this.escapeCsvValue(error.error),
        timestamp
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
      // For AWS mode, we'll implement S3 upload in the next sub-task
      // For now, just log the content
      console.log("Error report content (AWS mode):", csvContent);
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
      participantsWithErrors: uniqueParticipants.size
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
  private async saveToLocalFile(content: string, filePath: string): Promise<void> {
    try {
      // Ensure we have an absolute path or relative to current working directory
      const fullPath = filePath.startsWith("/") ? filePath : join(process.cwd(), filePath);
      
      await writeFile(fullPath, content, "utf-8");
      console.log(`Error report saved to: ${fullPath}`);
    } catch (error) {
      console.error(`Failed to save error report to ${filePath}:`, error);
      throw new Error(`Failed to save error report: ${error instanceof Error ? error.message : "Unknown error"}`);
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
    
    if (message.includes("api") || message.includes("strapi") || message.includes("request")) {
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
 * @returns New ErrorReporter instance
 */
export function createErrorReporter(
  executionMode: ExecutionMode = "local",
  outputPath?: string
): ErrorReporter {
  return new MigrationErrorReporter(executionMode, outputPath);
}