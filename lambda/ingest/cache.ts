/**
 * Cache management system for migrator lambda
 * Handles all entity caching with proper TypeScript typing
 */

import { CacheMaps, StrapiEntity, StrapiListResponse } from "./types";
import { AxiosInstance } from "axios";
import { createCacheKey, formatError } from "./utils";

/**
 * Cache manager class that handles all entity caching operations
 */
export class CacheManager {
  private cache: CacheMaps;
  private api: AxiosInstance;

  constructor(api: AxiosInstance) {
    this.api = api;
    this.cache = this.initializeCache();
  }

  /**
   * Initialize empty cache structure
   */
  private initializeCache(): CacheMaps {
    return {
      programas: new Map<string, number>(),
      ccts: new Map<string, number>(),
      participantes: new Map<string, number>(),
      implementaciones: new Map<string, number>(),
      modulos: new Map<string, number>(),
      encuestas: new Map<string, number>(),
      asistencias: new Map<string, number>(),
      trabajos: new Map<string, number>(),
    };
  }

  /**
   * Get the current cache state
   */
  getCache(): CacheMaps {
    return this.cache;
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.cache = this.initializeCache();
  }

  /**
   * Get cache statistics for debugging
   */
  getCacheStats(): Record<string, number> {
    return {
      programas: this.cache.programas.size,
      ccts: this.cache.ccts.size,
      participantes: this.cache.participantes.size,
      implementaciones: this.cache.implementaciones.size,
      modulos: this.cache.modulos.size,
      encuestas: this.cache.encuestas.size,
      asistencias: this.cache.asistencias.size,
      trabajos: this.cache.trabajos.size,
    };
  }

  /**
   * Log cache statistics
   */
  logCacheStats(context: string = ""): void {
    const stats = this.getCacheStats();
    const prefix = context ? `[${context}] ` : "";

    console.log(`${prefix}Cache Statistics:`);
    Object.entries(stats).forEach(([entity, count]) => {
      console.log(`  ${entity}: ${count} entries`);
    });
  }

  /**
   * Validate cache integrity - check for expected entries
   */
  validateCache(): { isValid: boolean; issues: string[] } {
    const issues: string[] = [];

    // Check if critical caches have entries
    if (this.cache.programas.size === 0) {
      issues.push("No programs found in cache");
    }

    if (this.cache.implementaciones.size === 0) {
      issues.push("No implementations found in cache");
    }

    if (this.cache.encuestas.size === 0) {
      issues.push("No surveys found in cache");
    }

    // Check for orphaned entries (modules without implementations)
    let orphanedModules = 0;
    for (const [key] of this.cache.modulos) {
      const parts = key.split("|");
      if (parts.length >= 2) {
        const implId = parseInt(parts[1]);
        const hasImpl = Array.from(
          this.cache.implementaciones.values(),
        ).includes(implId);
        if (!hasImpl) {
          orphanedModules++;
        }
      }
    }

    if (orphanedModules > 0) {
      issues.push(`Found ${orphanedModules} orphaned modules`);
    }

    return {
      isValid: issues.length === 0,
      issues,
    };
  }

  /**
   * Pre-cache simple entities by downloading all records from Strapi
   */
  async precacheSimpleEntities(
    endpoint: string,
    fieldName: string,
    localCache: Map<string, number>,
  ): Promise<void> {
    console.log(`[CACHE] Downloading all ${endpoint} entities by pages...`);

    let page = 1;
    const pageSize = 1000;
    let totalLoaded = 0;

    try {
      while (true) {
        const { data: res } = await this.api.get<
          StrapiListResponse<StrapiEntity & Record<string, unknown>>
        >(
          `/${endpoint}?pagination[page]=${page}&pagination[pageSize]=${pageSize}&fields=id,${fieldName}`,
        );

        if (!res.data.length) break;

        for (const ent of res.data) {
          const key = ent[fieldName];
          if (key !== undefined && typeof key === "string") {
            localCache.set(key, ent.id);
            totalLoaded++;
          }
        }

        page++;
      }

      console.log(`[CACHE] Loaded ${totalLoaded} ${endpoint} entities`);
    } catch (error) {
      console.log(error);
      const errorMsg = formatError(error, { endpoint, fieldName });
      console.error(`[CACHE] Failed to load ${endpoint}:`, errorMsg);
      throw new Error(`Failed to pre-cache ${endpoint}: ${errorMsg}`);
    }
  }

  /**
   * Load CCTs from CSV data and store in cache
   */
  async loadCctsFromCsv(
    csvData: Array<{ clave: string; id: string }>,
  ): Promise<void> {
    console.log(`[CACHE] Loading ${csvData.length} CCTs from CSV data...`);

    let loaded = 0;
    for (const row of csvData) {
      if (row.clave && row.id) {
        const id = parseInt(row.id);
        if (!isNaN(id)) {
          this.cache.ccts.set(row.clave, id);
          loaded++;
        }
      }
    }

    console.log(`[CACHE] Loaded ${loaded} CCTs from CSV`);
  }

  /**
   * Get entity ID from cache
   */
  getCachedId(cacheType: keyof CacheMaps, key: string): number | undefined {
    return this.cache[cacheType].get(key);
  }

  /**
   * Set entity ID in cache
   */
  setCachedId(cacheType: keyof CacheMaps, key: string, id: number): void {
    this.cache[cacheType].set(key, id);
  }

  /**
   * Check if entity exists in cache
   */
  hasCachedId(cacheType: keyof CacheMaps, key: string): boolean {
    return this.cache[cacheType].has(key);
  }

  /**
   * Create cache key for implementation-dependent entities
   */
  createImplementationCacheKey(
    entityName: string,
    implementationId: number,
  ): string {
    return createCacheKey([entityName, implementationId.toString()]);
  }

  /**
   * Create cache key for implementation entities
   */
  createImplementationKey(
    nombre: string,
    cicloEscolar: string,
    periodo: string,
  ): string {
    return createCacheKey([nombre, cicloEscolar, periodo]);
  }

  /**
   * Bulk set cache entries for better performance
   */
  bulkSetCache(
    cacheType: keyof CacheMaps,
    entries: Array<{ key: string; id: number }>,
  ): void {
    const cache = this.cache[cacheType];
    for (const { key, id } of entries) {
      cache.set(key, id);
    }
  }

  /**
   * Get all keys from a specific cache
   */
  getCacheKeys(cacheType: keyof CacheMaps): string[] {
    return Array.from(this.cache[cacheType].keys());
  }

  /**
   * Get all values from a specific cache
   */
  getCacheValues(cacheType: keyof CacheMaps): number[] {
    return Array.from(this.cache[cacheType].values());
  }

  /**
   * Export cache state for debugging or persistence
   */
  exportCache(): Record<string, Array<[string, number]>> {
    return {
      programas: Array.from(this.cache.programas.entries()),
      ccts: Array.from(this.cache.ccts.entries()),
      participantes: Array.from(this.cache.participantes.entries()),
      implementaciones: Array.from(this.cache.implementaciones.entries()),
      modulos: Array.from(this.cache.modulos.entries()),
      encuestas: Array.from(this.cache.encuestas.entries()),
      asistencias: Array.from(this.cache.asistencias.entries()),
      trabajos: Array.from(this.cache.trabajos.entries()),
    };
  }

  /**
   * Import cache state from exported data
   */
  importCache(cacheData: Record<string, Array<[string, number]>>): void {
    this.cache = this.initializeCache();

    for (const [cacheType, entries] of Object.entries(cacheData)) {
      if (cacheType in this.cache) {
        const cache = this.cache[cacheType as keyof CacheMaps];
        for (const [key, id] of entries) {
          cache.set(key, id);
        }
      }
    }
  }

  /**
   * Find cache entries by partial key match
   */
  findCacheEntries(
    cacheType: keyof CacheMaps,
    partialKey: string,
  ): Array<{ key: string; id: number }> {
    const cache = this.cache[cacheType];
    const results: Array<{ key: string; id: number }> = [];

    for (const [key, id] of cache.entries()) {
      if (key.includes(partialKey)) {
        results.push({ key, id });
      }
    }

    return results;
  }

  /**
   * Remove entries from cache by key pattern
   */
  removeCacheEntries(cacheType: keyof CacheMaps, keyPattern: RegExp): number {
    const cache = this.cache[cacheType];
    const keysToRemove: string[] = [];

    for (const key of cache.keys()) {
      if (keyPattern.test(key)) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      cache.delete(key);
    }

    return keysToRemove.length;
  }
}
