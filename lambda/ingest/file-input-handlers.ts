/**
 * File input abstraction layer for migrator-lambda integration
 * Supports both S3 and local file system sources
 */

import { Readable } from "node:stream";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { S3Event } from "aws-lambda";
import { createReadStream, existsSync } from "node:fs";
import { ExecutionMode, FileInputHandler, LocalConfig } from "./types";

/**
 * S3 file input handler for AWS execution mode
 * Downloads CSV files from S3 buckets based on S3 events
 */
export class S3FileInputHandler implements FileInputHandler {
  private s3Client: S3Client;
  private bucket: string;
  private participationsKey: string;
  private cctsKey?: string;

  constructor(event: S3Event) {
    this.s3Client = new S3Client({});

    // Extract bucket and key from the first S3 record
    if (!event.Records || event.Records.length === 0) {
      throw new Error("S3 event must contain at least one record");
    }

    const record = event.Records[0];
    this.bucket = record.s3.bucket.name;
    this.participationsKey = decodeURIComponent(record.s3.object.key);

    // Check if there's a CCTs file in the same directory
    // Assume CCTs file follows naming convention: same directory, ends with 'ccts.csv'
    const keyParts = this.participationsKey.split("/");
    const directory = keyParts.slice(0, -1).join("/");
    const filename = keyParts[keyParts.length - 1];

    // Try to infer CCTs file name - look for common patterns
    if (directory) {
      this.cctsKey = `${directory}/ccts.csv`;
    } else {
      this.cctsKey = "ccts.csv";
    }

    console.log(`📁 S3FileInputHandler initialized:`);
    console.log(`   - Bucket: ${this.bucket}`);
    console.log(`   - Participations file: ${this.participationsKey}`);
    console.log(`   - CCTs file (inferred): ${this.cctsKey}`);
  }

  async getParticipationsCsv(): Promise<Readable> {
    try {
      console.log(
        `📥 Downloading participations CSV from S3: s3://${this.bucket}/${this.participationsKey}`,
      );

      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.participationsKey,
      });

      const response = await this.s3Client.send(command);

      if (!response.Body) {
        throw new Error(
          `No body returned from S3 object: s3://${this.bucket}/${this.participationsKey}`,
        );
      }

      return response.Body as Readable;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `❌ Failed to download participations CSV from S3: ${errorMessage}`,
      );
      throw new Error(
        `S3 access failure for participations file: ${errorMessage}`,
      );
    }
  }

  async getCctsCsv(): Promise<Readable | null> {
    if (!this.cctsKey) {
      console.log(`ℹ️  No CCTs file key configured, skipping CCTs download`);
      return null;
    }

    try {
      console.log(
        `📥 Attempting to download CCTs CSV from S3: s3://${this.bucket}/${this.cctsKey}`,
      );

      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.cctsKey,
      });

      const response = await this.s3Client.send(command);

      if (!response.Body) {
        console.log(
          `⚠️  CCTs file exists but has no body: s3://${this.bucket}/${this.cctsKey}`,
        );
        return null;
      }

      console.log(`✅ Successfully downloaded CCTs CSV from S3`);
      return response.Body as Readable;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.log(
        `ℹ️  CCTs file not found or inaccessible, continuing without it: ${errorMessage}`,
      );
      return null;
    }
  }

  getExecutionMode(): ExecutionMode {
    return "aws";
  }
} /**

 * Local file input handler for local execution mode
 * Reads CSV files from the local filesystem
 */
export class LocalFileInputHandler implements FileInputHandler {
  private participationsCsvPath: string;
  private cctsCsvPath?: string;

  constructor(config: LocalConfig) {
    this.participationsCsvPath = config.participationsCsvPath;
    this.cctsCsvPath = config.cctsCsvPath;

    console.log(`📁 LocalFileInputHandler initialized:`);
    console.log(`   - Participations file: ${this.participationsCsvPath}`);
    console.log(`   - CCTs file: ${this.cctsCsvPath || "not specified"}`);

    // Validate that the participations file exists
    if (!existsSync(this.participationsCsvPath)) {
      throw new Error(
        `Participations CSV file not found: ${this.participationsCsvPath}`,
      );
    }

    // Validate CCTs file if specified
    if (this.cctsCsvPath && !existsSync(this.cctsCsvPath)) {
      console.warn(
        `⚠️  CCTs CSV file not found: ${this.cctsCsvPath}. Will continue without it.`,
      );
      this.cctsCsvPath = undefined;
    }
  }

  getParticipationsCsv(): Promise<Readable> {
    try {
      console.log(
        `📖 Reading participations CSV from local file: ${this.participationsCsvPath}`,
      );

      // Verify file exists before creating stream
      if (!existsSync(this.participationsCsvPath)) {
        throw new Error(
          `Participations CSV file not found: ${this.participationsCsvPath}`,
        );
      }

      const stream = createReadStream(this.participationsCsvPath, {
        encoding: "utf8",
      });

      // Add error handling to the stream
      stream.on("error", (error) => {
        console.error(
          `❌ Error reading participations CSV file: ${error.message}`,
        );
        throw error;
      });

      console.log(`✅ Successfully opened participations CSV file for reading`);
      return Promise.resolve(stream);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `❌ Failed to read participations CSV file: ${errorMessage}`,
      );
      return Promise.reject(
        new Error(
          `Local file access failure for participations file: ${errorMessage}`,
        ),
      );
    }
  }

  getCctsCsv(): Promise<Readable | null> {
    if (!this.cctsCsvPath) {
      console.log(`ℹ️  No CCTs file path configured, skipping CCTs file`);
      return Promise.resolve(null);
    }

    try {
      console.log(`📖 Reading CCTs CSV from local file: ${this.cctsCsvPath}`);

      // Double-check file existence
      if (!existsSync(this.cctsCsvPath)) {
        console.log(
          `ℹ️  CCTs CSV file not found: ${this.cctsCsvPath}. Continuing without it.`,
        );
        return Promise.resolve(null);
      }

      const stream = createReadStream(this.cctsCsvPath, { encoding: "utf8" });

      // Add error handling to the stream
      stream.on("error", (error) => {
        console.error(`❌ Error reading CCTs CSV file: ${error.message}`);
        // Don't throw here - CCTs file is optional
        return null;
      });

      console.log(`✅ Successfully opened CCTs CSV file for reading`);
      return Promise.resolve(stream);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.log(
        `ℹ️  Failed to read CCTs CSV file, continuing without it: ${errorMessage}`,
      );
      return Promise.resolve(null);
    }
  }

  getExecutionMode(): ExecutionMode {
    return "local";
  }
} /*
 *
 * Factory for creating appropriate file input handlers based on execution mode
 */
export class FileInputHandlerFactory {
  /**
   * Creates the appropriate file input handler based on execution context
   * @param event S3 event (if running in AWS mode)
   * @param localConfig Local configuration (if running in local mode)
   * @returns FileInputHandler instance
   */
  static create(event?: S3Event, localConfig?: LocalConfig): FileInputHandler {
    try {
      // Determine execution mode based on available parameters
      if (event && event.Records && event.Records.length > 0) {
        console.log(`🏭 Creating S3FileInputHandler for AWS execution mode`);
        return new S3FileInputHandler(event);
      } else if (localConfig && localConfig.participationsCsvPath) {
        console.log(
          `🏭 Creating LocalFileInputHandler for local execution mode`,
        );
        return new LocalFileInputHandler(localConfig);
      } else {
        throw new Error(
          "Unable to determine execution mode: neither S3 event nor local config provided",
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`❌ Failed to create file input handler: ${errorMessage}`);
      throw new Error(`File input handler creation failed: ${errorMessage}`);
    }
  }

  /**
   * Detects execution mode based on available parameters
   * @param event S3 event (if running in AWS mode)
   * @param localConfig Local configuration (if running in local mode)
   * @returns ExecutionMode
   */
  static detectExecutionMode(
    event?: S3Event,
    localConfig?: LocalConfig,
  ): ExecutionMode {
    if (event && event.Records && event.Records.length > 0) {
      return "aws";
    } else if (localConfig && localConfig.participationsCsvPath) {
      return "local";
    } else {
      throw new Error(
        "Unable to determine execution mode: neither S3 event nor local config provided",
      );
    }
  }
}

/**
 * Utility function to create file input handler with comprehensive error handling
 * @param event S3 event (optional)
 * @param localConfig Local configuration (optional)
 * @returns FileInputHandler instance
 */
export function createFileInputHandler(
  event?: S3Event,
  localConfig?: LocalConfig,
): FileInputHandler {
  try {
    const handler = FileInputHandlerFactory.create(event, localConfig);
    const mode = handler.getExecutionMode();

    console.log(`✅ File input handler created successfully for ${mode} mode`);
    return handler;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `❌ Critical error creating file input handler: ${errorMessage}`,
    );

    // Provide helpful error messages for common issues
    if (!event && !localConfig) {
      throw new Error(
        "File input handler creation failed: No execution context provided. " +
          "Please provide either an S3 event for AWS mode or local config for local mode.",
      );
    }

    if (event && (!event.Records || event.Records.length === 0)) {
      throw new Error(
        "File input handler creation failed: S3 event provided but contains no records. " +
          "Please ensure the S3 event is properly formatted.",
      );
    }

    if (localConfig && !localConfig.participationsCsvPath) {
      throw new Error(
        "File input handler creation failed: Local config provided but missing participationsCsvPath. " +
          "Please provide a valid path to the participations CSV file.",
      );
    }

    throw error;
  }
}

/**
 * Validates file input handler configuration
 * @param event S3 event (optional)
 * @param localConfig Local configuration (optional)
 * @returns Validation result with detailed error information
 */
export function validateFileInputConfig(
  event?: S3Event,
  localConfig?: LocalConfig,
): { isValid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check if any configuration is provided
  if (!event && !localConfig) {
    errors.push(
      "No execution context provided (neither S3 event nor local config)",
    );
    return { isValid: false, errors, warnings };
  }

  // Validate S3 event if provided
  if (event) {
    if (!event.Records || event.Records.length === 0) {
      errors.push("S3 event provided but contains no records");
    } else {
      const record = event.Records[0];
      if (!record.s3?.bucket?.name) {
        errors.push("S3 event record missing bucket name");
      }
      if (!record.s3?.object?.key) {
        errors.push("S3 event record missing object key");
      }

      // Check for multiple records (warning)
      if (event.Records.length > 1) {
        warnings.push(
          `S3 event contains ${event.Records.length} records, only the first will be processed`,
        );
      }
    }
  }

  // Validate local config if provided
  if (localConfig) {
    if (!localConfig.participationsCsvPath) {
      errors.push("Local config provided but missing participationsCsvPath");
    } else {
      // Check if file exists (this is a warning since the file might be created later)
      if (!existsSync(localConfig.participationsCsvPath)) {
        warnings.push(
          `Participations CSV file does not exist: ${localConfig.participationsCsvPath}`,
        );
      }
    }

    if (localConfig.cctsCsvPath && !existsSync(localConfig.cctsCsvPath)) {
      warnings.push(`CCTs CSV file does not exist: ${localConfig.cctsCsvPath}`);
    }
  }

  // Check for conflicting configurations
  if (event && localConfig) {
    warnings.push(
      "Both S3 event and local config provided, S3 event will take precedence",
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}
