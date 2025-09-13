/**
 * Unit tests for cache management system
 */

import { CacheManager } from "./cache";
import { AxiosInstance } from "axios";

// Mock axios instance
const mockApi = {
  get: jest.fn(),
} as unknown as AxiosInstance;

describe("CacheManager", () => {
  let cacheManager: CacheManager;

  beforeEach(() => {
    cacheManager = new CacheManager(mockApi);
    jest.clearAllMocks();
  });

  describe("initialization", () => {
    test("initializes with empty cache", () => {
      const cache = cacheManager.getCache();
      expect(cache.programas.size).toBe(0);
      expect(cache.ccts.size).toBe(0);
      expect(cache.participantes.size).toBe(0);
      expect(cache.implementaciones.size).toBe(0);
      expect(cache.modulos.size).toBe(0);
      expect(cache.encuestas.size).toBe(0);
      expect(cache.asistencias.size).toBe(0);
      expect(cache.trabajos.size).toBe(0);
    });
  });

  describe("cache operations", () => {
    test("sets and gets cached IDs", () => {
      cacheManager.setCachedId("programas", "test-program", 123);
      expect(cacheManager.getCachedId("programas", "test-program")).toBe(123);
      expect(cacheManager.hasCachedId("programas", "test-program")).toBe(true);
    });

    test("returns undefined for non-existent keys", () => {
      expect(cacheManager.getCachedId("programas", "non-existent")).toBeUndefined();
      expect(cacheManager.hasCachedId("programas", "non-existent")).toBe(false);
    });

    test("clears cache", () => {
      cacheManager.setCachedId("programas", "test-program", 123);
      cacheManager.clearCache();
      expect(cacheManager.getCachedId("programas", "test-program")).toBeUndefined();
    });
  });

  describe("cache statistics", () => {
    test("returns correct cache stats", () => {
      cacheManager.setCachedId("programas", "prog1", 1);
      cacheManager.setCachedId("programas", "prog2", 2);
      cacheManager.setCachedId("ccts", "cct1", 10);

      const stats = cacheManager.getCacheStats();
      expect(stats.programas).toBe(2);
      expect(stats.ccts).toBe(1);
      expect(stats.participantes).toBe(0);
    });

    test("logs cache stats", () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      
      cacheManager.setCachedId("programas", "prog1", 1);
      cacheManager.logCacheStats("TEST");

      expect(consoleSpy).toHaveBeenCalledWith("[TEST] Cache Statistics:");
      expect(consoleSpy).toHaveBeenCalledWith("  programas: 1 entries");
      
      consoleSpy.mockRestore();
    });
  });

  describe("cache validation", () => {
    test("identifies empty critical caches as invalid", () => {
      const validation = cacheManager.validateCache();
      expect(validation.isValid).toBe(false);
      expect(validation.issues).toContain("No programs found in cache");
      expect(validation.issues).toContain("No implementations found in cache");
      expect(validation.issues).toContain("No surveys found in cache");
    });

    test("validates populated cache as valid", () => {
      cacheManager.setCachedId("programas", "prog1", 1);
      cacheManager.setCachedId("implementaciones", "impl1", 2);
      cacheManager.setCachedId("encuestas", "survey1", 3);

      const validation = cacheManager.validateCache();
      expect(validation.isValid).toBe(true);
      expect(validation.issues).toHaveLength(0);
    });
  });

  describe("precacheSimpleEntities", () => {
    test("loads entities from API", async () => {
      const mockResponse = {
        data: {
          data: [
            { id: 1, nombre: "Program 1" },
            { id: 2, nombre: "Program 2" },
          ],
        },
      };

      (mockApi.get as jest.Mock)
        .mockResolvedValueOnce(mockResponse)
        .mockResolvedValueOnce({ data: { data: [] } }); // Empty response to end pagination

      const cache = cacheManager.getCache();
      await cacheManager.precacheSimpleEntities("programas", "nombre", cache.programas);

      expect(cache.programas.get("Program 1")).toBe(1);
      expect(cache.programas.get("Program 2")).toBe(2);
      expect(mockApi.get).toHaveBeenCalledWith(
        "/programas?pagination[page]=1&pagination[pageSize]=1000&fields=id,nombre"
      );
    });

    test("handles API errors", async () => {
      (mockApi.get as jest.Mock).mockRejectedValue(new Error("API Error"));

      const cache = cacheManager.getCache();
      await expect(
        cacheManager.precacheSimpleEntities("programas", "nombre", cache.programas)
      ).rejects.toThrow("Failed to pre-cache programas");
    });
  });

  describe("loadCctsFromCsv", () => {
    test("loads CCTs from CSV data", async () => {
      const csvData = [
        { clave: "CCT001", id: "1" },
        { clave: "CCT002", id: "2" },
        { clave: "INVALID", id: "not-a-number" },
      ];

      await cacheManager.loadCctsFromCsv(csvData);

      const cache = cacheManager.getCache();
      expect(cache.ccts.get("CCT001")).toBe(1);
      expect(cache.ccts.get("CCT002")).toBe(2);
      expect(cache.ccts.has("INVALID")).toBe(false);
    });
  });

  describe("bulk operations", () => {
    test("bulk sets cache entries", () => {
      const entries = [
        { key: "prog1", id: 1 },
        { key: "prog2", id: 2 },
        { key: "prog3", id: 3 },
      ];

      cacheManager.bulkSetCache("programas", entries);

      expect(cacheManager.getCachedId("programas", "prog1")).toBe(1);
      expect(cacheManager.getCachedId("programas", "prog2")).toBe(2);
      expect(cacheManager.getCachedId("programas", "prog3")).toBe(3);
    });

    test("gets cache keys and values", () => {
      cacheManager.setCachedId("programas", "prog1", 1);
      cacheManager.setCachedId("programas", "prog2", 2);

      const keys = cacheManager.getCacheKeys("programas");
      const values = cacheManager.getCacheValues("programas");

      expect(keys).toContain("prog1");
      expect(keys).toContain("prog2");
      expect(values).toContain(1);
      expect(values).toContain(2);
    });
  });

  describe("cache key creation", () => {
    test("creates implementation cache key", () => {
      const key = cacheManager.createImplementationCacheKey("mod1", 123);
      expect(key).toBe("mod1|123");
    });

    test("creates implementation key", () => {
      const key = cacheManager.createImplementationKey("impl1", "2023", "Q1");
      expect(key).toBe("impl1|2023|Q1");
    });
  });

  describe("cache export/import", () => {
    test("exports and imports cache state", () => {
      // Set up initial cache state
      cacheManager.setCachedId("programas", "prog1", 1);
      cacheManager.setCachedId("ccts", "cct1", 10);

      // Export cache
      const exported = cacheManager.exportCache();
      expect(exported.programas).toEqual([["prog1", 1]]);
      expect(exported.ccts).toEqual([["cct1", 10]]);

      // Clear and import
      cacheManager.clearCache();
      cacheManager.importCache(exported);

      // Verify import
      expect(cacheManager.getCachedId("programas", "prog1")).toBe(1);
      expect(cacheManager.getCachedId("ccts", "cct1")).toBe(10);
    });
  });

  describe("cache search and cleanup", () => {
    test("finds cache entries by partial key", () => {
      cacheManager.setCachedId("modulos", "mod1|123", 1);
      cacheManager.setCachedId("modulos", "mod2|123", 2);
      cacheManager.setCachedId("modulos", "mod1|456", 3);

      const results = cacheManager.findCacheEntries("modulos", "123");
      expect(results).toHaveLength(2);
      expect(results.map(r => r.key)).toContain("mod1|123");
      expect(results.map(r => r.key)).toContain("mod2|123");
    });

    test("removes cache entries by pattern", () => {
      cacheManager.setCachedId("modulos", "mod1|123", 1);
      cacheManager.setCachedId("modulos", "mod2|123", 2);
      cacheManager.setCachedId("modulos", "mod1|456", 3);

      const removed = cacheManager.removeCacheEntries("modulos", /\|123$/);
      expect(removed).toBe(2);
      expect(cacheManager.hasCachedId("modulos", "mod1|123")).toBe(false);
      expect(cacheManager.hasCachedId("modulos", "mod2|123")).toBe(false);
      expect(cacheManager.hasCachedId("modulos", "mod1|456")).toBe(true);
    });
  });
});