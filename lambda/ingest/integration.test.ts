/**
 * Integration tests for the migrator lambda
 * Tests end-to-end functionality with sample CSV data
 */

import { Readable } from "node:stream";
import { ThreePhaseProcessingPipeline } from "./processing-pipeline";
import { CacheManager } from "./cache";
import { EntityManager } from "./entities";
import { createErrorReporter } from "./error-reporter";
import { ProcessingConfig } from "./types";
import axios from "axios";

// Mock axios for integration tests
jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("Integration Tests", () => {
  let mockApi: any;
  let cacheManager: CacheManager;
  let entityManager: EntityManager;
  let errorReporter: any;
  let processingConfig: ProcessingConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup mock API responses
    mockApi = {
      get: jest.fn(),
      post: jest.fn(),
    };

    processingConfig = {
      processMode: "parallel",
      omitGet: false,
      batchSize: 10,
      chunkSize: 100,
    };

    cacheManager = new CacheManager(mockApi);
    entityManager = new EntityManager(mockApi, cacheManager, processingConfig);
    errorReporter = createErrorReporter("local");
  });

  describe("End-to-End CSV Processing", () => {
    it("should process a complete CSV file successfully", async () => {
      // Sample CSV data with realistic participant information
      const csvData = `id,programa,implementacion,ciclo_escolar,periodo_de_implementacion,cct,nombre,email,edad,sexo
PART001,Programa A,Implementacion 1,2023,Periodo 1,CCT001,Juan Pérez,juan@example.com,25,M
PART002,Programa A,Implementacion 1,2023,Periodo 1,CCT002,María García,maria@example.com,30,F
PART003,Programa B,Implementacion 2,2023,Periodo 2,CCT003,Carlos López,carlos@example.com,28,M`;

      const csvStream = Readable.from([csvData]);

      // Mock successful API responses for entity creation
      mockApi.get
        .mockResolvedValueOnce({ data: { data: [] } }) // Programs search
        .mockResolvedValueOnce({ data: { data: [] } }) // Surveys search
        .mockResolvedValueOnce({ data: { data: [] } }) // Implementations search
        .mockResolvedValueOnce({ data: { data: [] } }) // Modules search
        .mockResolvedValueOnce({ data: { data: [] } }) // Attendances search
        .mockResolvedValueOnce({ data: { data: [] } }) // Jobs search
        .mockResolvedValue({ data: { data: [] } }); // Default for other searches

      mockApi.post
        .mockResolvedValueOnce({ data: { data: { id: 1 } } }) // Program creation
        .mockResolvedValueOnce({ data: { data: { id: 2 } } }) // Program creation
        .mockResolvedValueOnce({ data: { data: { id: 10 } } }) // Implementation creation
        .mockResolvedValueOnce({ data: { data: { id: 11 } } }) // Implementation creation
        .mockResolvedValueOnce({ data: { data: { id: 100 } } }) // Participant creation
        .mockResolvedValueOnce({ data: { data: { id: 101 } } }) // Participant creation
        .mockResolvedValueOnce({ data: { data: { id: 102 } } }) // Participant creation
        .mockResolvedValue({ data: { data: { id: 200 } } }); // Default for other creations

      const pipeline = new ThreePhaseProcessingPipeline(
        mockApi,
        entityManager,
        cacheManager,
        processingConfig
      );

      const result = await pipeline.executeFullPipeline(csvStream);

      expect(result.totalRecords).toBe(3);
      expect(result.successCount).toBe(3);
      expect(result.errorCount).toBe(0);
      expect(result.processingTime).toBeGreaterThan(0);
    });

    it("should handle CSV processing with errors gracefully", async () => {
      // CSV data with some invalid records
      const csvData = `id,programa,implementacion,ciclo_escolar,periodo_de_implementacion,cct,nombre,email,edad,sexo
PART001,Programa A,Implementacion 1,2023,Periodo 1,CCT001,Juan Pérez,juan@example.com,25,M
INVALID,,,,,,,,
PART003,Programa B,Implementacion 2,2023,Periodo 2,CCT003,Carlos López,carlos@example.com,28,M`;

      const csvStream = Readable.from([csvData]);

      // Mock API responses - some successful, some failing
      mockApi.get.mockResolvedValue({ data: { data: [] } });
      
      mockApi.post
        .mockResolvedValueOnce({ data: { data: { id: 1 } } }) // Program creation
        .mockResolvedValueOnce({ data: { data: { id: 2 } } }) // Program creation
        .mockResolvedValueOnce({ data: { data: { id: 10 } } }) // Implementation creation
        .mockResolvedValueOnce({ data: { data: { id: 11 } } }) // Implementation creation
        .mockResolvedValueOnce({ data: { data: { id: 100 } } }) // Participant creation
        .mockRejectedValueOnce(new Error("Invalid participant data")) // Participant creation fails
        .mockResolvedValueOnce({ data: { data: { id: 102 } } }) // Participant creation
        .mockResolvedValue({ data: { data: { id: 200 } } }); // Default for other creations

      const pipeline = new ThreePhaseProcessingPipeline(
        mockApi,
        entityManager,
        cacheManager,
        processingConfig
      );

      const result = await pipeline.executeFullPipeline(csvStream);

      expect(result.totalRecords).toBe(3);
      expect(result.successCount).toBe(2);
      expect(result.errorCount).toBe(1);
    });

    it("should process large datasets efficiently", async () => {
      // Generate a larger CSV dataset
      const headerRow = "id,programa,implementacion,ciclo_escolar,periodo_de_implementacion,cct,nombre,email,edad,sexo";
      const dataRows = [];
      
      for (let i = 1; i <= 50; i++) {
        dataRows.push(
          `PART${i.toString().padStart(3, '0')},Programa A,Implementacion 1,2023,Periodo 1,CCT001,Participant ${i},participant${i}@example.com,${20 + (i % 40)},${i % 2 === 0 ? 'F' : 'M'}`
        );
      }
      
      const csvData = [headerRow, ...dataRows].join('\n');
      const csvStream = Readable.from([csvData]);

      // Mock API responses for bulk processing
      mockApi.get.mockResolvedValue({ data: { data: [] } });
      mockApi.post.mockResolvedValue({ data: { data: { id: 1 } } });

      const pipeline = new ThreePhaseProcessingPipeline(
        mockApi,
        entityManager,
        cacheManager,
        processingConfig
      );

      const startTime = Date.now();
      const result = await pipeline.executeFullPipeline(csvStream);
      const processingTime = Date.now() - startTime;

      expect(result.totalRecords).toBe(50);
      expect(result.successCount).toBe(50);
      expect(result.errorCount).toBe(0);
      expect(processingTime).toBeLessThan(10000); // Should complete within 10 seconds
    });
  });

  describe("Local vs AWS Execution Mode Tests", () => {
    it("should handle local execution mode", async () => {
      const csvData = `id,programa,implementacion,ciclo_escolar,periodo_de_implementacion
PART001,Programa A,Implementacion 1,2023,Periodo 1`;

      const csvStream = Readable.from([csvData]);

      // Mock successful responses
      mockApi.get.mockResolvedValue({ data: { data: [] } });
      mockApi.post.mockResolvedValue({ data: { data: { id: 1 } } });

      const pipeline = new ThreePhaseProcessingPipeline(
        mockApi,
        entityManager,
        cacheManager,
        { ...processingConfig, processMode: "sequential" }
      );

      const result = await pipeline.executeFullPipeline(csvStream);

      expect(result.totalRecords).toBe(1);
      expect(result.successCount).toBe(1);
    });

    it("should handle parallel vs sequential processing modes", async () => {
      const csvData = `id,programa,implementacion,ciclo_escolar,periodo_de_implementacion
PART001,Programa A,Implementacion 1,2023,Periodo 1
PART002,Programa A,Implementacion 1,2023,Periodo 1
PART003,Programa A,Implementacion 1,2023,Periodo 1`;

      const csvStream1 = Readable.from([csvData]);
      const csvStream2 = Readable.from([csvData]);

      // Mock successful responses
      mockApi.get.mockResolvedValue({ data: { data: [] } });
      mockApi.post.mockResolvedValue({ data: { data: { id: 1 } } });

      // Test parallel processing
      const parallelPipeline = new ThreePhaseProcessingPipeline(
        mockApi,
        entityManager,
        cacheManager,
        { ...processingConfig, processMode: "parallel" }
      );

      const parallelResult = await parallelPipeline.executeFullPipeline(csvStream1);

      // Test sequential processing
      const sequentialPipeline = new ThreePhaseProcessingPipeline(
        mockApi,
        entityManager,
        cacheManager,
        { ...processingConfig, processMode: "sequential" }
      );

      const sequentialResult = await sequentialPipeline.executeFullPipeline(csvStream2);

      // Both should process the same number of records successfully
      expect(parallelResult.totalRecords).toBe(3);
      expect(sequentialResult.totalRecords).toBe(3);
      expect(parallelResult.successCount).toBe(3);
      expect(sequentialResult.successCount).toBe(3);
    });
  });

  describe("Error Handling and Recovery", () => {
    it("should handle API failures gracefully", async () => {
      const csvData = `id,programa,implementacion,ciclo_escolar,periodo_de_implementacion
PART001,Programa A,Implementacion 1,2023,Periodo 1`;

      const csvStream = Readable.from([csvData]);

      // Mock API failures
      mockApi.get.mockRejectedValue(new Error("API connection failed"));
      mockApi.post.mockRejectedValue(new Error("API connection failed"));

      const pipeline = new ThreePhaseProcessingPipeline(
        mockApi,
        entityManager,
        cacheManager,
        processingConfig
      );

      // Should not throw, but should handle errors gracefully
      await expect(pipeline.executeFullPipeline(csvStream)).rejects.toThrow();
    });

    it("should handle malformed CSV data", async () => {
      const malformedCsvData = `id,programa,implementacion
PART001,"Unclosed quote,Implementacion 1
PART002,Programa B,`;

      const csvStream = Readable.from([malformedCsvData]);

      const pipeline = new ThreePhaseProcessingPipeline(
        mockApi,
        entityManager,
        cacheManager,
        processingConfig
      );

      // Should handle malformed CSV gracefully
      const result = await pipeline.executeFullPipeline(csvStream);
      
      // May have some records processed, but should not crash
      expect(result.totalRecords).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Performance Tests", () => {
    it("should maintain performance with different batch sizes", async () => {
      const csvData = Array.from({ length: 20 }, (_, i) => 
        `PART${i.toString().padStart(3, '0')},Programa A,Implementacion 1,2023,Periodo 1`
      ).join('\n');
      const fullCsvData = `id,programa,implementacion,ciclo_escolar,periodo_de_implementacion\n${csvData}`;

      // Mock successful responses
      mockApi.get.mockResolvedValue({ data: { data: [] } });
      mockApi.post.mockResolvedValue({ data: { data: { id: 1 } } });

      // Test with small batch size
      const smallBatchConfig = { ...processingConfig, batchSize: 5 };
      const smallBatchPipeline = new ThreePhaseProcessingPipeline(
        mockApi,
        entityManager,
        cacheManager,
        smallBatchConfig
      );

      const smallBatchStream = Readable.from([fullCsvData]);
      const smallBatchResult = await smallBatchPipeline.executeFullPipeline(smallBatchStream);

      // Test with large batch size
      const largeBatchConfig = { ...processingConfig, batchSize: 20 };
      const largeBatchPipeline = new ThreePhaseProcessingPipeline(
        mockApi,
        entityManager,
        cacheManager,
        largeBatchConfig
      );

      const largeBatchStream = Readable.from([fullCsvData]);
      const largeBatchResult = await largeBatchPipeline.executeFullPipeline(largeBatchStream);

      // Both should process all records successfully
      expect(smallBatchResult.totalRecords).toBe(20);
      expect(largeBatchResult.totalRecords).toBe(20);
      expect(smallBatchResult.successCount).toBe(20);
      expect(largeBatchResult.successCount).toBe(20);
    });

    it("should handle memory efficiently with large datasets", async () => {
      // Generate a dataset that would test memory usage
      const headerRow = "id,programa,implementacion,ciclo_escolar,periodo_de_implementacion";
      const dataRows = Array.from({ length: 100 }, (_, i) => 
        `PART${i.toString().padStart(3, '0')},Programa A,Implementacion 1,2023,Periodo 1`
      );
      
      const csvData = [headerRow, ...dataRows].join('\n');
      const csvStream = Readable.from([csvData]);

      // Mock successful responses
      mockApi.get.mockResolvedValue({ data: { data: [] } });
      mockApi.post.mockResolvedValue({ data: { data: { id: 1 } } });

      const pipeline = new ThreePhaseProcessingPipeline(
        mockApi,
        entityManager,
        cacheManager,
        processingConfig
      );

      const initialMemory = process.memoryUsage().heapUsed;
      const result = await pipeline.executeFullPipeline(csvStream);
      const finalMemory = process.memoryUsage().heapUsed;

      expect(result.totalRecords).toBe(100);
      expect(result.successCount).toBe(100);
      
      // Memory usage should not grow excessively (less than 50MB increase)
      const memoryIncrease = finalMemory - initialMemory;
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024); // 50MB
    });
  });
});