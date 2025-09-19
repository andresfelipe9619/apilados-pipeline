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
  EnvironmentType,
  EnhancedEnvironmentConfig,
  CCTsConfig,
  DatabaseConfig,
  DumpConfig,
  EventSimulationConfig,
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
 * Detects environment type (local vs production) based on various indicators
 * Uses multiple heuristics to determine the most likely environment type
 */
export function detectEnvironmentType(): EnvironmentType {
  const indicators = {
    production: 0,
    local: 0
  };

  // Check for explicit environment variable (highest priority)
  const envType = process.env.NODE_ENV?.toLowerCase();
  if (envType === "production" || envType === "prod") {
    indicators.production += 10;
  } else if (envType === "development" || envType === "dev" || envType === "local") {
    indicators.local += 10;
  }

  // Check for AWS Lambda environment (strong production indicator)
  if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_RUNTIME_DIR) {
    indicators.production += 8;
  }

  // Check for AWS region (moderate production indicator)
  if (process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION) {
    indicators.production += 5;
  }

  // Check for production-like database hosts
  const dbHost = process.env.DATABASE_HOST;
  if (dbHost) {
    if (dbHost.includes('.rds.amazonaws.com') || 
        dbHost.includes('.amazonaws.com') ||
        dbHost.includes('prod') ||
        dbHost.includes('production')) {
      indicators.production += 6;
    } else if (dbHost === 'localhost' || 
               dbHost === '127.0.0.1' || 
               dbHost.startsWith('192.168.') ||
               dbHost.startsWith('10.') ||
               dbHost.includes('local')) {
      indicators.local += 6;
    }
  }

  // Check for Strapi URL patterns
  const strapiUrl = process.env.STRAPI_BASE_URL || process.env.STRAPI_URL;
  if (strapiUrl) {
    if (strapiUrl.includes('localhost') || 
        strapiUrl.includes('127.0.0.1') ||
        strapiUrl.includes(':1337')) {
      indicators.local += 4;
    } else if (strapiUrl.includes('prod') || 
               strapiUrl.includes('production') ||
               strapiUrl.includes('.com') ||
               strapiUrl.includes('.net') ||
               strapiUrl.includes('.org')) {
      indicators.production += 4;
    }
  }

  // Check for local development files
  const { existsSync } = require('fs');
  const { join } = require('path');
  
  if (existsSync(join(process.cwd(), '.env'))) {
    indicators.local += 2;
  }
  
  if (existsSync(join(process.cwd(), 'package.json'))) {
    indicators.local += 1;
  }

  // Check for S3 bucket configuration (production indicator)
  if (process.env.S3_BUCKET || process.env.AWS_S3_BUCKET) {
    indicators.production += 3;
  }

  // Check for local CCTs file
  if (existsSync(join(process.cwd(), 'ccts_export.csv'))) {
    indicators.local += 3;
  }

  // Check for development-specific environment variables
  if (process.env.DEBUG === 'true' || process.env.VERBOSE === 'true') {
    indicators.local += 2;
  }

  // Check for CI/CD environment (neutral, but lean towards production)
  if (process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true') {
    indicators.production += 1;
  }

  // Determine environment based on indicators
  if (indicators.production > indicators.local) {
    return "production";
  } else if (indicators.local > indicators.production) {
    return "local";
  } else {
    // Tie-breaker: default to local for safety (less destructive operations)
    return "local";
  }
}

/**
 * Gets detailed environment detection information for debugging
 */
export function getEnvironmentDetectionDetails(): {
  detectedType: EnvironmentType;
  indicators: {
    production: { indicator: string; weight: number; present: boolean }[];
    local: { indicator: string; weight: number; present: boolean }[];
  };
  reasoning: string;
} {
  const detectedType = detectEnvironmentType();
  
  const productionIndicators = [
    { indicator: 'NODE_ENV=production', weight: 10, present: ['production', 'prod'].includes(process.env.NODE_ENV?.toLowerCase() || '') },
    { indicator: 'AWS Lambda environment', weight: 8, present: !!(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_RUNTIME_DIR) },
    { indicator: 'Production database host', weight: 6, present: !!(process.env.DATABASE_HOST && (
      process.env.DATABASE_HOST.includes('.rds.amazonaws.com') ||
      process.env.DATABASE_HOST.includes('.amazonaws.com') ||
      process.env.DATABASE_HOST.includes('prod') ||
      process.env.DATABASE_HOST.includes('production')
    )) },
    { indicator: 'AWS region configured', weight: 5, present: !!(process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION) },
    { indicator: 'Production Strapi URL', weight: 4, present: !!(process.env.STRAPI_BASE_URL || process.env.STRAPI_URL) && !(
      (process.env.STRAPI_BASE_URL || process.env.STRAPI_URL || '').includes('localhost') ||
      (process.env.STRAPI_BASE_URL || process.env.STRAPI_URL || '').includes('127.0.0.1') ||
      (process.env.STRAPI_BASE_URL || process.env.STRAPI_URL || '').includes(':1337')
    ) },
    { indicator: 'S3 bucket configured', weight: 3, present: !!(process.env.S3_BUCKET || process.env.AWS_S3_BUCKET) },
    { indicator: 'CI/CD environment', weight: 1, present: process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true' }
  ];

  const localIndicators = [
    { indicator: 'NODE_ENV=development/local', weight: 10, present: ['development', 'dev', 'local'].includes(process.env.NODE_ENV?.toLowerCase() || '') },
    { indicator: 'Local database host', weight: 6, present: !!(process.env.DATABASE_HOST && (
      process.env.DATABASE_HOST === 'localhost' ||
      process.env.DATABASE_HOST === '127.0.0.1' ||
      process.env.DATABASE_HOST.startsWith('192.168.') ||
      process.env.DATABASE_HOST.startsWith('10.') ||
      process.env.DATABASE_HOST.includes('local')
    )) },
    { indicator: 'Local Strapi URL', weight: 4, present: !!(process.env.STRAPI_BASE_URL || process.env.STRAPI_URL) && (
      (process.env.STRAPI_BASE_URL || process.env.STRAPI_URL || '').includes('localhost') ||
      (process.env.STRAPI_BASE_URL || process.env.STRAPI_URL || '').includes('127.0.0.1') ||
      (process.env.STRAPI_BASE_URL || process.env.STRAPI_URL || '').includes(':1337')
    ) },
    { indicator: 'Local CCTs file present', weight: 3, present: (() => {
      try {
        const { existsSync } = require('fs');
        const { join } = require('path');
        return existsSync(join(process.cwd(), 'ccts_export.csv'));
      } catch {
        return false;
      }
    })() },
    { indicator: '.env file present', weight: 2, present: (() => {
      try {
        const { existsSync } = require('fs');
        const { join } = require('path');
        return existsSync(join(process.cwd(), '.env'));
      } catch {
        return false;
      }
    })() },
    { indicator: 'Debug mode enabled', weight: 2, present: process.env.DEBUG === 'true' || process.env.VERBOSE === 'true' },
    { indicator: 'package.json present', weight: 1, present: (() => {
      try {
        const { existsSync } = require('fs');
        const { join } = require('path');
        return existsSync(join(process.cwd(), 'package.json'));
      } catch {
        return false;
      }
    })() }
  ];

  const prodScore = productionIndicators.filter(i => i.present).reduce((sum, i) => sum + i.weight, 0);
  const localScore = localIndicators.filter(i => i.present).reduce((sum, i) => sum + i.weight, 0);

  const reasoning = `Detected as ${detectedType} environment (Production score: ${prodScore}, Local score: ${localScore})`;

  return {
    detectedType,
    indicators: {
      production: productionIndicators,
      local: localIndicators
    },
    reasoning
  };
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
 * Loads enhanced environment configuration with database and CCTs support
 */
export function loadEnhancedEnvironmentConfig(): EnhancedEnvironmentConfig {
  // Load .env file if in local mode
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
    loadDotEnv();
  }

  const environmentType = detectEnvironmentType();
  const strapiConfig = loadEnvironmentConfig();
  
  // Load database configuration if available
  const { loadDatabaseConfig } = require('./database-config');
  const databaseConfig = loadDatabaseConfig();

  // Configure CCTs based on environment
  const cctsConfig: CCTsConfig = {
    environment: environmentType,
    isPerformanceOptimization: true,
  };

  if (environmentType === "local") {
    // In local environment, look for ccts_export.csv in project root
    const { existsSync } = require('fs');
    const { join } = require('path');
    const localCctsPath = join(process.cwd(), 'ccts_export.csv');
    
    if (existsSync(localCctsPath)) {
      cctsConfig.localPath = localCctsPath;
    } else if (process.env.CCTS_CSV_FILE) {
      cctsConfig.localPath = process.env.CCTS_CSV_FILE;
    }
  } else {
    // In production, use S3 configuration
    cctsConfig.s3Bucket = process.env.S3_BUCKET || process.env.AWS_S3_BUCKET;
    cctsConfig.s3Key = process.env.CCTS_S3_KEY || 'ccts/ccts_export.csv';
  }

  // AWS configuration for production
  const awsConfig = environmentType === "production" ? {
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
    bucket: process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || '',
  } : undefined;

  return {
    type: environmentType,
    strapi: strapiConfig,
    database: databaseConfig || undefined,
    ccts: cctsConfig,
    aws: awsConfig,
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

  validateDatabaseConfig(config: Partial<DatabaseConfig>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields
    if (!config.host) {
      errors.push("DATABASE_HOST is required for database operations");
    }

    if (!config.port) {
      errors.push("DATABASE_PORT is required for database operations");
    } else if (config.port < 1 || config.port > 65535) {
      errors.push("DATABASE_PORT must be between 1 and 65535");
    }

    if (!config.database) {
      errors.push("DATABASE_NAME is required for database operations");
    }

    if (!config.username) {
      errors.push("DATABASE_USERNAME is required for database operations");
    }

    if (!config.password) {
      errors.push("DATABASE_PASSWORD is required for database operations");
    }

    // Optional field validation
    if (config.ssl !== undefined && typeof config.ssl !== 'boolean') {
      warnings.push("DATABASE_SSL should be a boolean value (true/false)");
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  validateCCTsConfig(config: Partial<CCTsConfig>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.environment) {
      errors.push("CCTs environment type must be specified");
    }

    if (config.environment === "local") {
      if (!config.localPath) {
        warnings.push("No local CCTs file path specified - will continue without CCTs data");
      } else {
        const { existsSync } = require('fs');
        if (!existsSync(config.localPath)) {
          warnings.push(`CCTs file not found at ${config.localPath} - will continue without CCTs data`);
        }
      }
    } else if (config.environment === "production") {
      if (!config.s3Bucket) {
        warnings.push("S3 bucket not specified for CCTs data in production environment");
      }
      if (!config.s3Key) {
        warnings.push("S3 key not specified for CCTs data - using default path");
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  validateEnhancedEnvironmentConfig(config: Partial<EnhancedEnvironmentConfig>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate environment type
    if (!config.type) {
      errors.push("Environment type must be specified");
    } else if (!["local", "production"].includes(config.type)) {
      errors.push("Environment type must be either 'local' or 'production'");
    }

    // Validate Strapi configuration
    if (config.strapi) {
      const strapiResult = this.validateEnvironmentConfig(config.strapi);
      errors.push(...strapiResult.errors);
      warnings.push(...strapiResult.warnings);
    } else {
      errors.push("Strapi configuration is required");
    }

    // Validate database configuration if present
    if (config.database) {
      const dbResult = this.validateDatabaseConfig(config.database);
      errors.push(...dbResult.errors.map(err => `Database: ${err}`));
      warnings.push(...dbResult.warnings.map(warn => `Database: ${warn}`));
    } else if (config.type === "local") {
      warnings.push("Database configuration not available - database dump functionality will be disabled");
    }

    // Validate CCTs configuration
    if (config.ccts) {
      const cctsResult = this.validateCCTsConfig(config.ccts);
      errors.push(...cctsResult.errors.map(err => `CCTs: ${err}`));
      warnings.push(...cctsResult.warnings.map(warn => `CCTs: ${warn}`));
    } else {
      warnings.push("CCTs configuration not available");
    }

    // Validate AWS configuration for production
    if (config.type === "production") {
      if (!config.aws) {
        warnings.push("AWS configuration not available for production environment");
      } else {
        if (!config.aws.region) {
          warnings.push("AWS region not specified - using default");
        }
        if (!config.aws.bucket) {
          warnings.push("AWS S3 bucket not specified - some features may not work");
        }
      }
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

    // LocalConfig is now focused on dump operations only
    // CSV-related validation moved to EventSimulationConfig

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

  validateDumpConfig(config: Partial<DumpConfig>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.outputPath) {
      errors.push("Output path is required for dump operations");
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  validateEventSimulationConfig(config: Partial<EventSimulationConfig>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.csvFilePath) {
      errors.push("CSV file path is required for event simulation");
    } else if (!existsSync(config.csvFilePath)) {
      errors.push(`CSV event file not found: ${config.csvFilePath}`);
    }

    if (config.cctsFilePath && !existsSync(config.cctsFilePath)) {
      warnings.push(`CCTs performance optimization file not found: ${config.cctsFilePath} (will continue without performance optimization)`);
    }

    return { isValid: errors.length === 0, errors, warnings };
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
 * Validates enhanced environment configuration with database and CCTs support
 */
export function validateEnhancedConfiguration(
  enhancedConfig?: Partial<EnhancedEnvironmentConfig>,
  localConfig?: LocalConfig,
  processingConfig?: ProcessingConfig,
): ValidationResult {
  const validator = new DefaultConfigValidator();
  const allErrors: string[] = [];
  const allWarnings: string[] = [];

  // Validate enhanced environment config
  if (enhancedConfig) {
    const enhancedResult = validator.validateEnhancedEnvironmentConfig(enhancedConfig);
    allErrors.push(...enhancedResult.errors);
    allWarnings.push(...enhancedResult.warnings);
  } else {
    allErrors.push("Enhanced environment configuration is required");
  }

  // Validate local config if provided
  if (localConfig) {
    const localResult = validator.validateLocalConfig(localConfig);
    allErrors.push(...localResult.errors.map(err => `Local Config: ${err}`));
    allWarnings.push(...localResult.warnings.map(warn => `Local Config: ${warn}`));
  }

  // Validate processing config if provided
  if (processingConfig) {
    const procResult = validator.validateProcessingConfig(processingConfig);
    allErrors.push(...procResult.errors.map(err => `Processing Config: ${err}`));
    allWarnings.push(...procResult.warnings.map(warn => `Processing Config: ${warn}`));
  }

  return {
    isValid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}

/**
 * Enhanced environment validation with comprehensive checks
 * Validates all aspects of the environment including database and CCTs configuration
 */
export function validateCompleteEnvironment(): ValidationResult & {
  environmentType: EnvironmentType;
  configurationDetails: {
    strapi: ValidationResult;
    database: ValidationResult;
    ccts: ValidationResult;
    aws?: ValidationResult;
  };
} {
  const validator = new DefaultConfigValidator();
  const environmentType = detectEnvironmentType();
  const enhancedConfig = loadEnhancedEnvironmentConfig();
  
  // Validate each component separately for detailed feedback
  const strapiResult = validator.validateEnvironmentConfig(enhancedConfig.strapi);
  const databaseResult = enhancedConfig.database 
    ? validator.validateDatabaseConfig(enhancedConfig.database)
    : { isValid: false, errors: ["Database configuration not available"], warnings: [] };
  const cctsResult = validator.validateCCTsConfig(enhancedConfig.ccts);
  
  // AWS validation for production environments
  let awsResult: ValidationResult | undefined;
  if (environmentType === "production" && enhancedConfig.aws) {
    const awsErrors: string[] = [];
    const awsWarnings: string[] = [];
    
    if (!enhancedConfig.aws.region) {
      awsWarnings.push("AWS region not specified - using default");
    }
    if (!enhancedConfig.aws.bucket) {
      awsWarnings.push("AWS S3 bucket not specified - some features may not work");
    }
    
    awsResult = {
      isValid: awsErrors.length === 0,
      errors: awsErrors,
      warnings: awsWarnings
    };
  }

  // Combine all results
  const allErrors: string[] = [];
  const allWarnings: string[] = [];
  
  allErrors.push(...strapiResult.errors.map(err => `Strapi: ${err}`));
  allWarnings.push(...strapiResult.warnings.map(warn => `Strapi: ${warn}`));
  
  if (environmentType === "local" || enhancedConfig.database) {
    allErrors.push(...databaseResult.errors.map(err => `Database: ${err}`));
    allWarnings.push(...databaseResult.warnings.map(warn => `Database: ${warn}`));
  }
  
  allErrors.push(...cctsResult.errors.map(err => `CCTs: ${err}`));
  allWarnings.push(...cctsResult.warnings.map(warn => `CCTs: ${warn}`));
  
  if (awsResult) {
    allErrors.push(...awsResult.errors.map(err => `AWS: ${err}`));
    allWarnings.push(...awsResult.warnings.map(warn => `AWS: ${warn}`));
  }

  return {
    isValid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
    environmentType,
    configurationDetails: {
      strapi: strapiResult,
      database: databaseResult,
      ccts: cctsResult,
      aws: awsResult
    }
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

  // LocalConfig is now focused on dump operations
  // Always return a config for local operations

  return {
    outputPath: process.env.OUTPUT_PATH || "./dumps",
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

/**
 * Gets required environment variables for database dump functionality
 */
export function getRequiredDatabaseEnvironmentVariables(): string[] {
  return [
    "DATABASE_HOST",
    "DATABASE_PORT", 
    "DATABASE_NAME",
    "DATABASE_USERNAME",
    "DATABASE_PASSWORD"
  ];
}

/**
 * Validates environment configuration for specific operations
 * @param operation - The operation to validate for ('simulation', 'dump', 'all')
 * @param environmentType - Optional environment type (will be detected if not provided)
 */
export function validateEnvironmentForOperation(
  operation: 'migration' | 'dump' | 'all' = 'all',
  environmentType?: EnvironmentType
): ValidationResult & {
  environmentType: EnvironmentType;
  missingRequirements: string[];
  operationSupported: boolean;
} {
  const envType = environmentType || detectEnvironmentType();
  const enhancedConfig = loadEnhancedEnvironmentConfig();
  const validator = new DefaultConfigValidator();
  
  const allErrors: string[] = [];
  const allWarnings: string[] = [];
  const missingRequirements: string[] = [];
  
  // Always validate Strapi configuration
  const strapiResult = validator.validateEnvironmentConfig(enhancedConfig.strapi);
  allErrors.push(...strapiResult.errors);
  allWarnings.push(...strapiResult.warnings);
  
  if (!strapiResult.isValid) {
    missingRequirements.push('Strapi API configuration');
  }
  
  // Validate database configuration for dump operations
  if (operation === 'dump' || operation === 'all') {
    if (enhancedConfig.database) {
      const dbResult = validator.validateDatabaseConfig(enhancedConfig.database);
      allErrors.push(...dbResult.errors.map(err => `Database: ${err}`));
      allWarnings.push(...dbResult.warnings.map(warn => `Database: ${warn}`));
      
      if (!dbResult.isValid) {
        missingRequirements.push('Database configuration for dump operations');
      }
    } else {
      allErrors.push('Database configuration is required for dump operations');
      missingRequirements.push('Database configuration');
    }
  }
  
  // Validate CCTs configuration
  const cctsResult = validator.validateCCTsConfig(enhancedConfig.ccts);
  allWarnings.push(...cctsResult.warnings.map(warn => `CCTs: ${warn}`));
  
  // Validate AWS configuration for production
  if (envType === 'production') {
    if (!enhancedConfig.aws) {
      allWarnings.push('AWS configuration not available for production environment');
    } else {
      if (!enhancedConfig.aws.region) {
        allWarnings.push('AWS region not specified');
      }
      if (!enhancedConfig.aws.bucket && (operation === 'migration' || operation === 'all')) {
        allWarnings.push('AWS S3 bucket not specified - file operations may not work');
      }
    }
  }
  
  const operationSupported = missingRequirements.length === 0;
  
  return {
    isValid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
    environmentType: envType,
    missingRequirements,
    operationSupported
  };
}

/**
 * Gets configuration guidance for missing environment variables
 */
export function getConfigurationGuidance(environmentType: EnvironmentType): {
  required: { variable: string; description: string; example: string }[];
  optional: { variable: string; description: string; example: string; default: string }[];
  recommendations: string[];
} {
  const required = [
    {
      variable: "STRAPI_BASE_URL",
      description: "Base URL for your Strapi API",
      example: "http://localhost:1337/api"
    },
    {
      variable: "STRAPI_TOKEN",
      description: "Authentication token for Strapi API",
      example: "your_strapi_token_here"
    }
  ];

  const optional = [
    {
      variable: "PROCESS_MODE",
      description: "Processing mode for migration",
      example: "parallel",
      default: "parallel"
    },
    {
      variable: "OMIT_GET",
      description: "Skip GET requests for performance",
      example: "false",
      default: "false"
    },
    {
      variable: "BATCH_SIZE",
      description: "Number of records to process in each batch",
      example: "100",
      default: "100"
    },
    {
      variable: "CHUNK_SIZE",
      description: "Chunk size for S3 processing",
      example: "150",
      default: "150"
    }
  ];

  const recommendations: string[] = [];

  // Add database variables for dump functionality
  if (environmentType === "local") {
    required.push(
      {
        variable: "DATABASE_HOST",
        description: "Database host for dump operations",
        example: "localhost"
      },
      {
        variable: "DATABASE_PORT",
        description: "Database port",
        example: "5432"
      },
      {
        variable: "DATABASE_NAME",
        description: "Database name",
        example: "strapi_db"
      },
      {
        variable: "DATABASE_USERNAME",
        description: "Database username",
        example: "postgres"
      },
      {
        variable: "DATABASE_PASSWORD",
        description: "Database password",
        example: "your_password"
      }
    );

    optional.push({
      variable: "DATABASE_SSL",
      description: "Enable SSL for database connection",
      example: "false",
      default: "false"
    });

    recommendations.push(
      "Create a .env file in your project root with the required variables",
      "Place ccts_export.csv in your project root for automatic CCTs loading",
      "Use PROCESS_MODE=sequential for easier debugging",
      "Set OMIT_GET=true for faster testing (skips existence checks)"
    );
  } else {
    // Production environment
    optional.push(
      {
        variable: "AWS_REGION",
        description: "AWS region for S3 and other services",
        example: "us-east-1",
        default: "us-east-1"
      },
      {
        variable: "S3_BUCKET",
        description: "S3 bucket for file storage",
        example: "your-bucket-name",
        default: ""
      },
      {
        variable: "CCTS_S3_KEY",
        description: "S3 key for CCTs data file",
        example: "ccts/ccts_export.csv",
        default: "ccts/ccts_export.csv"
      }
    );

    recommendations.push(
      "Ensure AWS credentials are properly configured",
      "Set up S3 bucket permissions for file access",
      "Use environment variables or AWS Systems Manager for sensitive data",
      "Test database connectivity before running dumps in production"
    );
  }

  return { required, optional, recommendations };
}

/**
 * Generates helpful error messages for missing configuration
 */
export function generateConfigurationErrorMessage(
  validationResult: ValidationResult,
  environmentType: EnvironmentType
): string {
  if (validationResult.isValid) {
    return "Configuration is valid ✅";
  }

  const guidance = getConfigurationGuidance(environmentType);
  let message = `❌ Configuration validation failed for ${environmentType} environment:\n\n`;

  // Add errors with categorization
  if (validationResult.errors.length > 0) {
    message += "🚨 CRITICAL ERRORS (must be fixed):\n";
    validationResult.errors.forEach(error => {
      message += `  • ${error}\n`;
    });
    message += "\n";
  }

  // Add warnings with categorization
  if (validationResult.warnings.length > 0) {
    message += "⚠️  WARNINGS (recommended to fix):\n";
    validationResult.warnings.forEach(warning => {
      message += `  • ${warning}\n`;
    });
    message += "\n";
  }

  // Add configuration guidance with current status
  message += "📋 REQUIRED ENVIRONMENT VARIABLES:\n";
  guidance.required.forEach(({ variable, description, example }) => {
    const isSet = !!process.env[variable];
    const status = isSet ? "✅" : "❌";
    const currentValue = isSet ? (variable.includes('PASSWORD') || variable.includes('TOKEN') ? '[HIDDEN]' : process.env[variable]) : '[NOT SET]';
    message += `  ${status} ${variable}=${currentValue}\n`;
    message += `      Description: ${description}\n`;
    message += `      Example: ${example}\n\n`;
  });

  message += "⚙️  OPTIONAL ENVIRONMENT VARIABLES:\n";
  guidance.optional.forEach(({ variable, description, example, default: defaultValue }) => {
    const currentValue = process.env[variable] || defaultValue;
    const isDefault = !process.env[variable];
    const status = isDefault ? "🔧" : "✅";
    message += `  ${status} ${variable}=${currentValue}${isDefault ? ' (using default)' : ''}\n`;
    message += `      Description: ${description}\n`;
    message += `      Example: ${example}\n\n`;
  });

  // Add environment-specific setup instructions
  if (environmentType === "local") {
    message += "🏠 LOCAL DEVELOPMENT SETUP:\n";
    message += "  1. Create a .env file in your project root\n";
    message += "  2. Copy the required variables above into your .env file\n";
    message += "  3. Replace example values with your actual configuration\n";
    message += "  4. Ensure your database is running and accessible\n";
    message += "  5. Place ccts_export.csv in project root for automatic loading\n\n";
  } else {
    message += "☁️  PRODUCTION DEPLOYMENT SETUP:\n";
    message += "  1. Set environment variables in your deployment platform\n";
    message += "  2. Ensure AWS credentials are properly configured\n";
    message += "  3. Verify S3 bucket permissions and accessibility\n";
    message += "  4. Test database connectivity from your deployment environment\n";
    message += "  5. Upload CCTs data to S3 at the specified key\n\n";
  }

  if (guidance.recommendations.length > 0) {
    message += "💡 RECOMMENDATIONS:\n";
    guidance.recommendations.forEach(rec => {
      message += `  • ${rec}\n`;
    });
    message += "\n";
  }

  // Add troubleshooting section with enhanced recovery suggestions
  message += "🔧 TROUBLESHOOTING:\n";
  message += "  • Run 'migration-cli validate' to check your configuration\n";
  message += "  • Use 'migration-cli env' to see current environment status\n";
  message += "  • Try 'migration-cli quick' to test with sample data\n";
  message += "  • Check the logs for specific error details\n";
  message += "  • Ensure all services (database, Strapi) are running\n";
  
  // Add specific recovery suggestions based on error types
  if (validationResult.errors.some(err => err.includes('STRAPI'))) {
    message += "\n🔗 STRAPI CONNECTION ISSUES:\n";
    message += "  • Verify Strapi server is running (usually on port 1337)\n";
    message += "  • Check STRAPI_BASE_URL format (e.g., http://localhost:1337)\n";
    message += "  • Ensure STRAPI_TOKEN is valid and has proper permissions\n";
    message += "  • Test connection: curl -H 'Authorization: Bearer YOUR_TOKEN' YOUR_BASE_URL/api/users\n";
  }
  
  if (validationResult.errors.some(err => err.includes('DATABASE'))) {
    message += "\n🗄️  DATABASE CONNECTION ISSUES:\n";
    message += "  • Verify PostgreSQL server is running\n";
    message += "  • Check DATABASE_HOST and DATABASE_PORT are correct\n";
    message += "  • Ensure DATABASE_NAME exists on the server\n";
    message += "  • Verify DATABASE_USERNAME has proper permissions\n";
    message += "  • Test connection: psql -h HOST -p PORT -U USERNAME -d DATABASE\n";
  }
  
  if (validationResult.errors.some(err => err.includes('CCTs') || err.includes('CSV'))) {
    message += "\n📄 FILE ACCESS ISSUES:\n";
    message += "  • Check file paths are correct and accessible\n";
    message += "  • Ensure CSV files have proper format and headers\n";
    message += "  • Verify file permissions allow reading\n";
    message += "  • For S3 files, check AWS credentials and bucket permissions\n";
  }

  return message;
}

/**
 * Provides a quick environment status check for CLI commands
 * @param operation - The operation to check for
 * @returns Quick status with actionable information
 */
export function getEnvironmentStatus(operation: 'migration' | 'dump' | 'all' = 'all'): {
  ready: boolean;
  environmentType: EnvironmentType;
  status: 'ready' | 'warning' | 'error';
  message: string;
  quickFixes: string[];
} {
  const validation = validateEnvironmentForOperation(operation);
  const detectionDetails = getEnvironmentDetectionDetails();
  
  let status: 'ready' | 'warning' | 'error';
  let message: string;
  const quickFixes: string[] = [];
  
  if (validation.isValid && validation.operationSupported) {
    status = 'ready';
    message = `✅ Environment is ready for ${operation} operations`;
  } else if (validation.operationSupported && validation.warnings.length > 0) {
    status = 'warning';
    message = `⚠️  Environment has warnings but can perform ${operation} operations`;
    quickFixes.push('Review warnings and consider fixing them for optimal performance');
  } else {
    status = 'error';
    message = `❌ Environment is not ready for ${operation} operations`;
    
    // Add specific quick fixes based on missing requirements
    validation.missingRequirements.forEach(requirement => {
      if (requirement.includes('Strapi')) {
        quickFixes.push('Set STRAPI_BASE_URL and STRAPI_TOKEN environment variables');
      }
      if (requirement.includes('Database')) {
        quickFixes.push('Configure database environment variables (DATABASE_HOST, DATABASE_PORT, etc.)');
      }
    });
    
    if (validation.environmentType === 'local' && !process.env.STRAPI_BASE_URL) {
      quickFixes.push('Create a .env file with required configuration');
    }
  }
  
  return {
    ready: validation.operationSupported,
    environmentType: validation.environmentType,
    status,
    message,
    quickFixes
  };
}

/**
 * Logs environment status in a user-friendly format
 * @param operation - The operation to check for
 */
export function logEnvironmentStatus(operation: 'migration' | 'dump' | 'all' = 'all'): void {
  const status = getEnvironmentStatus(operation);
  
  console.log(`\n🌍 Environment Status for ${operation} operations:`);
  console.log(`   Type: ${status.environmentType}`);
  console.log(`   ${status.message}`);
  
  if (status.quickFixes.length > 0) {
    console.log('\n🔧 Quick fixes:');
    status.quickFixes.forEach(fix => {
      console.log(`   • ${fix}`);
    });
  }
  
  if (status.status === 'error') {
    console.log('\n💡 Run with --help for detailed configuration guidance');
  }
  
  console.log(''); // Empty line for spacing
}
