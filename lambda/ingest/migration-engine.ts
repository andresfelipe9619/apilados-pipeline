/**
 * Migration Engine - Shared processing engine for both Lambda and local execution
 * Ensures consistent behavior between production and local testing
 */

import { Readable } from "node:stream";
import { AxiosInstance } from "axios";
import {
  ProcessingConfig,
  SimulationResult,
  ErrorReporter,
} from "./types";
import { formatError } from "./utils";
import { CacheManager } from "./cache";
import { EntityManager } from "./entities";
import {
  CsvAnalysisPhase,
  EntityCreationPhase,
  BatchProcessingPhase,
} from "./processing-pipeline";

/**
 * Enhanced processing engine that integrates all processing phases
 * Supports both AWS S3 events and local file processing
 */
export class MigrationEngine {
  private api: AxiosInstance;
  private cacheManager: CacheManager;
  private entityManager: EntityManager;
  private processingConfig: ProcessingConfig;
  private errorReporter: ErrorReporter;

  constructor(
    api: AxiosInstance,
    cacheManager: CacheManager,
    entityManager: EntityManager,
    processingConfig: ProcessingConfig,
    errorReporter: ErrorReporter,
  ) {
    this.api = api;
    this.cacheManager = cacheManager;
    this.entityManager = entityManager;
    this.processingConfig = processingConfig;
    this.errorReporter = errorReporter;
  }

  /**
   * Execute the complete three-phase data processing
   */
  async processData(
    participationsCsv: Readable,
    cctsCsv?: Readable,
  ): Promise<SimulationResult> {
    const startTime = Date.now();
    console.log("🚀 Starting three-phase S3 event simulation process");

    try {
      // Phase 1: CSV Analysis
      const analysisPhase = new CsvAnalysisPhase(this.processingConfig);
      const { records, uniqueSets } =
        await analysisPhase.analyzeCsv(participationsCsv);

      // Phase 2: Entity Creation
      const creationPhase = new EntityCreationPhase(
        this.entityManager,
        this.cacheManager,
        this.processingConfig,
      );
      await creationPhase.executeCreationPhase(uniqueSets, cctsCsv);

      // Phase 3: Batch Processing
      const batchPhase = new BatchProcessingPhase(
        this.api,
        this.entityManager,
        this.cacheManager,
        this.processingConfig,
      );
      const batchResult = await batchPhase.executeBatchProcessing(records);

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      // Generate error report if there were errors
      let errorCsvPath: string | undefined;
      if (this.errorReporter.getErrorCount() > 0) {
        errorCsvPath = await this.errorReporter.saveErrorReport();
      }

      const result: SimulationResult = {
        totalRecords: batchResult.totalRecords,
        successCount: batchResult.successCount,
        errorCount: batchResult.errorCount,
        processingTime,
        errorCsvPath,
      };

      console.log("✅ Migration process completed successfully");
      console.log(`   → Total records: ${result.totalRecords}`);
      console.log(`   → Successful: ${result.successCount}`);
      console.log(`   → Errors: ${result.errorCount}`);
      console.log(
        `   → Processing time: ${Math.round(processingTime / 1000)}s`,
      );
      if (errorCsvPath) {
        console.log(`   → Error report: ${errorCsvPath}`);
      }

      return result;
    } catch (error) {
      const errorMessage = formatError(error);
      console.error("❌ Migration process failed:", errorMessage);
      throw new Error(`Migration process failed: ${errorMessage}`);
    }
  }
}