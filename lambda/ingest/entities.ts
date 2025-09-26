/**
 * Entity creation and management functions
 * Handles creation of all Strapi entities with proper error handling
 */

import { AxiosInstance } from "axios";
import { Readable } from "node:stream";
import csvParser from "csv-parser";
import { CacheManager } from "./cache";
import { CCTsManager } from "./ccts-manager";
import {
  Dict,
  ProcessingConfig,
  StrapiCreateResponse,
  StrapiEntity,
  StrapiListResponse,
  UniqueSets,
} from "./types";
import { formatError } from "./utils";

/**
 * Entity manager class that handles all entity creation operations
 */
export class EntityManager {
  private api: AxiosInstance;
  private cacheManager: CacheManager;
  private processingConfig: ProcessingConfig;
  private cctsManager?: CCTsManager;

  constructor(
    api: AxiosInstance,
    cacheManager: CacheManager,
    processingConfig: ProcessingConfig,
    cctsManager?: CCTsManager,
  ) {
    this.api = api;
    this.cacheManager = cacheManager;
    this.processingConfig = processingConfig;
    this.cctsManager = cctsManager;
  }

  /**
   * Generic get-or-create function with improved error handling
   */
  async getOrCreate(
    endpoint: string,
    filters: Dict<unknown>,
    createData: unknown,
    cacheType: keyof import("./types").CacheMaps,
    cacheKey: string | undefined,
  ): Promise<number | null> {
    // Check cache first
    if (cacheKey && this.cacheManager.hasCachedId(cacheType, cacheKey)) {
      return this.cacheManager.getCachedId(cacheType, cacheKey)!;
    }

    let qs = "";

    // Perform GET request unless omitted for performance
    if (
      !this.processingConfig.omitGet ||
      (this.processingConfig.omitGet && endpoint === "participantes")
    ) {
      qs = Object.entries(filters)
        .map(([k, v]) => `filters[${k}][$eq]=${encodeURIComponent(String(v))}`)
        .join("&");

      try {
        const { data: getRes } = await this.api.get<
          StrapiListResponse<StrapiEntity>
        >(`/${endpoint}?${qs}&pagination[limit]=1`);

        if (getRes.data.length > 0) {
          const id = getRes.data[0].id;
          if (cacheKey) this.cacheManager.setCachedId(cacheType, cacheKey, id);
          return id;
        }
      } catch (error) {
        console.warn(
          `[WARN] GET request failed for ${endpoint}:`,
          formatError(error),
        );
        // Continue to creation attempt
      }
    }

    // If no createData provided, return null
    if (!createData) return null;

    // Attempt to create the entity
    try {
      const { data: postRes } = await this.api.post<
        StrapiCreateResponse<StrapiEntity>
      >(`/${endpoint}`, {
        data: createData,
      });

      const newId = postRes.data.id;
      if (cacheKey) this.cacheManager.setCachedId(cacheType, cacheKey, newId);
      return newId;
    } catch (error: unknown) {
      // Handle race condition for unique constraint violations
      const err = error as {
        response?: {
          data?: { error?: { message?: string } };
        };
      };

      if (
        err.response?.data?.error?.message &&
        err.response.data.error.message.includes("unique constraint")
      ) {
        console.warn(
          `[WARN] Race condition detected for ${endpoint}. Re-attempting search...`,
        );

        try {
          const { data: refetchRes } = await this.api.get<
            StrapiListResponse<StrapiEntity>
          >(`/${endpoint}?${qs}&pagination[limit]=1`);

          if (refetchRes.data.length > 0) {
            const id = refetchRes.data[0].id;
            if (cacheKey)
              this.cacheManager.setCachedId(cacheType, cacheKey, id);
            return id;
          }
        } catch (refetchError) {
          console.error(
            `[ERROR] Failed to refetch after race condition for ${endpoint}:`,
            formatError(refetchError),
          );
        }
      }

      // Re-throw the original error
      throw error;
    }
  }

  /**
   * Pre-cache simple entities by downloading all records from Strapi
   */
  async precacheSimpleEntities(
    endpoint: string,
    fieldName: string,
    uniqueValues?: Set<string>,
  ): Promise<void> {
    const cache = this.cacheManager.getCache();
    const localCache = cache[endpoint as keyof typeof cache];

    if (!localCache) {
      throw new Error(`Invalid cache type: ${endpoint}`);
    }

    await this.cacheManager.precacheSimpleEntities(
      endpoint,
      fieldName,
      localCache,
    );
  }

  /**
   * Initialize CCTs manager (replaces loadCctsFromCsv)
   */
  async initializeCCTsManager(): Promise<void> {
    if (!this.cctsManager) {
      console.log("[CCT] No CCTs manager configured, continuing without CCTs optimization");
      return;
    }

    try {
      await this.cctsManager.initialize();
      const stats = this.cctsManager.getCacheStats();
      const metrics = this.cctsManager.getPerformanceMetrics();
      
      console.log(`[CCT] CCTs manager initialized: ${stats.mode} mode`);
      console.log(`[CCT] Records available: ${metrics.recordCount}`);
      console.log(`[CCT] Memory usage: ${Math.round(metrics.memoryUsage)}MB`);
    } catch (error) {
      console.warn(
        "[CCT] Failed to initialize CCTs manager, continuing without CCTs:",
        formatError(error),
      );
    }
  }

  /**
   * Get or create CCT using memory-efficient approach
   */
  async getOrCreateCCT(clave: string): Promise<number | null> {
    if (!this.cctsManager) {
      // Fallback to direct API call if no CCTs manager
      return await this.getOrCreate(
        "ccts",
        { clave },
        null, // Don't create CCTs automatically
        "ccts",
        clave,
      );
    }

    return await this.cctsManager.getOrCreateCCT(clave);
  }

  /**
   * Create all programs from unique set
   */
  async createPrograms(uniquePrograms: Set<string>): Promise<void> {
    console.log(`[SETUP] Creating ${uniquePrograms.size} unique programs...`);

    for (const programaNombre of uniquePrograms) {
      await this.getOrCreate(
        "programas",
        { nombre: programaNombre },
        { nombre: programaNombre },
        "programas",
        programaNombre,
      );
    }

    const stats = this.cacheManager.getCacheStats();
    console.log(`[SETUP] Programs in cache: ${stats.programas}`);
  }

  /**
   * Create all implementations from unique set
   */
  async createImplementations(
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
      `[SETUP] Creating ${uniqueImplementations.size} unique implementations...`,
    );

    const cache = this.cacheManager.getCache();

    // Get all survey IDs for implementations
    const surveyIds = Array.from(cache.encuestas.values());

    for (const [key, impl] of uniqueImplementations.entries()) {
      if (!impl.programa) continue;

      const programaId = cache.programas.get(impl.programa);
      if (!programaId) {
        console.warn(`[WARN] Program not found in cache: ${impl.programa}`);
        continue;
      }

      await this.getOrCreate(
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
          programa: programaId,
          encuestas: surveyIds,
        },
        "implementaciones",
        key,
      );
    }

    const stats = this.cacheManager.getCacheStats();
    console.log(`[SETUP] Implementations in cache: ${stats.implementaciones}`);
  }

  /**
   * Create implementation-dependent entities (modules, attendances, jobs)
   */
  async createImplementationDependentEntities(
    uniqueSets: UniqueSets,
  ): Promise<void> {
    console.log("[SETUP] Creating implementation-dependent entities...");

    const cache = this.cacheManager.getCache();

    for (const [
      implKey,
      implementacionId,
    ] of cache.implementaciones.entries()) {
      // Create modules
      for (const mod of ["mod1", "mod2", "mod3"]) {
        const cacheKey = this.cacheManager.createImplementationCacheKey(
          mod,
          implementacionId,
        );
        await this.getOrCreate(
          "modulos",
          { nombre: mod, implementacion: implementacionId },
          {
            nombre: mod,
            implementacion: implementacionId,
          },
          "modulos",
          cacheKey,
        );
      }

      // Create attendances with modality
      for (const field of uniqueSets.asistenciaFields) {
        const mapKey = `${implKey}|${field}`;
        const tipoSesion = uniqueSets.asistenciaModalities.get(mapKey) || null;
        const cacheKey = this.cacheManager.createImplementationCacheKey(
          field,
          implementacionId,
        );

        await this.getOrCreate(
          "asistencias",
          { clave_sesion: field, implementacion: implementacionId },
          {
            clave_sesion: field,
            modalidad: tipoSesion,
            implementacion: implementacionId,
          },
          "asistencias",
          cacheKey,
        );
      }

      // Create jobs/works
      for (const field of uniqueSets.trabajoFields) {
        const cacheKey = this.cacheManager.createImplementationCacheKey(
          field,
          implementacionId,
        );
        await this.getOrCreate(
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

    // Log final statistics
    const stats = this.cacheManager.getCacheStats();
    console.log(`[SETUP] Modules in cache: ${stats.modulos}`);
    console.log(`[SETUP] Attendances in cache: ${stats.asistencias}`);
    console.log(`[SETUP] Jobs in cache: ${stats.trabajos}`);
  }

  /**
   * Initialize all caches and pre-load entities
   */
  async initializeAllCaches(
    uniqueSets: UniqueSets,
    cctsCsv?: Readable,
  ): Promise<void> {
    console.log("\n--- PHASE 2: Pre-loading and creating parent entities ---");
    console.time("Entity Creation Phase");

    try {
      // Initialize CCTs manager and surveys in parallel
      await Promise.all([
        this.initializeCCTsManager(),
        this.precacheSimpleEntities("encuestas", "clave"),
      ]);

      const cacheStats = this.cacheManager.getCacheStats();
      const cctsStats = this.cctsManager?.getCacheStats();
      
      console.log(
        `[CACHE] CCTs available: ${cctsStats?.size || 0}/${uniqueSets.ccts.size} (${cctsStats?.mode || 'none'})`,
      );
      console.log(`[CACHE] Surveys found: ${cacheStats.encuestas}`);

      // Create programs sequentially to avoid race conditions
      await this.createPrograms(uniqueSets.programas);

      // Create implementations sequentially
      await this.createImplementations(uniqueSets.implementaciones);

      // Create implementation-dependent entities
      await this.createImplementationDependentEntities(uniqueSets);

      console.timeEnd("Entity Creation Phase");

      // Log final cache validation
      const validation = this.cacheManager.validateCache();
      if (!validation.isValid) {
        console.warn("[WARN] Cache validation issues:", validation.issues);
      } else {
        console.log("[CACHE] Cache validation passed ✅");
      }

      // Log CCTs performance metrics if available
      if (this.cctsManager) {
        const metrics = this.cctsManager.getPerformanceMetrics();
        console.log("[CCTs] Performance metrics:");
        console.log(`  - Loading time: ${metrics.loadingTime}ms`);
        console.log(`  - Memory usage: ${Math.round(metrics.memoryUsage)}MB`);
        console.log(`  - Records: ${metrics.recordCount}`);
        if (metrics.cacheHitRate !== undefined) {
          console.log(`  - Cache hit rate: ${Math.round(metrics.cacheHitRate * 100)}%`);
        }
        if (metrics.apiCallsSaved !== undefined) {
          console.log(`  - API calls saved: ${metrics.apiCallsSaved}`);
        }
      }
    } catch (error) {
      console.error("[ERROR] Failed to initialize caches:", formatError(error));
      throw error;
    }
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): Record<string, number> {
    return this.cacheManager.getCacheStats();
  }

  /**
   * Validate cache state
   */
  validateCache(): { isValid: boolean; issues: string[] } {
    return this.cacheManager.validateCache();
  }
}
