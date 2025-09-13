/**
 * Example usage of configuration management and execution mode detection
 * This file demonstrates how to use the configuration system in both AWS and local modes
 */

import { S3Event } from "aws-lambda";
import {
  detectExecutionMode,
  loadEnvironmentConfig,
  createProcessingConfig,
  validateConfiguration,
  logValidationResults
} from "./config";
import { LocalConfig } from "./types";

/**
 * Example: AWS Lambda execution
 */
export function exampleAwsExecution(event: S3Event) {
  console.log("=== AWS Lambda Execution Example ===");
  
  // Detect execution mode
  const executionMode = detectExecutionMode(event);
  console.log(`Execution mode: ${executionMode}`);
  
  // Load environment configuration
  const envConfig = loadEnvironmentConfig();
  console.log("Environment config:", {
    strapiBaseUrl: envConfig.strapiBaseUrl ? "[CONFIGURED]" : "[MISSING]",
    strapiToken: envConfig.strapiToken ? "[CONFIGURED]" : "[MISSING]",
    processMode: envConfig.processMode,
    omitGet: envConfig.omitGet,
    batchSize: envConfig.batchSize,
    chunkSize: envConfig.chunkSize
  });
  
  // Create processing configuration
  const processingConfig = createProcessingConfig();
  console.log("Processing config:", processingConfig);
  
  // Validate configuration
  const validation = validateConfiguration(executionMode, envConfig, undefined, processingConfig);
  logValidationResults(validation, "AWS Execution");
  
  return { executionMode, envConfig, processingConfig, validation };
}

/**
 * Example: Local development execution
 */
export function exampleLocalExecution() {
  console.log("=== Local Development Execution Example ===");
  
  // Define local configuration
  const localConfig: LocalConfig = {
    participationsCsvPath: "./test-data/sample.csv",
    cctsCsvPath: "./test-data/ccts.csv",
    outputPath: "./output/results.csv"
  };
  
  // Detect execution mode
  const executionMode = detectExecutionMode(undefined, localConfig);
  console.log(`Execution mode: ${executionMode}`);
  
  // Load environment configuration (will try to load from .env)
  const envConfig = loadEnvironmentConfig();
  console.log("Environment config:", {
    strapiBaseUrl: envConfig.strapiBaseUrl ? "[CONFIGURED]" : "[MISSING]",
    strapiToken: envConfig.strapiToken ? "[CONFIGURED]" : "[MISSING]",
    processMode: envConfig.processMode,
    omitGet: envConfig.omitGet,
    batchSize: envConfig.batchSize,
    chunkSize: envConfig.chunkSize
  });
  
  // Create processing configuration with local overrides
  const processingConfig = createProcessingConfig({
    processMode: "sequential", // Use sequential for local testing
    batchSize: 10 // Smaller batches for local testing
  });
  console.log("Processing config:", processingConfig);
  
  // Validate complete configuration
  const validation = validateConfiguration(executionMode, envConfig, localConfig, processingConfig);
  logValidationResults(validation, "Local Execution");
  
  return { executionMode, envConfig, localConfig, processingConfig, validation };
}

/**
 * Example: Configuration validation scenarios
 */
export function exampleConfigurationValidation() {
  console.log("=== Configuration Validation Examples ===");
  
  // Example 1: Valid configuration
  console.log("\n1. Valid configuration:");
  const validResult = exampleLocalExecution();
  
  // Example 2: Missing required environment variables
  console.log("\n2. Missing required environment variables:");
  const originalEnv = { ...process.env };
  delete process.env.STRAPI_BASE_URL;
  delete process.env.STRAPI_TOKEN;
  
  const invalidEnvConfig = loadEnvironmentConfig();
  const invalidValidation = validateConfiguration("local", invalidEnvConfig);
  logValidationResults(invalidValidation, "Invalid Environment");
  
  // Restore environment
  process.env = originalEnv;
  
  // Example 3: Invalid local file paths
  console.log("\n3. Invalid local file paths:");
  const invalidLocalConfig: LocalConfig = {
    participationsCsvPath: "./nonexistent/file.csv",
    cctsCsvPath: "./nonexistent/ccts.csv"
  };
  
  const invalidLocalValidation = validateConfiguration("local", validResult.envConfig, invalidLocalConfig);
  logValidationResults(invalidLocalValidation, "Invalid Local Config");
}

// Run examples if this file is executed directly
if (require.main === module) {
  console.log("Running configuration examples...\n");
  
  try {
    exampleLocalExecution();
    console.log("\n" + "=".repeat(50) + "\n");
    exampleConfigurationValidation();
  } catch (error) {
    console.error("Error running examples:", error);
  }
}