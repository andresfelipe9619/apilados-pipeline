/**
 * Entity creation and management functions
 * Handles creation of all Strapi entities with proper error handling
 */

import { AxiosInstance } from "axios";
import { Readable } from "node:stream";
import csvParser from "csv-parser";
import { CacheManager } from "./cache";
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

  constructor(
    api: AxiosInstance,
    cacheManager: CacheManager,
    processingConfig: ProcessingConfig,
  ) {
    this.api = api;
    this.cacheManager = cacheManager;
    this.processingConfig = processingConfig;
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
   * Load CCTs from CSV file with graceful fallback
   */
  async loadCctsFromCsv(csvStream: Readable | null): Promise<void> {
    if (!csvStream) {
      console.log("[CCT] No CCT CSV file provided, continuing without CCTs");
      return;
    }

    try {
      const cctData: Array<{ clave: string; id: string }> = [];

      await new Promise<void>((resolve, reject) => {
        csvStream
          .pipe(
            csvParser({
              separator: ",",
              mapHeaders: ({ header }) => header.trim().toLowerCase(),
            }),
          )
          .on("data", (row: { clave: string; id: string }) => {
            if (row.clave && row.id) {
              cctData.push({ clave: row.clave, id: row.id });
            }
          })
          .on("end", resolve)
          .on("error", reject);
      });

      await this.cacheManager.loadCctsFromCsv(cctData);
    } catch (error) {
      console.warn(
        "[CCT] Failed to load CCTs from CSV, continuing without CCTs:",
        formatError(error),
      );
    }
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
      // Load CCTs and surveys in parallel
      await Promise.all([
        this.loadCctsFromCsv(cctsCsv || null),
        this.precacheSimpleEntities("encuestas", "clave"),
      ]);

      const cacheStats = this.cacheManager.getCacheStats();
      console.log(
        `[CACHE] CCTs found: ${cacheStats.ccts}/${uniqueSets.ccts.size}`,
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
