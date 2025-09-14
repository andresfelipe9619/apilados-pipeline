/**
 * Configuration management and execution mode detection
 * Handles both AWS Lambda and local execution environments
 */

import { S3Event } from "aws-lambda";
import { existsSync } from "fs";
import * as dotenv from "dotenv";
import {
  ConfigValidator,
  EnvironmentConfig,
  ExecutionMode,
  LocalConfig,
  ProcessingConfig,
  ValidationResult,
} from "./types";

/**
 * Detects execution mode based on event presence and environment
 */
export function detectExecutionMode(
  event?: S3Event,
  localConfig?: LocalConfig,
): ExecutionMode {
  // If we have an S3 event, we're definitely in AWS mode
  if (event && event.Records && event.Records.length > 0) {
    return "aws";
  }

  // If we have local config provided, we're in local mode
  if (localConfig) {
    return "local";
  }

  // Check for AWS Lambda environment variables
  if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_RUNTIME_DIR) {
    return "aws";
  }

  // Default to local mode for development
  return "local";
}

/**
 * Loads environment variables from .env file if it exists
 */
function loadDotEnv(): void {
  // Only load .env in non-AWS environments
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
    dotenv.config({ override: false }); // Don't override existing env vars
  }
}

/**
 * Loads environment configuration with validation
 */
export function loadEnvironmentConfig(): EnvironmentConfig {
  // Load .env file if in local mode
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
    loadDotEnv();
  }

  const config: EnvironmentConfig = {
    // Support both STRAPI_BASE_URL (new) and STRAPI_URL (migrator.js compatibility)
    strapiBaseUrl: process.env.STRAPI_BASE_URL || process.env.STRAPI_URL || "",
    strapiToken: process.env.STRAPI_TOKEN || "",
    processMode:
      process.env.PROCESS_MODE?.toLowerCase() === "sequential"
        ? "sequential"
        : "parallel",
    // Support both OMIT_GET (new) and OMMIT_GET (migrator.js compatibility - note the typo)
    omitGet:
      process.env.OMIT_GET === "true" || process.env.OMMIT_GET === "true",
    batchSize: Number(process.env.BATCH_SIZE) || 100,
    chunkSize: Number(process.env.CHUNK_SIZE) || 150,
  };

  return config;
}

/**
 * Creates processing configuration from environment and overrides
 */
export function createProcessingConfig(
  overrides?: Partial<ProcessingConfig>,
): ProcessingConfig {
  const envConfig = loadEnvironmentConfig();

  return {
    processMode: overrides?.processMode || envConfig.processMode,
    omitGet:
      overrides?.omitGet !== undefined ? overrides.omitGet : envConfig.omitGet,
    batchSize: overrides?.batchSize || envConfig.batchSize,
    chunkSize: overrides?.chunkSize || envConfig.chunkSize,
  };
}

/**
 * Configuration validator implementation
 */
export class DefaultConfigValidator implements ConfigValidator {
  validateEnvironmentConfig(
    config: Partial<EnvironmentConfig>,
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields
    if (!config.strapiBaseUrl) {
      errors.push("STRAPI_BASE_URL is required");
    } else if (!this.isValidUrl(config.strapiBaseUrl)) {
      errors.push("STRAPI_BASE_URL must be a valid URL");
    }

    if (!config.strapiToken) {
      errors.push("STRAPI_TOKEN is required");
    }

    // Optional field validation
    if (
      config.processMode &&
      !["parallel", "sequential"].includes(config.processMode)
    ) {
      errors.push("PROCESS_MODE must be either 'parallel' or 'sequential'");
    }

    if (config.batchSize && (config.batchSize < 1 || config.batchSize > 1000)) {
      warnings.push(
        "BATCH_SIZE should be between 1 and 1000 for optimal performance",
      );
    }

    if (config.chunkSize && (config.chunkSize < 1 || config.chunkSize > 1000)) {
      warnings.push(
        "CHUNK_SIZE should be between 1 and 1000 for optimal performance",
      );
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  validateLocalConfig(config: Partial<LocalConfig>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.participationsCsvPath) {
      errors.push("participationsCsvPath is required for local execution");
    } else if (!existsSync(config.participationsCsvPath)) {
      errors.push(
        `Participations CSV file not found: ${config.participationsCsvPath}`,
      );
    }

    if (config.cctsCsvPath && !existsSync(config.cctsCsvPath)) {
      warnings.push(
        `CCTs CSV file not found: ${config.cctsCsvPath} (will continue without CCTs)`,
      );
    }

    if (config.outputPath) {
      const outputDir = config.outputPath.substring(
        0,
        config.outputPath.lastIndexOf("/"),
      );
      if (outputDir && !existsSync(outputDir)) {
        errors.push(`Output directory does not exist: ${outputDir}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  validateProcessingConfig(
    config: Partial<ProcessingConfig>,
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (
      config.processMode &&
      !["parallel", "sequential"].includes(config.processMode)
    ) {
      errors.push("processMode must be either 'parallel' or 'sequential'");
    }

    if (config.batchSize && config.batchSize < 1) {
      errors.push("batchSize must be greater than 0");
    }

    if (config.chunkSize && config.chunkSize < 1) {
      errors.push("chunkSize must be greater than 0");
    }

    if (config.batchSize && config.batchSize > 1000) {
      warnings.push("Large batch sizes may cause memory issues");
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Validates complete configuration setup
 */
export function validateConfiguration(
  executionMode: ExecutionMode,
  envConfig?: EnvironmentConfig,
  localConfig?: LocalConfig,
  processingConfig?: ProcessingConfig,
): ValidationResult {
  const validator = new DefaultConfigValidator();
  const allErrors: string[] = [];
  const allWarnings: string[] = [];

  // Always validate environment config
  if (envConfig) {
    const envResult = validator.validateEnvironmentConfig(envConfig);
    allErrors.push(...envResult.errors);
    allWarnings.push(...envResult.warnings);
  }

  // Validate local config if in local mode
  if (executionMode === "local" && localConfig) {
    const localResult = validator.validateLocalConfig(localConfig);
    allErrors.push(...localResult.errors);
    allWarnings.push(...localResult.warnings);
  }

  // Validate processing config if provided
  if (processingConfig) {
    const procResult = validator.validateProcessingConfig(processingConfig);
    allErrors.push(...procResult.errors);
    allWarnings.push(...procResult.warnings);
  }

  return {
    isValid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}

/**
 * Logs configuration validation results
 */
export function logValidationResults(
  result: ValidationResult,
  context: string = "",
): void {
  const prefix = context ? `[${context}] ` : "";

  if (result.errors.length > 0) {
    console.error(`${prefix}Configuration validation failed:`);
    result.errors.forEach((error) => console.error(`  ❌ ${error}`));
  }

  if (result.warnings.length > 0) {
    console.warn(`${prefix}Configuration warnings:`);
    result.warnings.forEach((warning) => console.warn(`  ⚠️  ${warning}`));
  }

  if (result.isValid && result.warnings.length === 0) {
    console.log(`${prefix}Configuration validation passed ✅`);
  }
}

/**
 * Gets required environment variables with defaults
 */
export function getRequiredEnvironmentVariables(): string[] {
  return ["STRAPI_BASE_URL", "STRAPI_TOKEN"];
}

/**
 * Gets optional environment variables with their defaults
 * Includes backward compatibility with migrator.js variable names
 */
export function getOptionalEnvironmentVariables(): Record<string, string> {
  return {
    PROCESS_MODE: "parallel", // Processing mode: 'parallel' or 'sequential'
    OMIT_GET: "false", // Skip GET requests for performance (also supports OMMIT_GET for migrator.js compatibility)
    BATCH_SIZE: "100", // Number of records to process in each batch
    CHUNK_SIZE: "150", // S3 processing chunk size
    STRAPI_URL: "", // Alternative to STRAPI_BASE_URL for migrator.js compatibility
  };
}

/**
 * Gets all supported environment variables for documentation
 */
export function getAllSupportedEnvironmentVariables(): {
  required: string[];
  optional: Record<string, string>;
  migrator_compatibility: string[];
} {
  return {
    required: getRequiredEnvironmentVariables(),
    optional: getOptionalEnvironmentVariables(),
    migrator_compatibility: [
      "STRAPI_URL", // Alternative to STRAPI_BASE_URL
      "OMMIT_GET", // Alternative to OMIT_GET (note the typo in original migrator.js)
      "PARTICIPATIONS_CSV_FILE", // Used in local mode only
      "CCTS_CSV_FILE", // Used in local mode only
    ],
  };
}

/**
 * Creates LocalConfig from environment variables for migrator.js compatibility
 * This allows running the lambda locally using the same environment variables as migrator.js
 */
export function createLocalConfigFromEnv(): LocalConfig | null {
  // Load .env file if not in AWS environment
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
    loadDotEnv();
  }

  const participationsCsvPath = process.env.PARTICIPATIONS_CSV_FILE;

  if (!participationsCsvPath) {
    return null; // No local config available from environment
  }

  return {
    participationsCsvPath,
    cctsCsvPath: process.env.CCTS_CSV_FILE,
    outputPath: process.env.OUTPUT_PATH || "migration-errors.csv",
  };
}

/**
 * Detects if we should use local mode based on environment variables
 * This provides migrator.js compatibility
 */
export function shouldUseLocalMode(): boolean {
  // Load .env file if not in AWS environment
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
    loadDotEnv();
  }

  // If PARTICIPATIONS_CSV_FILE is set, we should use local mode
  return !!process.env.PARTICIPATIONS_CSV_FILE;
}
