/**
 * Three-phase processing pipeline implementation
 * Migrated from migrator.js with enhanced TypeScript support and streaming capabilities
 */

import { Readable } from "node:stream";
import csvParser from "csv-parser";
import {
  CsvRow,
  ErrorRecord,
  MigrationResult,
  SimulationResult,
  ParticipantCsvRow,
  ProcessingConfig,
  ProcessingStats,
  UniqueSets,
} from "./types";
import { formatError, normalizeHeaders, toBoolean, toNumber } from "./utils";
import { CacheManager } from "./cache";
import { EntityManager } from "./entities";
import { AxiosInstance } from "axios";

/**
 * Phase 1: CSV Analysis
 * Streams through CSV data to collect unique entities and prepare for processing
 */
export class CsvAnalysisPhase {
  private processingConfig: ProcessingConfig;
  private stats: ProcessingStats;

  constructor(processingConfig: ProcessingConfig) {
    this.processingConfig = processingConfig;
    this.stats = {
      recordsProcessed: 0,
      successCount: 0,
      errorCount: 0,
      startTime: Date.now(),
    };
  }

  /**
   * Analyze CSV data and collect unique entities
   * Uses streaming to handle large files efficiently
   */
  async analyzeCsv(csvStream: Readable): Promise<{
    records: ParticipantCsvRow[];
    uniqueSets: UniqueSets;
    stats: ProcessingStats;
  }> {
    console.log("--- PHASE 1: Analyzing CSV for unique entities ---");
    console.time("CSV Analysis Phase");

    const records: ParticipantCsvRow[] = [];
    const uniqueSets: UniqueSets = {
      ccts: new Set<string>(),
      programas: new Set<string>(),
      implementaciones: new Map(),
      asistenciaFields: new Set<string>(),
      asistenciaModalities: new Map<string, string>(),
      trabajoFields: new Set<string>(),
    };

    let processedRows = 0;
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      csvStream
        .pipe(csvParser({ mapHeaders: normalizeHeaders }))
        .on("data", (row: CsvRow) => {
          try {
            // Convert to ParticipantCsvRow for type safety
            const participantRow = row as ParticipantCsvRow;
            records.push(participantRow);
            processedRows++;

            // Collect unique CCTs and programs
            if (participantRow.cct) {
              uniqueSets.ccts.add(String(participantRow.cct));
            }
            if (participantRow.programa) {
              uniqueSets.programas.add(String(participantRow.programa));
            }

            // Collect unique implementations
            if (
              participantRow.implementacion &&
              participantRow.ciclo_escolar &&
              participantRow.periodo_de_implementacion
            ) {
              const implKey = `${participantRow.implementacion}|${participantRow.ciclo_escolar}|${participantRow.periodo_de_implementacion}`;
              if (!uniqueSets.implementaciones.has(implKey)) {
                uniqueSets.implementaciones.set(implKey, {
                  nombre: participantRow.implementacion,
                  ciclo_escolar: participantRow.ciclo_escolar,
                  periodo: participantRow.periodo_de_implementacion,
                  programa: participantRow.programa
                    ? String(participantRow.programa)
                    : undefined,
                });
              }
            }

            // Collect attendance fields and modalities
            this.collectAttendanceFields(participantRow, uniqueSets);

            // Collect work/job fields
            this.collectWorkFields(participantRow, uniqueSets);

            // Progress reporting for large files
            if (processedRows % 1000 === 0) {
              const memUsage = process.memoryUsage();
              console.log(
                `   → Analysis progress: ${processedRows} rows processed, ` +
                  `Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
              );
            }
          } catch (error) {
            console.error(
              `[ERROR] Failed to process row ${processedRows}:`,
              formatError(error),
            );
            // Continue processing other rows
          }
        })
        .on("end", () => {
          const endTime = Date.now();
          const processingTime = endTime - startTime;

          this.stats = {
            recordsProcessed: processedRows,
            successCount: processedRows,
            errorCount: 0,
            startTime,
            endTime,
          };

          console.timeEnd("CSV Analysis Phase");
          console.log(
            `→ ${processedRows} rows analyzed. Found ${uniqueSets.implementaciones.size} unique implementations.`,
          );
          console.log(
            `→ Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
          );

          resolve({
            records,
            uniqueSets,
            stats: this.stats,
          });
        })
        .on("error", (error: Error) => {
          console.error("[ERROR] CSV analysis failed:", formatError(error));
          reject(error);
        });
    });
  }

  /**
   * Collect attendance fields and their modalities
   */
  private collectAttendanceFields(
    row: ParticipantCsvRow,
    uniqueSets: UniqueSets,
  ): void {
    Object.keys(row).forEach((key) => {
      if (
        key.startsWith("asist_") ||
        key.startsWith("trip") ||
        key.startsWith("ses")
      ) {
        uniqueSets.asistenciaFields.add(key);

        // Check for modality information
        const modalityKey = `modalidad_${key}`;
        const modalityValue = row[modalityKey];

        if (modalityValue && typeof modalityValue === "string") {
          const modVal = modalityValue.trim();
          if (modVal && modVal.toUpperCase() !== "NA") {
            const implKey = `${row.implementacion}|${row.ciclo_escolar}|${row.periodo_de_implementacion}`;
            const mapKey = `${implKey}|${key}`;

            // Check for conflicting modalities
            if (
              uniqueSets.asistenciaModalities.has(mapKey) &&
              uniqueSets.asistenciaModalities.get(mapKey) !== modVal
            ) {
              console.warn(
                `[WARN] Conflicting modality for ${key} in implementation ${implKey}: ` +
                  `"${uniqueSets.asistenciaModalities.get(mapKey)}" vs "${modVal}"`,
              );
            } else {
              uniqueSets.asistenciaModalities.set(mapKey, modVal);
            }
          }
        }
      }
    });
  }

  /**
   * Collect work/job fields
   */
  private collectWorkFields(
    row: ParticipantCsvRow,
    uniqueSets: UniqueSets,
  ): void {
    Object.keys(row).forEach((key) => {
      if (key.startsWith("trabajo") || key.startsWith("evidencia")) {
        uniqueSets.trabajoFields.add(key);
      }
    });
  }

  /**
   * Get current processing statistics
   */
  getStats(): ProcessingStats {
    return { ...this.stats };
  }
}
/**
 *
 Phase 2: Pre-loading and Entity Creation
 * Creates all parent entities in proper dependency order to avoid race conditions
 */
export class EntityCreationPhase {
  private entityManager: EntityManager;
  private cacheManager: CacheManager;
  private processingConfig: ProcessingConfig;

  constructor(
    entityManager: EntityManager,
    cacheManager: CacheManager,
    processingConfig: ProcessingConfig,
  ) {
    this.entityManager = entityManager;
    this.cacheManager = cacheManager;
    this.processingConfig = processingConfig;
  }

  /**
   * Execute the complete entity creation phase
   * Maintains dependency order to prevent race conditions
   */
  async executeCreationPhase(
    uniqueSets: UniqueSets,
    cctsCsv?: Readable,
  ): Promise<void> {
    console.log("\n--- PHASE 2: Pre-loading and creating parent entities ---");
    console.time("Entity Creation Phase");

    try {
      // Step 1: Load independent entities in parallel
      await this.loadIndependentEntities(cctsCsv);

      // Step 2: Create programs sequentially
      await this.createProgramsSequentially(uniqueSets.programas);

      // Step 3: Create implementations sequentially (depends on programs)
      await this.createImplementationsSequentially(uniqueSets.implementaciones);

      // Step 4: Create implementation-dependent entities
      await this.createImplementationDependentEntities(uniqueSets);

      console.timeEnd("Entity Creation Phase");

      // Validate cache state
      this.validateCacheState();
    } catch (error) {
      console.error(
        "[ERROR] Entity creation phase failed:",
        formatError(error),
      );
      throw error;
    }
  }

  /**
   * Load entities that don't depend on others (CCTs, Surveys)
   */
  private async loadIndependentEntities(cctsCsv?: Readable): Promise<void> {
    console.log("[STEP 1] Loading independent entities...");

    const loadPromises = [
      this.entityManager.precacheSimpleEntities("encuestas", "clave"),
    ];

    // Load CCTs if CSV is provided
    if (cctsCsv) {
      loadPromises.push(this.entityManager.loadCctsFromCsv(cctsCsv));
    } else {
      console.log("[CCT] No CCT CSV provided, skipping CCT loading");
    }

    await Promise.all(loadPromises);

    const stats = this.cacheManager.getCacheStats();
    console.log(`[CACHE] Surveys loaded: ${stats.encuestas}`);
    console.log(`[CACHE] CCTs loaded: ${stats.ccts}`);
  }

  /**
   * Create programs in sequential order to avoid race conditions
   */
  private async createProgramsSequentially(
    uniquePrograms: Set<string>,
  ): Promise<void> {
    console.log(
      `[STEP 2] Creating ${uniquePrograms.size} programs sequentially...`,
    );

    let createdCount = 0;
    const totalCount = uniquePrograms.size;

    for (const programName of uniquePrograms) {
      try {
        await this.entityManager.getOrCreate(
          "programas",
          { nombre: programName },
          { nombre: programName },
          "programas",
          programName,
        );

        createdCount++;

        // Progress logging for large datasets
        if (createdCount % 10 === 0 || createdCount === totalCount) {
          console.log(`   → Programs progress: ${createdCount}/${totalCount}`);
        }
      } catch (error) {
        console.error(
          `[ERROR] Failed to create program "${programName}":`,
          formatError(error),
        );
        throw error;
      }
    }

    const stats = this.cacheManager.getCacheStats();
    console.log(`[SETUP] Programs in cache: ${stats.programas}`);
  }

  /**
   * Create implementations in sequential order (depends on programs)
   */
  private async createImplementationsSequentially(
    uniqueImplementations: Map<
      string,
      {
        nombre: string | undefined;
        ciclo_escolar: string | undefined;
        periodo: string | undefined;
        programa: string | undefined;
      }
    >,
  ): Promise<void> {
    console.log(
      `[STEP 3] Creating ${uniqueImplementations.size} implementations sequentially...`,
    );

    const cache = this.cacheManager.getCache();
    const surveyIds = Array.from(cache.encuestas.values());

    let createdCount = 0;
    const totalCount = uniqueImplementations.size;

    for (const [implKey, impl] of uniqueImplementations.entries()) {
      try {
        if (!impl.programa) {
          console.warn(
            `[WARN] Implementation ${implKey} has no program, skipping`,
          );
          continue;
        }

        const programId = cache.programas.get(impl.programa);
        if (!programId) {
          console.warn(`[WARN] Program not found in cache: ${impl.programa}`);
          continue;
        }

        await this.entityManager.getOrCreate(
          "implementaciones",
          {
            nombre: impl.nombre,
            ciclo_escolar: impl.ciclo_escolar,
            periodo: impl.periodo,
          },
          {
            nombre: impl.nombre,
            ciclo_escolar: impl.ciclo_escolar,
            periodo: impl.periodo,
            programa: programId,
            encuestas: surveyIds,
          },
          "implementaciones",
          implKey,
        );

        createdCount++;

        // Progress logging
        if (createdCount % 5 === 0 || createdCount === totalCount) {
          console.log(
            `   → Implementations progress: ${createdCount}/${totalCount}`,
          );
        }
      } catch (error) {
        console.error(
          `[ERROR] Failed to create implementation "${implKey}":`,
          formatError(error),
        );
        throw error;
      }
    }

    const stats = this.cacheManager.getCacheStats();
    console.log(`[SETUP] Implementations in cache: ${stats.implementaciones}`);
  }

  /**
   * Create entities that depend on implementations (modules, attendances, jobs)
   */
  private async createImplementationDependentEntities(
    uniqueSets: UniqueSets,
  ): Promise<void> {
    console.log("[STEP 4] Creating implementation-dependent entities...");

    const cache = this.cacheManager.getCache();
    const implementationCount = cache.implementaciones.size;
    let processedCount = 0;

    for (const [
      implKey,
      implementacionId,
    ] of cache.implementaciones.entries()) {
      try {
        // Create modules for this implementation
        await this.createModulesForImplementation(implementacionId);

        // Create attendances for this implementation
        await this.createAttendancesForImplementation(
          implKey,
          implementacionId,
          uniqueSets.asistenciaFields,
          uniqueSets.asistenciaModalities,
        );

        // Create jobs/works for this implementation
        await this.createJobsForImplementation(
          implementacionId,
          uniqueSets.trabajoFields,
        );

        processedCount++;

        // Progress logging
        if (
          processedCount % 10 === 0 ||
          processedCount === implementationCount
        ) {
          console.log(
            `   → Implementation entities progress: ${processedCount}/${implementationCount}`,
          );
        }
      } catch (error) {
        console.error(
          `[ERROR] Failed to create dependent entities for implementation "${implKey}":`,
          formatError(error),
        );
        throw error;
      }
    }

    // Log final statistics
    const stats = this.cacheManager.getCacheStats();
    console.log(`[SETUP] Modules in cache: ${stats.modulos}`);
    console.log(`[SETUP] Attendances in cache: ${stats.asistencias}`);
    console.log(`[SETUP] Jobs in cache: ${stats.trabajos}`);
  }

  /**
   * Create standard modules for an implementation
   */
  private async createModulesForImplementation(
    implementacionId: number,
  ): Promise<void> {
    for (const moduleName of ["mod1", "mod2", "mod3"]) {
      const cacheKey = this.cacheManager.createImplementationCacheKey(
        moduleName,
        implementacionId,
      );

      await this.entityManager.getOrCreate(
        "modulos",
        { nombre: moduleName, implementacion: implementacionId },
        {
          nombre: moduleName,
          implementacion: implementacionId,
        },
        "modulos",
        cacheKey,
      );
    }
  }

  /**
   * Create attendances for an implementation with modality support
   */
  private async createAttendancesForImplementation(
    implKey: string,
    implementacionId: number,
    attendanceFields: Set<string>,
    attendanceModalities: Map<string, string>,
  ): Promise<void> {
    for (const field of attendanceFields) {
      const modalityMapKey = `${implKey}|${field}`;
      const modality = attendanceModalities.get(modalityMapKey) || null;
      const cacheKey = this.cacheManager.createImplementationCacheKey(
        field,
        implementacionId,
      );

      await this.entityManager.getOrCreate(
        "asistencias",
        { clave_sesion: field, implementacion: implementacionId },
        {
          clave_sesion: field,
          modalidad: modality,
          implementacion: implementacionId,
        },
        "asistencias",
        cacheKey,
      );
    }
  }

  /**
   * Create jobs/works for an implementation
   */
  private async createJobsForImplementation(
    implementacionId: number,
    workFields: Set<string>,
  ): Promise<void> {
    for (const field of workFields) {
      const cacheKey = this.cacheManager.createImplementationCacheKey(
        field,
        implementacionId,
      );

      await this.entityManager.getOrCreate(
        "trabajos",
        { nombre: field, implementacion: implementacionId },
        {
          nombre: field,
          implementacion: implementacionId,
        },
        "trabajos",
        cacheKey,
      );
    }
  }

  /**
   * Validate cache state after entity creation
   */
  private validateCacheState(): void {
    const validation = this.cacheManager.validateCache();
    if (!validation.isValid) {
      console.warn("[WARN] Cache validation issues:", validation.issues);
    } else {
      console.log("[CACHE] Cache validation passed ✅");
    }

    // Log detailed cache statistics
    const stats = this.cacheManager.getCacheStats();
    console.log("[CACHE] Final entity counts:");
    Object.entries(stats).forEach(([entity, count]) => {
      console.log(`   → ${entity}: ${count}`);
    });
  }
}

/**
 * Phase 3: Batch Processing
 * Processes participant data in configurable batches with parallel/sequential modes
 */
export class BatchProcessingPhase {
  private api: AxiosInstance;
  private entityManager: EntityManager;
  private cacheManager: CacheManager;
  private processingConfig: ProcessingConfig;
  private errorRecords: ErrorRecord[] = [];
  private stats: ProcessingStats;

  constructor(
    api: AxiosInstance,
    entityManager: EntityManager,
    cacheManager: CacheManager,
    processingConfig: ProcessingConfig,
  ) {
    this.api = api;
    this.entityManager = entityManager;
    this.cacheManager = cacheManager;
    this.processingConfig = processingConfig;
    this.stats = {
      recordsProcessed: 0,
      successCount: 0,
      errorCount: 0,
      startTime: Date.now(),
    };
  }

  /**
   * Execute batch processing phase with configurable parallel/sequential modes
   */
  async executeBatchProcessing(
    records: ParticipantCsvRow[],
  ): Promise<SimulationResult> {
    console.log(
      `\n--- PHASE 3: Processing ${records.length} participants in batches of ${this.processingConfig.batchSize} ---`,
    );
    console.log(
      `Processing mode: ${this.processingConfig.processMode.toUpperCase()}`,
    );
    console.time("Batch Processing Phase");

    this.stats.startTime = Date.now();
    let successCount = 0;
    let errorCount = 0;

    try {
      for (
        let i = 0;
        i < records.length;
        i += this.processingConfig.batchSize
      ) {
        const batch = records.slice(i, i + this.processingConfig.batchSize);
        const batchNumber = Math.floor(i / this.processingConfig.batchSize) + 1;
        const totalBatches = Math.ceil(
          records.length / this.processingConfig.batchSize,
        );

        console.log(
          `[BATCH ${batchNumber}/${totalBatches}] Processing ${batch.length} records...`,
        );

        if (this.processingConfig.processMode === "sequential") {
          const batchResult = await this.processSequentialBatch(batch, i);
          successCount += batchResult.successCount;
          errorCount += batchResult.errorCount;
        } else {
          const batchResult = await this.processParallelBatch(batch, i);
          successCount += batchResult.successCount;
          errorCount += batchResult.errorCount;
        }

        // Progress reporting
        const processed = Math.min(
          i + this.processingConfig.batchSize,
          records.length,
        );
        const progressPercent = Math.round((processed / records.length) * 100);
        console.log(
          `   → Progress: ${processed}/${records.length} (${progressPercent}%)`,
        );

        // Memory usage monitoring
        const memUsage = process.memoryUsage();
        console.log(
          `   → Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
        );
      }

      console.timeEnd("Batch Processing Phase");

      this.stats.endTime = Date.now();
      this.stats.recordsProcessed = records.length;
      this.stats.successCount = successCount;
      this.stats.errorCount = errorCount;

      return {
        totalRecords: records.length,
        successCount,
        errorCount,
        processingTime: this.stats.endTime - this.stats.startTime,
      };
    } catch (error) {
      console.error("[ERROR] Batch processing failed:", formatError(error));
      throw error;
    }
  }

  /**
   * Process batch sequentially (one record at a time)
   */
  private async processSequentialBatch(
    batch: ParticipantCsvRow[],
    batchStartIndex: number,
  ): Promise<{ successCount: number; errorCount: number }> {
    let successCount = 0;
    let errorCount = 0;

    for (let j = 0; j < batch.length; j++) {
      const rowNumber = batchStartIndex + j + 1;
      try {
        await this.processParticipationRow(batch[j]);
        successCount++;
      } catch (error) {
        errorCount++;
        this.handleProcessingError(batch[j], error, rowNumber);
      }
    }

    return { successCount, errorCount };
  }

  /**
   * Process batch in parallel (all records simultaneously)
   */
  private async processParallelBatch(
    batch: ParticipantCsvRow[],
    batchStartIndex: number,
  ): Promise<{ successCount: number; errorCount: number }> {
    const results = await Promise.allSettled(
      batch.map((record) => this.processParticipationRow(record)),
    );

    let successCount = 0;
    let errorCount = 0;

    results.forEach((result, index) => {
      const rowNumber = batchStartIndex + index + 1;
      if (result.status === "fulfilled") {
        successCount++;
      } else {
        errorCount++;
        this.handleProcessingError(batch[index], result.reason, rowNumber);
      }
    });

    return { successCount, errorCount };
  }

  /**
   * Process a single participation row
   * Ported from migrator.js with enhanced error handling
   */
  async processParticipationRow(row: ParticipantCsvRow): Promise<void> {
    // STEP 1: Get IDs from cache (must exist after phase 2)
    const implementacionKey = this.cacheManager.createImplementationKey(
      row.implementacion || "",
      row.ciclo_escolar || "",
      row.periodo_de_implementacion || "",
    );
    const implementacionId = this.cacheManager.getCachedId(
      "implementaciones",
      implementacionKey,
    );
    const cctId = row.cct
      ? this.cacheManager.getCachedId("ccts", row.cct)
      : null;

    // STEP 2: Handle participants "on the fly"
    const participantId = await this.entityManager.getOrCreate(
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
        estado_civil:
          row.estado_civil?.toUpperCase() !== "NA" ? row.estado_civil : null,
        lengua_indigena: toBoolean(row.lengua_indigena),
        hablante_maya: toBoolean(row.hablante_maya),
        nivel_educativo:
          row.nivel_educativo?.toUpperCase() !== "NA"
            ? row.nivel_educativo
            : null,
        cct: cctId,
      },
      "participantes",
      row.id,
    );

    if (!participantId || !implementacionId) {
      throw new Error(
        `Missing critical IDs for participant ${row.id}. ParticipantID: ${participantId}, ImplementationID: ${implementacionId}`,
      );
    }

    // STEP 3: Create participation record
    await this.createParticipation(row, participantId, implementacionId);

    // STEP 4: Handle participant email
    await this.handleParticipantEmail(row, participantId);
  }

  /**
   * Create participation record and related entities
   */
  private async createParticipation(
    row: ParticipantCsvRow,
    participantId: number,
    implementacionId: number,
  ): Promise<void> {
    // Check if participation already exists (unless omitting GET requests)
    if (!this.processingConfig.omitGet) {
      const existingParticipation = await this.api.get(
        `/participaciones?filters[participante][id][$eq]=${participantId}&filters[implementacion][id][$eq]=${implementacionId}&pagination[limit]=1`,
      );

      if (existingParticipation.data.data.length > 0) {
        console.log(
          "Participation already exists for this participant and implementation. Skipping...",
        );
        return;
      }
    }

    // Create participation record
    const participationResponse = await this.api.post("/participaciones", {
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

    const participationId = participationResponse.data.data.id;

    // Create related records in parallel
    const creationPromises: Promise<unknown>[] = [];

    // App usage record
    if (
      (row.minutos_app && row.minutos_app.toUpperCase() !== "NA") ||
      toBoolean(row.descarga_app)
    ) {
      creationPromises.push(
        this.api
          .post("/uso-app-participantes", {
            data: {
              participante: participantId,
              minutos_uso_app: toNumber(row.minutos_app) || 0,
              descargo_app: toBoolean(row.descarga_app),
            },
          })
          .catch(() => {}), // Ignore failures for non-critical records
      );
    }

    // Module progress records
    creationPromises.push(
      ...this.createModuleProgressRecords(
        row,
        participationId,
        implementacionId,
      ),
    );

    // Survey completion records
    creationPromises.push(
      ...this.createSurveyCompletionRecords(row, participationId),
    );

    // Attendance records
    creationPromises.push(
      ...this.createAttendanceRecords(row, participationId, implementacionId),
    );

    // Work completion records
    creationPromises.push(
      ...this.createWorkCompletionRecords(
        row,
        participationId,
        implementacionId,
      ),
    );

    // Wait for all related records to be created
    await Promise.allSettled(creationPromises);
  }

  /**
   * Create module progress records
   */
  private createModuleProgressRecords(
    row: ParticipantCsvRow,
    participationId: number,
    implementacionId: number,
  ): Promise<unknown>[] {
    const promises: Promise<unknown>[] = [];

    for (const moduleName of ["mod1", "mod2", "mod3"]) {
      const moduleValue = row[moduleName];
      if (
        moduleValue &&
        typeof moduleValue === "string" &&
        moduleValue.toUpperCase() !== "NA"
      ) {
        const cacheKey = this.cacheManager.createImplementationCacheKey(
          moduleName,
          implementacionId,
        );
        const moduleId = this.cacheManager.getCachedId("modulos", cacheKey);

        if (moduleId) {
          promises.push(
            this.api.post("/modulo-progreso-registros", {
              data: {
                participacion: participationId,
                modulo: moduleId,
                calificacion: toNumber(moduleValue),
              },
            }),
          );
        }
      }
    }

    return promises;
  }

  /**
   * Create survey completion records
   */
  private createSurveyCompletionRecords(
    row: ParticipantCsvRow,
    participationId: number,
  ): Promise<unknown>[] {
    const promises: Promise<unknown>[] = [];

    for (const surveyKey of ["encuesta_inicial", "encuesta_final"] as const) {
      const surveyValue = row[surveyKey];
      if (
        surveyValue &&
        typeof surveyValue === "string" &&
        surveyValue.toUpperCase() !== "NA"
      ) {
        const surveyId = this.cacheManager.getCachedId("encuestas", surveyKey);

        if (surveyId) {
          promises.push(
            this.api.post("/encuesta-completada-registros", {
              data: {
                participacion: participationId,
                encuesta: surveyId,
                estado: "Completada",
              },
            }),
          );
        }
      }
    }

    return promises;
  }

  /**
   * Create attendance records
   */
  private createAttendanceRecords(
    row: ParticipantCsvRow,
    participationId: number,
    implementacionId: number,
  ): Promise<unknown>[] {
    const promises: Promise<unknown>[] = [];

    const attendanceFields = Object.keys(row).filter(
      (key) =>
        key.startsWith("asist_") ||
        key.startsWith("trip") ||
        key.startsWith("ses"),
    );

    for (const field of attendanceFields) {
      const attendanceValue = row[field];
      if (
        attendanceValue &&
        typeof attendanceValue === "string" &&
        attendanceValue.toUpperCase() !== "NA"
      ) {
        const cacheKey = this.cacheManager.createImplementationCacheKey(
          field,
          implementacionId,
        );
        const attendanceId = this.cacheManager.getCachedId(
          "asistencias",
          cacheKey,
        );

        if (attendanceId) {
          promises.push(
            this.api.post("/participante-asistencia-registros", {
              data: {
                participacion: participationId,
                asistencia: attendanceId,
                presente: true,
              },
            }),
          );
        }
      }
    }

    return promises;
  }

  /**
   * Create work completion records
   */
  private createWorkCompletionRecords(
    row: ParticipantCsvRow,
    participationId: number,
    implementacionId: number,
  ): Promise<unknown>[] {
    const promises: Promise<unknown>[] = [];

    const workFields = Object.keys(row).filter(
      (key) => key.startsWith("trabajo") || key.startsWith("evidencia"),
    );

    for (const field of workFields) {
      const workValue = row[field];
      if (
        workValue &&
        typeof workValue === "string" &&
        workValue.toUpperCase() !== "NA"
      ) {
        const cacheKey = this.cacheManager.createImplementationCacheKey(
          field,
          implementacionId,
        );
        const workId = this.cacheManager.getCachedId("trabajos", cacheKey);

        if (workId) {
          promises.push(
            this.api.post("/trabajo-realizado-registros", {
              data: {
                participacion: participationId,
                trabajo: workId,
                completado: true,
              },
            }),
          );
        }
      }
    }

    return promises;
  }

  /**
   * Handle participant email management
   */
  private async handleParticipantEmail(
    row: ParticipantCsvRow,
    participantId: number,
  ): Promise<void> {
    const email = row.email?.trim();

    if (!email || email.toUpperCase() === "NA") {
      return;
    }

    if (this.processingConfig.omitGet) {
      // Fast path: create email directly
      await this.api.post("/correo-participantes", {
        data: {
          participante: participantId,
          correo: email,
          principal: true,
        },
      });
      return;
    }

    // Check if participant has any emails
    const existingEmails = await this.api.get(
      `/correo-participantes?filters[participante][id][$eq]=${participantId}&pagination[limit]=1`,
    );

    const shouldBePrincipal = existingEmails.data.data.length === 0;

    // Check if this specific email already exists
    const existingSpecificEmail = await this.api.get(
      `/correo-participantes?filters[participante][id][$eq]=${participantId}&filters[correo][$eq]=${encodeURIComponent(email)}&pagination[limit]=1`,
    );

    if (existingSpecificEmail.data.data.length === 0) {
      // Email doesn't exist, create it
      await this.api.post("/correo-participantes", {
        data: {
          participante: participantId,
          correo: email,
          principal: shouldBePrincipal,
        },
      });
      console.log(
        `   → Email assigned: ${email} (principal=${shouldBePrincipal})`,
      );
    } else {
      console.log(`   → Email already registered: ${email}`);
    }
  }

  /**
   * Handle processing errors with detailed logging
   */
  private handleProcessingError(
    row: ParticipantCsvRow,
    error: unknown,
    rowNumber: number,
  ): void {
    const participantId = row.id || "UNKNOWN_ID";
    const email = row.email || "";
    const errorMessage = formatError(error);

    console.error(
      `[ERROR] Row ${rowNumber} (ID=${participantId}) failed:`,
      errorMessage,
    );

    this.errorRecords.push({
      participantId,
      email,
      error: errorMessage,
      rowNumber,
    });
  }
  /**
   * Get processing statistics
   */
  getStats(): ProcessingStats {
    return { ...this.stats };
  }

  /**
   * Get error records
   */
  getErrorRecords(): ErrorRecord[] {
    return [...this.errorRecords];
  }
}
