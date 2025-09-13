/**
 * Utility functions for data transformation and processing
 * Migrated from migrator.js with enhanced TypeScript support
 */

import { Primitive } from "./types";

/**
 * Converts various input types to boolean values
 * Handles string representations like "true", "1", etc.
 * 
 * @param value - The value to convert to boolean
 * @returns boolean representation of the input
 */
export function toBoolean(value: unknown): boolean {
  if (typeof value !== "string") return !!value;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1";
}

/**
 * Normalizes CSV headers by removing accents, converting to lowercase,
 * and replacing non-alphanumeric characters with underscores
 * 
 * @param header - The header string to normalize
 * @returns normalized header string
 */
export function normalizeHeaders({ header }: { header: string }): string {
  return header
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Safely converts a value to a number, returning null for invalid inputs
 * 
 * @param value - The value to convert to number
 * @returns number or null if conversion fails
 */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  
  // Handle string values
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") {
      return null;
    }
    const num = Number(trimmed);
    return isNaN(num) ? null : num;
  }
  
  // Handle arrays and objects
  if (typeof value === "object") {
    return null;
  }
  
  const num = Number(value);
  return isNaN(num) ? null : num;
}

/**
 * Safely trims a string value, handling null/undefined inputs
 * 
 * @param value - The value to trim
 * @returns trimmed string or null if input is null/undefined
 */
export function safeTrim(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  
  return String(value).trim() || null;
}

/**
 * Checks if a string value should be treated as "not available"
 * Common patterns: "NA", "N/A", empty string, null, undefined
 * 
 * @param value - The value to check
 * @returns true if the value should be treated as NA
 */
export function isNotAvailable(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  
  if (typeof value === "string") {
    const trimmed = value.trim().toUpperCase();
    return trimmed === "" || trimmed === "NA" || trimmed === "N/A";
  }
  
  return false;
}

/**
 * Safely converts a value to string, handling null/undefined
 * 
 * @param value - The value to convert
 * @returns string representation or null for null/undefined inputs
 */
export function safeString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  
  return String(value);
}

/**
 * Creates a cache key from multiple string parts
 * Useful for creating consistent cache keys across the application
 * 
 * @param parts - Array of string parts to join
 * @param separator - Separator to use (default: "|")
 * @returns joined cache key
 */
export function createCacheKey(parts: (string | undefined)[], separator: string = "|"): string {
  return parts
    .filter(part => part !== undefined && part !== null)
    .map(part => String(part))
    .join(separator);
}

/**
 * Validates that all required fields are present in an object
 * 
 * @param obj - Object to validate
 * @param requiredFields - Array of required field names
 * @returns array of missing field names
 */
export function validateRequiredFields(
  obj: Record<string, unknown>, 
  requiredFields: string[]
): string[] {
  const missing: string[] = [];
  
  for (const field of requiredFields) {
    if (!(field in obj) || obj[field] === null || obj[field] === undefined) {
      missing.push(field);
    }
  }
  
  return missing;
}

/**
 * Safely extracts a primitive value from an object
 * 
 * @param obj - Source object
 * @param key - Key to extract
 * @param defaultValue - Default value if key is missing or invalid
 * @returns extracted value or default
 */
export function extractPrimitive<T extends Primitive>(
  obj: Record<string, unknown>,
  key: string,
  defaultValue: T
): T {
  const value = obj[key];
  
  if (value === null || value === undefined) {
    return defaultValue;
  }
  
  // Type guard for primitive values
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value as T;
  }
  
  return defaultValue;
}

/**
 * Formats an error message with context information
 * 
 * @param error - The error object or message
 * @param context - Additional context information
 * @returns formatted error message
 */
export function formatError(error: unknown, context?: Record<string, unknown>): string {
  let message = "Unknown error";
  
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else if (error && typeof error === "object") {
    // Handle Axios error format
    const axiosError = error as unknown;
    if (axiosError.response?.data?.error?.message) {
      message = axiosError.response.data.error.message;
    } else if (axiosError.message) {
      message = axiosError.message;
    } else {
      message = JSON.stringify(error);
    }
  }
  
  // Clean up message - remove newlines and extra spaces
  message = message.replace(/[\r\n]+/g, " ").trim();
  
  // Add context if provided
  if (context) {
    const contextStr = Object.entries(context)
      .map(([key, value]) => `${key}=${value}`)
      .join(", ");
    message = `${message} (Context: ${contextStr})`;
  }
  
  return message;
}

/**
 * Delays execution for a specified number of milliseconds
 * Useful for implementing retry delays
 * 
 * @param ms - Milliseconds to delay
 * @returns Promise that resolves after the delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Implements exponential backoff delay calculation
 * 
 * @param attempt - Current attempt number (0-based)
 * @param baseDelay - Base delay in milliseconds
 * @param maxDelay - Maximum delay in milliseconds
 * @returns calculated delay in milliseconds
 */
export function calculateBackoffDelay(
  attempt: number, 
  baseDelay: number = 1000, 
  maxDelay: number = 30000
): number {
  const delay = baseDelay * Math.pow(2, attempt);
  return Math.min(delay, maxDelay);
}