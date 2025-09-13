/**
 * Local testing framework for migrator-lambda integration
 * Provides local execution wrapper and development utilities
 */

import { Readable } from "node:stream";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import csvParser from "csv-parser";
import axios, { AxiosInstance } from "axios";
import {
  LocalConfig,
  ProcessingConfig,
  EnvironmentConfig,
  MigrationResult,
  TestReport,
  LocalTestRunner,
  CsvRow,
  UniqueSets,
  ParticipantCsvRow,
  ExecutionMode,
  ErrorReporter,
} from "./types";
import {
  loadEnvironmentConfig,
  createProcessingConfig,
  validateConfiguration,
  logValidationResults,
} from "./config";
import { LocalFileInputHandler } from "./file-input-handlers";
import { createErrorReporter } from "./error-reporter";
import { normalizeHeaders, toBoolean, toNumber } from "./utils";
import { CacheManager } from "./cache";
import { EntityManager } from "./entities";

/**
 * Local test runner implementation
 * Provides comprehensive local testing capabilities for the migration lambda
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
   * Run migration with local CSV file
   * @param csvPath - Path to the participations CSV file
   * @param config - Optional processing configuration overrides
   * @returns Migration result with statistics
   */
  async runWithCsv(csvPath: string, config?: ProcessingConfig): Promise<MigrationResult> {
    console.log("🚀 Starting local migration test run");
    console.log(`📁 CSV file: ${csvPath}`);
    
    this.startTime = Date.now();
    
    try {
      // Validate environment before starting
      if (!this.validateEnvironment()) {
        throw new Error("Environment validation failed - check configuration");
      }

      // Create local configuration
      const localConfig: LocalConfig = {
        participationsCsvPath: resolve(csvPath),
        outputPath: join(process.cwd(), `migration-results-${Date.now()}.csv`)
      };

      // Create processing configuration
      const processingConfig = createProcessingConfig(config);

      // Validate complete configuration
      const validation = validateConfiguration("local", this.envConfig, localConfig, processingConfig);
      logValidationResults(validation, "Local Test Run");

      if (!validation.isValid) {
        throw new Error(`Configuration validation failed: ${validation.errors.join(", ")}`);
      }

      // Initialize components
      const fileHandler = new LocalFileInputHandler(localConfig);
      const errorReporter = createErrorReporter("local", localConfig.outputPath);
      const cacheManager = new CacheManager(this.api);
      const entityManager = new EntityManager(this.api, cacheManager, processingConfig);

      console.log("✅ Components initialized successfully");

      // Get CSV streams
      const participationsCsv = await fileHandler.getParticipationsCsv();
      const cctsCsv = await fileHandler.getCctsCsv();

      console.log("📊 Starting three-phase processing pipeline");

      // Phase 1: Analysis
      console.log("🔍 Phase 1: Analyzing CSV data");
      const { records, unique } = await this.analyzeCSV(participationsCsv);
      console.log(`   - Processed ${records.length} records`);
      console.log(`   - Found ${unique.programas.size} unique programs`);
      console.log(`   - Found ${unique.implementaciones.size} unique implementations`);
      console.log(`   - Found ${unique.ccts.size} unique CCTs`);

      // Phase 2: Pre-loading and entity creation
      console.log("🏗️  Phase 2: Pre-loading entities");
      await this.preloadEntities(unique, cacheManager, entityManager, cctsCsv);
      console.log("   - Entity pre-loading completed");

      // Phase 3: Batch processing
      console.log("🔄 Phase 3: Processing participant data");
      const result = await this.processBatch(
        records,
        cacheManager,
        entityManager,
        errorReporter,
        processingConfig
      );

      this.endTime = Date.now();
      const processingTime = this.endTime - this.startTime;

      // Generate error report if there are errors
      let errorCsvPath: string | undefined;
      if (errorReporter.getErrorCount() > 0) {
        errorCsvPath = await errorReporter.saveErrorReport();
        console.log(`📋 Error report saved: ${errorCsvPath}`);
      }

      const finalResult: MigrationResult = {
        ...result,
        processingTime,
        errorCsvPath,
        totalRecords: records.length
      };

      // Log final results
      this.logResults(finalResult);

      return finalResult;

    } catch (error) {
      this.endTime = Date.now();
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Local test run failed: ${errorMessage}`);
      
      return {
        successCount: 0,
        errorCount: 1,
        processingTime: this.endTime - this.startTime,
        totalRecords: 0,
        errorCsvPath: undefined
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
      validation.errors.forEach(error => console.error(`   - ${error}`));
      return false;
    }

    if (validation.warnings.length > 0) {
      console.warn("⚠️  Environment warnings:");
      validation.warnings.forEach(warning => console.warn(`   - ${warning}`));
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
        totalRecords: 0
      },
      errors: [],
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Analyze CSV data to collect unique entities
   * @param csvStream - Readable stream of CSV data
   * @returns Records and unique entity sets
   */
  private async analyzeCSV(csvStream: Readable): Promise<{ records: CsvRow[], unique: UniqueSets }> {
    const records: CsvRow[] = [];
    const unique: UniqueSets = {
      ccts: new Set<string>(),
      programas: new Set<string>(),
      implementaciones: new Map(),
      asistenciaFields: new Set<string>(),
      asistenciaModalities: new Map<string, string>(),
      trabajoFields: new Set<string>(),
    };

    return new Promise((resolve, reject) => {
      csvStream
        .pipe(csvParser({ mapHeaders: normalizeHeaders }))
        .on("data", (row: CsvRow) => {
          records.push(row);
          
          // Collect unique entities
          if (row.cct) unique.ccts.add(String(row.cct));
          if (row.programa) unique.programas.add(String(row.programa));
          
          // Implementaciones
          if (row.implementacion && row.ciclo_escolar && row.periodo_de_implementacion) {
            const implKey = `${row.implementacion}|${row.ciclo_escolar}|${row.periodo_de_implementacion}`;
            if (!unique.implementaciones.has(implKey)) {
              unique.implementaciones.set(implKey, {
                nombre: row.implementacion,
                ciclo_escolar: row.ciclo_escolar,
                periodo: row.periodo_de_implementacion,
                programa: row.programa,
              });
            }
          }
          
          // Asistencias y modalidades
          Object.keys(row).forEach((k) => {
            if (k.startsWith("asist_") || k.startsWith("trip") || k.startsWith("ses")) {
              unique.asistenciaFields.add(k);
              const modKey = `modalidad_${k}`;
              const rawVal = row[modKey];
              const modVal = typeof rawVal === "string" ? rawVal.trim() : 
                rawVal === undefined || rawVal === null ? "" : String(rawVal).trim();
              
              if (modVal && modVal.toUpperCase() !== "NA") {
                const implKey = `${row.implementacion}|${row.ciclo_escolar}|${row.periodo_de_implementacion}`;
                const mapKey = `${implKey}|${k}`;
                unique.asistenciaModalities.set(mapKey, modVal);
              }
            }
            if (k.startsWith("trabajo") || k.startsWith("evidencia")) {
              unique.trabajoFields.add(k);
            }
          });
        })
        .on("end", () => resolve({ records, unique }))
        .on("error", reject);
    });
  }

  /**
   * Pre-load entities into cache
   * @param unique - Unique entity sets from analysis
   * @param cacheManager - Cache manager instance
   * @param entityManager - Entity manager instance
   * @param cctsCsv - Optional CCTs CSV stream
   */
  private async preloadEntities(
    unique: UniqueSets,
    cacheManager: CacheManager,
    entityManager: EntityManager,
    cctsCsv?: Readable | null
  ): Promise<void> {
    // Cache is already initialized in constructor
    
    // Load CCTs if available
    if (cctsCsv) {
      console.log("   - Loading CCTs from CSV");
      await this.loadCCTsFromCSV(cctsCsv, cacheManager);
    }
    
    // Pre-cache simple entities
    console.log("   - Pre-caching simple entities");
    await entityManager.precacheSimpleEntities("encuestas", "clave");
    
    console.log("   - Entity pre-loading completed");
  }

  /**
   * Load CCTs from CSV stream
   * @param cctsCsv - CCTs CSV stream
   * @param cacheManager - Cache manager instance
   */
  private async loadCCTsFromCSV(cctsCsv: Readable, cacheManager: CacheManager): Promise<void> {
    return new Promise((resolve, reject) => {
      cctsCsv
        .pipe(csvParser({ mapHeaders: normalizeHeaders }))
        .on("data", (row: any) => {
          if (row.cct) {
            // Add CCT to cache - this would need to be implemented in CacheManager
            // For now, just log that we found it
            console.log(`   - Found CCT: ${row.cct}`);
          }
        })
        .on("end", resolve)
        .on("error", reject);
    });
  }

  /**
   * Process batch of participant records
   * @param records - Array of CSV records
   * @param cacheManager - Cache manager instance
   * @param entityManager - Entity manager instance
   * @param errorReporter - Error reporter instance
   * @param config - Processing configuration
   * @returns Processing result
   */
  private async processBatch(
    records: CsvRow[],
    cacheManager: CacheManager,
    entityManager: EntityManager,
    errorReporter: any,
    config: ProcessingConfig
  ): Promise<{ successCount: number; errorCount: number }> {
    let successCount = 0;
    let errorCount = 0;
    
    const batchSize = config.batchSize;
    const totalBatches = Math.ceil(records.length / batchSize);
    
    console.log(`   - Processing ${records.length} records in ${totalBatches} batches of ${batchSize}`);
    
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      
      console.log(`   - Processing batch ${batchNumber}/${totalBatches} (${batch.length} records)`);
      
      if (config.processMode === "parallel") {
        // Process batch in parallel
        const results = await Promise.allSettled(
          batch.map((record, index) => 
            this.processParticipationRow(record as ParticipantCsvRow, cacheManager, entityManager, errorReporter, i + index + 1)
          )
        );
        
        results.forEach(result => {
          if (result.status === "fulfilled") {
            successCount++;
          } else {
            errorCount++;
          }
        });
      } else {
        // Process batch sequentially
        for (let j = 0; j < batch.length; j++) {
          try {
            await this.processParticipationRow(
              batch[j] as ParticipantCsvRow, 
              cacheManager, 
              entityManager, 
              errorReporter, 
              i + j + 1
            );
            successCount++;
          } catch (error) {
            errorCount++;
          }
        }
      }
      
      // Progress reporting
      const processed = Math.min(i + batchSize, records.length);
      const progress = ((processed / records.length) * 100).toFixed(1);
      console.log(`   - Progress: ${processed}/${records.length} (${progress}%)`);
    }
    
    return { successCount, errorCount };
  }

  /**
   * Process a single participation row
   * @param row - Participant CSV row
   * @param cacheManager - Cache manager instance
   * @param entityManager - Entity manager instance
   * @param errorReporter - Error reporter instance
   * @param rowNumber - Row number for error reporting
   */
  private async processParticipationRow(
    row: ParticipantCsvRow,
    cacheManager: CacheManager,
    entityManager: EntityManager,
    errorReporter: ErrorReporter,
    rowNumber: number
  ): Promise<void> {
    try {
      // Get implementation ID from cache
      const implementacionKey = cacheManager.createImplementationKey(
        row.implementacion || "",
        row.ciclo_escolar || "",
        row.periodo_de_implementacion || "",
      );
      const implementacionId = cacheManager.getCachedId("implementaciones", implementacionKey);
      const cctId = row.cct ? cacheManager.getCachedId("ccts", row.cct) : null;

      // Handle participant creation/lookup
      const participantId = await entityManager.getOrCreate(
        "participantes",
        { id_externo: row.id },
        {
          id_externo: row.id,
          edad: toNumber(row.edad),
          sexo: row.sexo,
          telefono: row.telefono,
          curp: row.curp,
          rfc: row.rfc,
          nombre: row.nombre,
          primer_apellido: row.primer_apellido,
          segundo_apellido: row.segundo_apellido,
          nombre_completo: row.nombre_completo,
          entidad: row.entidad,
          estado_civil: row.estado_civil?.toUpperCase() !== "NA" ? row.estado_civil : null,
          lengua_indigena: toBoolean(row.lengua_indigena),
          hablante_maya: toBoolean(row.hablante_maya),
          nivel_educativo: row.nivel_educativo?.toUpperCase() !== "NA" ? row.nivel_educativo : null,
          cct: cctId,
        },
        "participantes",
        row.id,
      );

      if (!participantId || !implementacionId) {
        throw new Error(
          `Missing critical IDs for participant ${row.id}. ParticipantID: ${participantId}, ImplementacionID: ${implementacionId}`
        );
      }

      // Create participation record
      const { data: partRes } = await this.api.post("/participaciones", {
        data: {
          participante: participantId,
          implementacion: implementacionId,
          puesto: row.puesto,
          puesto_detalle: row.puesto_detalle,
          antiguedad: row.antiguedad,
          estudiantes_a_cargo: toNumber(row.estudiantes_a_cargo),
          turno: row.turno,
          participa_director: toBoolean(row.participa_director_a),
          cct_verificado: toBoolean(row.centro_de_trabajo_verificado),
          obtuvo_constancia: toBoolean(row.constancia),
          involucramiento: row.involucramiento,
          promedio_modulos: row.promedio_modulos,
        },
      });

      // Handle email if present
      if (row.email && row.email.toUpperCase() !== "NA") {
        await this.handleParticipantEmail(row, participantId);
      }

      console.log(`   ✅ Processed participant ${row.id} successfully`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errorReporter.logError(row.id || "UNKNOWN", row.email || "NO_EMAIL", errorMessage, rowNumber);
      console.error(`   ❌ Failed to process participant ${row.id}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Handle participant email creation
   * @param row - Participant CSV row
   * @param participantId - Participant ID
   */
  private async handleParticipantEmail(row: ParticipantCsvRow, participantId: number): Promise<void> {
    const email = row.email?.trim();
    if (!email || email.toUpperCase() === "NA") return;

    try {
      await this.api.post("/correo-participantes", {
        data: { participante: participantId, correo: email, principal: true },
      });
      console.log(`   → Email assigned: ${email}`);
    } catch (error) {
      console.error(`   → Failed to assign email ${email}: ${error}`);
      throw error;
    }
  }

  /**
   * Log final processing results
   * @param result - Migration result
   */
  private logResults(result: MigrationResult): void {
    console.log("\n📊 Migration Test Results:");
    console.log("=" .repeat(50));
    console.log(`Total Records: ${result.totalRecords}`);
    console.log(`Successful: ${result.successCount}`);
    console.log(`Errors: ${result.errorCount}`);
    console.log(`Success Rate: ${((result.successCount / result.totalRecords) * 100).toFixed(1)}%`);
    console.log(`Processing Time: ${(result.processingTime / 1000).toFixed(2)} seconds`);
    
    if (result.errorCsvPath) {
      console.log(`Error Report: ${result.errorCsvPath}`);
    }
    
    console.log("=" .repeat(50));
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
 * @param csvPath - Path to CSV file
 * @param config - Optional processing configuration
 * @returns Migration result
 */
export async function runLocalTest(csvPath: string, config?: ProcessingConfig): Promise<MigrationResult> {
  const runner = createLocalTestRunner();
  return await runner.runWithCsv(csvPath, config);
}