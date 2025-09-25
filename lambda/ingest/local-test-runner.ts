/**
 * Local testing framework for migrator-lambda integration
 * Provides local execution wrapper and development utilities
 */

import {join, resolve} from "node:path";
import axios, {AxiosInstance} from "axios";
import {EnvironmentConfig, LocalConfig, LocalTestRunner, ProcessingConfig, SimulationResult, TestReport,} from "./types";
import {createProcessingConfig, loadEnvironmentConfig, logValidationResults, validateConfiguration,} from "./config";
import {LocalFileInputHandler} from "./file-input-handlers";
import {createErrorReporter} from "./error-reporter";
import {CacheManager} from "./cache";
import {EntityManager} from "./entities";
import {MigrationEngine} from "./migration-engine";

/**
 * Local test runner implementation
 * Provides comprehensive local testing capabilities for S3 event simulation
 */
export class MigrationLocalTestRunner implements LocalTestRunner {
  private envConfig: EnvironmentConfig;
  private api: AxiosInstance;
  private startTime: number = 0;
  private endTime: number = 0;

  constructor() {
    // Initialize environment configuration
    this.envConfig = loadEnvironmentConfig();

    // Initialize API client
    this.api = axios.create({
      baseURL: this.envConfig.strapiBaseUrl,
      headers: {
        Authorization: `Bearer ${this.envConfig.strapiToken}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });
  }

  /**
   * Run S3 event simulation with local CSV file using the same MigrationEngine as Lambda
   * @param csvPath - Path to the event CSV file
   * @param config - Optional processing configuration overrides
   * @param cctsCsvPath - Optional path to CCTs CSV file (performance optimization)
   * @returns Simulation result with statistics
   */
  async runWithCsv(
    csvPath: string,
    config?: ProcessingConfig,
    cctsCsvPath?: string,
  ): Promise<SimulationResult> {
    console.log("🚀 Starting local S3 event simulation run");
    console.log(`📁 CSV file: ${csvPath}`);

    this.startTime = Date.now();

    try {
      // Validate environment before starting
      if (!this.validateEnvironment()) {
        throw new Error("Environment validation failed - check configuration");
      }

      // Create local configuration for CSV processing
      const localConfig: LocalConfig & { 
        participationsCsvPath: string; 
        cctsCsvPath?: string; 
      } = {
        participationsCsvPath: resolve(csvPath),
        cctsCsvPath: cctsCsvPath ? resolve(cctsCsvPath) : undefined,
        outputPath: join(process.cwd(), `migration-results-${Date.now()}.csv`),
      };

      // Create processing configuration
      const processingConfig = createProcessingConfig(config);

      // Validate complete configuration
      const validation = validateConfiguration(
        "local",
        this.envConfig,
        localConfig,
        processingConfig,
      );
      logValidationResults(validation, "Local Test Run");

      if (!validation.isValid) {
        throw new Error(
          `Configuration validation failed: ${validation.errors.join(", ")}`,
        );
      }

      // Initialize components exactly as Lambda does
      const fileHandler = new LocalFileInputHandler(localConfig);
      const errorReporter = createErrorReporter(
        "local",
        localConfig.outputPath,
      );
      const cacheManager = new CacheManager(this.api);
      const entityManager = new EntityManager(
        this.api,
        cacheManager,
        processingConfig,
      );

      console.log("✅ Components initialized successfully");

      // Create processing engine - SAME AS LAMBDA!
      const migrationEngine = new MigrationEngine(
        this.api,
        cacheManager,
        entityManager,
        processingConfig,
        errorReporter,
      );

      // Get CSV streams
      const participationsCsv = await fileHandler.getParticipationsCsv();
      const cctsCsv = await fileHandler.getCctsCsv();

      // Execute data processing using the SAME engine as Lambda
      const result = await migrationEngine.processData(
        participationsCsv,
        cctsCsv || undefined,
      );

      this.endTime = Date.now();

      // Log final results
      this.logResults(result);

      return result;
    } catch (error) {
      this.endTime = Date.now();
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`❌ Local S3 event simulation failed: ${errorMessage}`);

      return {
        totalRecords: 0,
        successCount: 0,
        errorCount: 1,
        processingTime: this.endTime - this.startTime,
        errorCsvPath: undefined,
      };
    }
  }

  /**
   * Validate environment configuration
   * @returns true if environment is valid, false otherwise
   */
  validateEnvironment(): boolean {
    console.log("🔍 Validating environment configuration");

    const validation = validateConfiguration("local", this.envConfig);
    logValidationResults(validation, "Environment Validation");

    if (!validation.isValid) {
      console.error("❌ Environment validation failed:");
      validation.errors.forEach((error) => console.error(`   - ${error}`));
      return false;
    }

    if (validation.warnings.length > 0) {
      console.warn("⚠️  Environment warnings:");
      validation.warnings.forEach((warning) => console.warn(`   - ${warning}`));
    }

    console.log("✅ Environment validation passed");
    return true;
  }

  /**
   * Generate comprehensive test report
   * @returns Test report with all execution details
   */
  generateTestReport(): TestReport {
    return {
      environment: this.envConfig,
      processingConfig: createProcessingConfig(),
      result: {
        successCount: 0,
        errorCount: 0,
        processingTime: this.endTime - this.startTime,
        totalRecords: 0,
      },
      errors: [],
      timestamp: new Date().toISOString(),
    };
  }


  /**
   * Log final processing results
   * @param result - Simulation result
   */
  private logResults(result: SimulationResult): void {
    console.log("\n📊 S3 Event Simulation Results:");
    console.log("=".repeat(50));
    console.log(`Total Records: ${result.totalRecords}`);
    console.log(`Successful: ${result.successCount}`);
    console.log(`Errors: ${result.errorCount}`);
    console.log(
      `Success Rate: ${((result.successCount / result.totalRecords) * 100).toFixed(1)}%`,
    );
    console.log(
      `Processing Time: ${(result.processingTime / 1000).toFixed(2)} seconds`,
    );

    if (result.errorCsvPath) {
      console.log(`Error Report: ${result.errorCsvPath}`);
    }

    console.log("=".repeat(50));
  }
}

/**
 * Factory function to create a local test runner
 * @returns New LocalTestRunner instance
 */
export function createLocalTestRunner(): LocalTestRunner {
  return new MigrationLocalTestRunner();
}

/**
 * Convenience function to run a quick local test
 * @param csvPath - Path to event CSV file
 * @param config - Optional processing configuration
 * @param cctsCsvPath - Optional path to CCTs CSV file (performance optimization)
 * @returns Simulation result
 */
export async function runLocalTest(
  csvPath: string,
  config?: ProcessingConfig,
  cctsCsvPath?: string,
): Promise<SimulationResult> {
  const runner = createLocalTestRunner();
  return await runner.runWithCsv(csvPath, config, cctsCsvPath);
}
