/**
 * Memory-efficient CCTs data management for production environments
 * Handles CCTs data retrieval, validation, and on-demand creation
 */

import { Readable } from "node:stream";
import { AxiosInstance } from "axios";
import csvParser from "csv-parser";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { 
  CCTsConfig, 
  EnvironmentType, 
  StrapiEntity, 
  StrapiListResponse,
  ProcessingConfig 
} from "./types";
import { formatError, normalizeHeaders } from "./utils";

export interface CCTsRecord {
  id: number;
  clave: string;
}

export interface CCTsValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  recordCount?: number;
  estimatedMemoryUsage?: number;
}

export interface CCTsPerformanceMetrics {
  loadingTime: number;
  memoryUsage: number;
  recordCount: number;
  cacheHitRate?: number;
  apiCallsSaved?: number;
}

export interface CCTsManagerConfig {
  environment: EnvironmentType;
  usePreloading: boolean;
  maxMemoryUsageMB: number;
  s3Config?: {
    bucket: string;
    key: string;
    region?: string;
  };
  localPath?: string;
  enablePerformanceTracking: boolean;
}

/**
 * Memory-efficient CCTs manager that supports both pre-loading and on-demand creation
 */
export class CCTsManager {
  private api: AxiosInstance;
  private config: CCTsManagerConfig;
  private s3Client?: S3Client;
  private cctsCache: Map<string, number> = new Map();
  private performanceMetrics: CCTsPerformanceMetrics;
  private isInitialized = false;
  private useOnDemandMode = false;

  constructor(api: AxiosInstance, config: CCTsManagerConfig) {
    this.api = api;
    this.config = config;
    
    if (config.s3Config) {
      this.s3Client = new S3Client({ 
        region: config.s3Config.region || process.env.AWS_REGION 
      });
    }

    this.performanceMetrics = {
      loadingTime: 0,
      memoryUsage: 0,
      recordCount: 0,
      cacheHitRate: 0,
      apiCallsSaved: 0,
    };
  }

  /**
   * Initialize CCTs manager based on configuration and memory constraints
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    console.log("[CCTs] Initializing CCTs manager...");
    const startTime = Date.now();

    try {
      // Detect CCTs data availability
      const availability = await this.detectCCTsAvailability();
      
      if (!availability.isAvailable) {
        console.log("[CCTs] No CCTs data available, using on-demand mode");
        this.useOnDemandMode = true;
        this.isInitialized = true;
        return;
      }

      // Validate CCTs data format and estimate memory usage
      const validation = await this.validateCCTsData();
      
      if (!validation.isValid) {
        console.warn("[CCTs] CCTs data validation failed:", validation.errors);
        this.useOnDemandMode = true;
        this.isInitialized = true;
        return;
      }

      // Check if we should use pre-loading or on-demand mode
      const shouldUsePreloading = this.shouldUsePreloading(validation);
      
      if (shouldUsePreloading && this.config.usePreloading) {
        console.log("[CCTs] Using pre-loading mode");
        await this.preloadCCTsData();
      } else {
        console.log("[CCTs] Using on-demand mode due to memory constraints");
        this.useOnDemandMode = true;
      }

      this.performanceMetrics.loadingTime = Date.now() - startTime;
      this.isInitialized = true;

      console.log(`[CCTs] Initialization completed in ${this.performanceMetrics.loadingTime}ms`);
      console.log(`[CCTs] Mode: ${this.useOnDemandMode ? 'on-demand' : 'pre-loaded'}`);
      console.log(`[CCTs] Records available: ${this.performanceMetrics.recordCount}`);
      
    } catch (error) {
      console.warn("[CCTs] Failed to initialize CCTs manager:", formatError(error));
      this.useOnDemandMode = true;
      this.isInitialized = true;
    }
  }

  /**
   * Get or create CCT record with memory-efficient approach
   */
  async getOrCreateCCT(clave: string): Promise<number | null> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Check cache first (works for both pre-loaded and on-demand modes)
    if (this.cctsCache.has(clave)) {
      if (this.config.enablePerformanceTracking) {
        this.performanceMetrics.apiCallsSaved = (this.performanceMetrics.apiCallsSaved || 0) + 1;
      }
      const cachedValue = this.cctsCache.get(clave)!;
      // Return null for negative cached results (marked as -1)
      return cachedValue === -1 ? null : cachedValue;
    }

    // On-demand mode: try to fetch from Strapi API
    if (this.useOnDemandMode) {
      return await this.fetchAndCacheCCT(clave);
    }

    // Pre-loaded mode: if not in cache, it doesn't exist
    return null;
  }

  /**
   * Detect if CCTs data is available from configured sources
   */
  private async detectCCTsAvailability(): Promise<{ isAvailable: boolean; source: string }> {
    // Check S3 source
    if (this.config.s3Config && this.s3Client) {
      try {
        const command = new GetObjectCommand({
          Bucket: this.config.s3Config.bucket,
          Key: this.config.s3Config.key,
        });
        
        const response = await this.s3Client.send(command);
        if (response.Body) {
          console.log(`[CCTs] Found CCTs data in S3: s3://${this.config.s3Config.bucket}/${this.config.s3Config.key}`);
          return { isAvailable: true, source: 's3' };
        }
      } catch (error) {
        console.log(`[CCTs] S3 CCTs data not accessible: ${formatError(error)}`);
      }
    }

    // Check local file source
    if (this.config.localPath) {
      const fs = require('fs');
      if (fs.existsSync(this.config.localPath)) {
        console.log(`[CCTs] Found CCTs data locally: ${this.config.localPath}`);
        return { isAvailable: true, source: 'local' };
      } else {
        console.log(`[CCTs] Local CCTs file not found: ${this.config.localPath}`);
      }
    }

    return { isAvailable: false, source: 'none' };
  }

  /**
   * Validate CCTs data format and estimate memory usage
   */
  private async validateCCTsData(): Promise<CCTsValidationResult> {
    console.log("[CCTs] Validating CCTs data format...");
    
    try {
      const stream = await this.getCCTsStream();
      if (!stream) {
        return {
          isValid: false,
          errors: ["No CCTs data stream available"],
          warnings: [],
        };
      }

      return new Promise((resolve) => {
        const errors: string[] = [];
        const warnings: string[] = [];
        let recordCount = 0;
        let hasValidHeader = false;
        let sampleRecords: any[] = [];

        stream
          .pipe(csvParser({ mapHeaders: normalizeHeaders }))
          .on("data", (row: any) => {
            recordCount++;

            // Validate header on first row
            if (recordCount === 1) {
              if (!row.id || !row.clave) {
                errors.push("Missing required columns: 'id' and 'clave'");
              } else {
                hasValidHeader = true;
              }
            }

            // Collect sample records for validation
            if (sampleRecords.length < 10) {
              sampleRecords.push(row);
            }

            // Validate record format
            if (hasValidHeader) {
              if (!row.id || !row.clave) {
                if (errors.length < 5) { // Limit error messages
                  errors.push(`Record ${recordCount}: Missing id or clave`);
                }
              }

              const id = parseInt(row.id);
              if (isNaN(id)) {
                if (errors.length < 5) {
                  errors.push(`Record ${recordCount}: Invalid id format`);
                }
              }
            }

            // Memory usage estimation (every 10k records)
            if (recordCount % 10000 === 0) {
              const currentMemory = process.memoryUsage().heapUsed / 1024 / 1024;
              console.log(`[CCTs] Validation progress: ${recordCount} records, Memory: ${Math.round(currentMemory)}MB`);
            }
          })
          .on("end", () => {
            // Estimate memory usage for full dataset
            const estimatedMemoryUsage = this.estimateMemoryUsage(recordCount);
            

            
            if (estimatedMemoryUsage > this.config.maxMemoryUsageMB) {
              warnings.push(
                `Estimated memory usage (${estimatedMemoryUsage}MB) exceeds limit (${this.config.maxMemoryUsageMB}MB)`
              );
            }

            console.log(`[CCTs] Validation completed: ${recordCount} records found`);
            
            resolve({
              isValid: errors.length === 0,
              errors,
              warnings,
              recordCount,
              estimatedMemoryUsage,
            });
          })
          .on("error", (error) => {
            resolve({
              isValid: false,
              errors: [`Stream processing error: ${formatError(error)}`],
              warnings,
            });
          });
      });
    } catch (error) {
      return {
        isValid: false,
        errors: [`Validation error: ${formatError(error)}`],
        warnings: [],
      };
    }
  }

  /**
   * Determine if pre-loading should be used based on validation results
   */
  private shouldUsePreloading(validation: CCTsValidationResult): boolean {
    if (!validation.isValid) {
      return false;
    }

    if (validation.estimatedMemoryUsage === undefined || !validation.recordCount) {
      return false;
    }

    // Don't pre-load if estimated memory usage exceeds limit
    if (validation.estimatedMemoryUsage > this.config.maxMemoryUsageMB) {
      console.log(
        `[CCTs] Pre-loading disabled: estimated memory usage (${validation.estimatedMemoryUsage}MB) ` +
        `exceeds limit (${this.config.maxMemoryUsageMB}MB)`
      );
      return false;
    }

    // Don't pre-load if record count is too high (fallback check)
    if (validation.recordCount > 100000) {
      console.log(
        `[CCTs] Pre-loading disabled: record count (${validation.recordCount}) too high for memory`
      );
      return false;
    }

    return true;
  }

  /**
   * Pre-load all CCTs data into memory cache
   */
  private async preloadCCTsData(): Promise<void> {
    console.log("[CCTs] Pre-loading CCTs data into memory...");
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;

    try {
      const stream = await this.getCCTsStream();
      if (!stream) {
        throw new Error("No CCTs data stream available for pre-loading");
      }

      let recordCount = 0;

      await new Promise<void>((resolve, reject) => {
        stream
          .pipe(csvParser({ mapHeaders: normalizeHeaders }))
          .on("data", (row: any) => {
            if (row.id && row.clave) {
              const id = parseInt(row.id);
              if (!isNaN(id)) {
                this.cctsCache.set(row.clave, id);
                recordCount++;
              }
            }

            // Progress reporting
            if (recordCount % 10000 === 0) {
              const currentMemory = process.memoryUsage().heapUsed / 1024 / 1024;
              console.log(`[CCTs] Pre-loading progress: ${recordCount} records, Memory: ${Math.round(currentMemory)}MB`);
            }
          })
          .on("end", resolve)
          .on("error", reject);
      });

      const endMemory = process.memoryUsage().heapUsed;
      const memoryUsed = (endMemory - startMemory) / 1024 / 1024;
      const loadingTime = Date.now() - startTime;

      this.performanceMetrics = {
        loadingTime,
        memoryUsage: memoryUsed,
        recordCount,
        cacheHitRate: 0,
        apiCallsSaved: 0,
      };

      console.log(`[CCTs] Pre-loading completed: ${recordCount} records in ${loadingTime}ms`);
      console.log(`[CCTs] Memory used: ${Math.round(memoryUsed)}MB`);
      
    } catch (error) {
      console.error("[CCTs] Pre-loading failed:", formatError(error));
      throw error;
    }
  }

  /**
   * Fetch CCT from Strapi API and cache it
   */
  private async fetchAndCacheCCT(clave: string): Promise<number | null> {
    try {
      const response = await this.api.get<StrapiListResponse<StrapiEntity>>(
        `/ccts?filters[clave][$eq]=${encodeURIComponent(clave)}&pagination[limit]=1`
      );

      if (response.data.data.length > 0) {
        const cctId = response.data.data[0].id;
        this.cctsCache.set(clave, cctId);
        return cctId;
      }

      // Cache negative result to avoid repeated API calls
      // Use a special marker for negative results that won't be returned
      this.cctsCache.set(clave, -1);
      return null;
      
    } catch (error) {
      console.warn(`[CCTs] Failed to fetch CCT ${clave}:`, formatError(error));
      return null;
    }
  }

  /**
   * Get CCTs data stream from configured source
   */
  private async getCCTsStream(): Promise<Readable | null> {
    // Try S3 source first
    if (this.config.s3Config && this.s3Client) {
      try {
        const command = new GetObjectCommand({
          Bucket: this.config.s3Config.bucket,
          Key: this.config.s3Config.key,
        });
        
        const response = await this.s3Client.send(command);
        if (response.Body) {
          return response.Body as Readable;
        }
      } catch (error) {
        console.log(`[CCTs] Failed to get S3 stream: ${formatError(error)}`);
      }
    }

    // Try local file source
    if (this.config.localPath) {
      try {
        const fs = require('fs');
        if (fs.existsSync(this.config.localPath)) {
            return fs.createReadStream(this.config.localPath, { encoding: 'utf8' });
        }
      } catch (error) {
        console.log(`[CCTs] Failed to get local file stream: ${formatError(error)}`);
      }
    }

    return null;
  }

  /**
   * Estimate memory usage for given record count
   */
  private estimateMemoryUsage(recordCount: number): number {
    // Estimate: each CCT record uses approximately 100 bytes in memory
    // (string key ~20 bytes + number value ~8 bytes + Map overhead ~72 bytes)
    const bytesPerRecord = 100;
    const totalBytes = recordCount * bytesPerRecord;
    return Math.round(totalBytes / 1024 / 1024); // Convert to MB
  }

  /**
   * Get current performance metrics
   */
  getPerformanceMetrics(): CCTsPerformanceMetrics {
    if (this.config.enablePerformanceTracking && this.cctsCache.size > 0) {
      // Calculate cache hit rate
      const totalRequests = (this.performanceMetrics.apiCallsSaved || 0) + this.cctsCache.size;
      this.performanceMetrics.cacheHitRate = totalRequests > 0 
        ? (this.performanceMetrics.apiCallsSaved || 0) / totalRequests 
        : 0;
    }

    return { ...this.performanceMetrics };
  }

  /**
   * Get current cache statistics
   */
  getCacheStats(): { size: number; mode: string; isInitialized: boolean } {
    return {
      size: this.cctsCache.size,
      mode: this.useOnDemandMode ? 'on-demand' : 'pre-loaded',
      isInitialized: this.isInitialized,
    };
  }

  /**
   * Clear cache and reset state
   */
  reset(): void {
    this.cctsCache.clear();
    this.isInitialized = false;
    this.useOnDemandMode = false;
    this.performanceMetrics = {
      loadingTime: 0,
      memoryUsage: 0,
      recordCount: 0,
      cacheHitRate: 0,
      apiCallsSaved: 0,
    };
  }

  /**
   * Check if CCTs manager is using on-demand mode
   */
  isUsingOnDemandMode(): boolean {
    return this.useOnDemandMode;
  }

  /**
   * Get configuration summary for debugging
   */
  getConfigSummary(): Record<string, any> {
    return {
      environment: this.config.environment,
      usePreloading: this.config.usePreloading,
      maxMemoryUsageMB: this.config.maxMemoryUsageMB,
      hasS3Config: !!this.config.s3Config,
      hasLocalPath: !!this.config.localPath,
      enablePerformanceTracking: this.config.enablePerformanceTracking,
      currentMode: this.useOnDemandMode ? 'on-demand' : 'pre-loaded',
      isInitialized: this.isInitialized,
    };
  }
}

/**
 * Factory function to create CCTsManager with environment-specific configuration
 */
export function createCCTsManager(
  api: AxiosInstance,
  environment: EnvironmentType,
  processingConfig: ProcessingConfig,
  customConfig?: Partial<CCTsManagerConfig>
): CCTsManager {
  const defaultConfig: CCTsManagerConfig = {
    environment,
    usePreloading: environment === 'local', // Default to pre-loading for local, on-demand for production
    maxMemoryUsageMB: environment === 'production' ? 512 : 1024, // Conservative limit for production
    enablePerformanceTracking: true,
  };

  // Add S3 configuration for production environment
  if (environment === 'production') {
    const s3Bucket = process.env.CCTS_S3_BUCKET || process.env.BUCKET_NAME;
    const s3Key = process.env.CCTS_S3_KEY || 'ccts_export.csv';
    
    if (s3Bucket) {
      defaultConfig.s3Config = {
        bucket: s3Bucket,
        key: s3Key,
        region: process.env.AWS_REGION,
      };
    }
  }

  // Add local path configuration
  if (environment === 'local') {
    defaultConfig.localPath = process.env.CCTS_LOCAL_PATH || process.env.CCTS_CSV_FILE || './ccts_export.csv';
  }

  // Override configuration with environment variables
  if (process.env.CCTS_USE_PRELOADING !== undefined) {
    defaultConfig.usePreloading = process.env.CCTS_USE_PRELOADING === 'true';
  }

  if (process.env.CCTS_MAX_MEMORY_MB) {
    const maxMemory = parseInt(process.env.CCTS_MAX_MEMORY_MB);
    if (!isNaN(maxMemory) && maxMemory > 0) {
      defaultConfig.maxMemoryUsageMB = maxMemory;
    }
  }

  const finalConfig = { ...defaultConfig, ...customConfig };
  
  console.log("[CCTs] Creating CCTsManager with configuration:", {
    environment: finalConfig.environment,
    usePreloading: finalConfig.usePreloading,
    maxMemoryUsageMB: finalConfig.maxMemoryUsageMB,
    hasS3Config: !!finalConfig.s3Config,
    hasLocalPath: !!finalConfig.localPath,
  });

  return new CCTsManager(api, finalConfig);
}