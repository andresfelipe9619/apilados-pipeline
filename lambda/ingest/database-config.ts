/**
 * Database configuration utilities
 * Handles loading and validation of database configuration from environment variables
 */

import * as dotenv from "dotenv";
import { DatabaseConfig, ValidationResult } from "./types";

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
 * Gets required database environment variables
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
 * Gets optional database environment variables with their defaults
 */
export function getOptionalDatabaseEnvironmentVariables(): Record<string, string> {
  return {
    DATABASE_SSL: "false", // Enable SSL connection to database
  };
}

/**
 * Loads database configuration from environment variables
 */
export function loadDatabaseConfig(): DatabaseConfig | null {
  // Load .env file if in local mode
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
    loadDotEnv();
  }

  // Check if all required database variables are present
  const requiredVars = getRequiredDatabaseEnvironmentVariables();
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    return null; // Database configuration not available
  }

  return {
    host: process.env.DATABASE_HOST!,
    port: parseInt(process.env.DATABASE_PORT!),
    database: process.env.DATABASE_NAME!,
    username: process.env.DATABASE_USERNAME!,
    password: process.env.DATABASE_PASSWORD!,
    ssl: process.env.DATABASE_SSL === 'true'
  };
}

/**
 * Validates database configuration
 */
export function validateDatabaseConfig(config: Partial<DatabaseConfig>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!config.host) {
    errors.push("DATABASE_HOST is required");
  }

  if (!config.port) {
    errors.push("DATABASE_PORT is required");
  } else if (config.port < 1 || config.port > 65535) {
    errors.push("DATABASE_PORT must be between 1 and 65535");
  }

  if (!config.database) {
    errors.push("DATABASE_NAME is required");
  }

  if (!config.username) {
    errors.push("DATABASE_USERNAME is required");
  }

  if (!config.password) {
    errors.push("DATABASE_PASSWORD is required");
  }

  // Optional field validation
  if (config.ssl !== undefined && typeof config.ssl !== 'boolean') {
    warnings.push("DATABASE_SSL should be a boolean value");
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validates database environment variables
 */
export function validateDatabaseEnvironmentVariables(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required variables
  const required = getRequiredDatabaseEnvironmentVariables();
  const missing = required.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    errors.push(`Missing required database environment variables: ${missing.join(', ')}`);
  }

  // Validate port number
  if (process.env.DATABASE_PORT) {
    const port = parseInt(process.env.DATABASE_PORT);
    if (isNaN(port) || port < 1 || port > 65535) {
      errors.push('DATABASE_PORT must be a valid port number (1-65535)');
    }
  }

  // Validate SSL setting
  if (process.env.DATABASE_SSL && !['true', 'false'].includes(process.env.DATABASE_SSL)) {
    warnings.push('DATABASE_SSL should be either "true" or "false"');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}