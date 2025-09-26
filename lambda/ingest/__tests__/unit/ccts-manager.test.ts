/**
 * Unit tests for CCTsManager - Memory-efficient CCTs data management
 * Tests both pre-loading and on-demand modes with various configurations
 * 
 * Requirements covered:
 * - Memory-efficient CCTs loading with getOrCreate approach
 * - S3-based CCTs data retrieval with memory optimization
 * - CCTs getOrCreate with caching to avoid duplicate API calls
 * - CCTs data format validation with streaming parser
 * - Performance impact tracking with and without CCTs pre-loading
 * - Graceful handling of missing CCTs data
 * - Configuration to choose between pre-loading vs on-demand CCTs creation
 */

import { CCTsManager, createCCTsManager, CCTsManagerConfig } from '../../ccts-manager';
import { AxiosInstance } from 'axios';
import { Readable } from 'node:stream';
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Mock AWS SDK
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  GetObjectCommand: jest.fn(),
}));

describe('CCTsManager', () => {
  const testDir = join(__dirname, 'test-ccts-manager');
  const testCctsFile = join(testDir, 'test_ccts.csv');
  
  let mockApi: jest.Mocked<AxiosInstance>;
  let consoleSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeAll(() => {
    // Mock console methods to reduce test output noise
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    // Restore console methods
    consoleSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  beforeEach(() => {
    // Create test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });

    // Mock Axios instance
    mockApi = {
      get: jest.fn(),
    } as any;

    // Reset environment variables
    delete process.env.CCTS_S3_BUCKET;
    delete process.env.CCTS_S3_KEY;
    delete process.env.CCTS_LOCAL_PATH;
    delete process.env.CCTS_USE_PRELOADING;
    delete process.env.CCTS_MAX_MEMORY_MB;
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Configuration and Initialization', () => {
    it('should create CCTsManager with default configuration', () => {
      const config: CCTsManagerConfig = {
        environment: 'local',
        usePreloading: true,
        maxMemoryUsageMB: 1024,
        enablePerformanceTracking: true,
      };

      const manager = new CCTsManager(mockApi, config);
      expect(manager).toBeDefined();
      expect(manager.isUsingOnDemandMode()).toBe(false);
      expect(manager.getCacheStats().isInitialized).toBe(false);
    });

    it('should create CCTsManager with S3 configuration', () => {
      const config: CCTsManagerConfig = {
        environment: 'production',
        usePreloading: false,
        maxMemoryUsageMB: 512,
        enablePerformanceTracking: true,
        s3Config: {
          bucket: 'test-bucket',
          key: 'ccts_export.csv',
          region: 'us-east-1',
        },
      };

      const manager = new CCTsManager(mockApi, config);
      expect(manager).toBeDefined();
      expect(manager.getConfigSummary().hasS3Config).toBe(true);
    });

    it('should create CCTsManager with local file configuration', () => {
      // Create test CCTs file
      writeFileSync(testCctsFile, 'id,clave\n1,01DJN0002D\n2,01DST0046C\n');

      const config: CCTsManagerConfig = {
        environment: 'local',
        usePreloading: true,
        maxMemoryUsageMB: 1024,
        enablePerformanceTracking: true,
        localPath: testCctsFile,
      };

      const manager = new CCTsManager(mockApi, config);
      expect(manager).toBeDefined();
      expect(manager.getConfigSummary().hasLocalPath).toBe(true);
    });
  });

  describe('Factory Function', () => {
    it('should create CCTsManager for local environment', () => {
      const manager = createCCTsManager(mockApi, 'local', {} as any);
      
      expect(manager).toBeDefined();
      const config = manager.getConfigSummary();
      expect(config.environment).toBe('local');
      expect(config.usePreloading).toBe(true); // Default for local
      expect(config.maxMemoryUsageMB).toBe(1024); // Default for local
    });

    it('should create CCTsManager for production environment', () => {
      const manager = createCCTsManager(mockApi, 'production', {} as any);
      
      expect(manager).toBeDefined();
      const config = manager.getConfigSummary();
      expect(config.environment).toBe('production');
      expect(config.usePreloading).toBe(false); // Default for production
      expect(config.maxMemoryUsageMB).toBe(512); // Conservative for production
    });

    it('should respect environment variable overrides', () => {
      process.env.CCTS_USE_PRELOADING = 'true';
      process.env.CCTS_MAX_MEMORY_MB = '256';
      process.env.CCTS_LOCAL_PATH = testCctsFile;

      const manager = createCCTsManager(mockApi, 'local', {} as any);
      
      const config = manager.getConfigSummary();
      expect(config.usePreloading).toBe(true);
      expect(config.maxMemoryUsageMB).toBe(256);
      expect(config.hasLocalPath).toBe(true);
    });

    it('should configure S3 settings for production', () => {
      process.env.CCTS_S3_BUCKET = 'production-bucket';
      process.env.CCTS_S3_KEY = 'data/ccts_export.csv';
      process.env.AWS_REGION = 'us-west-2';

      const manager = createCCTsManager(mockApi, 'production', {} as any);
      
      const config = manager.getConfigSummary();
      expect(config.hasS3Config).toBe(true);
    });
  });

  describe('Data Availability Detection', () => {
    it('should detect missing CCTs data and use on-demand mode', async () => {
      const config: CCTsManagerConfig = {
        environment: 'local',
        usePreloading: true,
        maxMemoryUsageMB: 1024,
        enablePerformanceTracking: true,
        localPath: '/nonexistent/path.csv',
      };

      const manager = new CCTsManager(mockApi, config);
      await manager.initialize();

      expect(manager.isUsingOnDemandMode()).toBe(true);
      expect(manager.getCacheStats().isInitialized).toBe(true);
    });

    it('should detect available local CCTs data', async () => {
      // Create valid CCTs file
      writeFileSync(testCctsFile, 'id,clave\n1,01DJN0002D\n2,01DST0046C\n');

      const config: CCTsManagerConfig = {
        environment: 'local',
        usePreloading: true,
        maxMemoryUsageMB: 1024,
        enablePerformanceTracking: true,
        localPath: testCctsFile,
      };

      const manager = new CCTsManager(mockApi, config);
      await manager.initialize();

      expect(manager.getCacheStats().isInitialized).toBe(true);
      // Should use pre-loading mode for small valid file
      expect(manager.isUsingOnDemandMode()).toBe(false);
    });
  });

  describe('Data Validation', () => {
    it('should validate CCTs data format correctly', async () => {
      // Create valid CCTs file
      const validCctsData = 'id,clave\n1,01DJN0002D\n2,01DST0046C\n3,01FED0001A\n';
      writeFileSync(testCctsFile, validCctsData);

      const config: CCTsManagerConfig = {
        environment: 'local',
        usePreloading: true,
        maxMemoryUsageMB: 1024,
        enablePerformanceTracking: true,
        localPath: testCctsFile,
      };

      const manager = new CCTsManager(mockApi, config);
      await manager.initialize();

      const stats = manager.getCacheStats();
      expect(stats.isInitialized).toBe(true);
      expect(stats.size).toBe(3); // Should have loaded 3 records
    });

    it('should handle invalid CCTs data format', async () => {
      // Create invalid CCTs file (missing required columns)
      writeFileSync(testCctsFile, 'name,value\nTest,123\n');

      const config: CCTsManagerConfig = {
        environment: 'local',
        usePreloading: true,
        maxMemoryUsageMB: 1024,
        enablePerformanceTracking: true,
        localPath: testCctsFile,
      };

      const manager = new CCTsManager(mockApi, config);
      await manager.initialize();

      // Should fall back to on-demand mode due to validation failure
      expect(manager.isUsingOnDemandMode()).toBe(true);
    });

    it('should handle empty CCTs file gracefully', async () => {
      // Create empty CCTs file
      writeFileSync(testCctsFile, '');

      const config: CCTsManagerConfig = {
        environment: 'local',
        usePreloading: true,
        maxMemoryUsageMB: 1024,
        enablePerformanceTracking: true,
        localPath: testCctsFile,
      };

      const manager = new CCTsManager(mockApi, config);
      await manager.initialize();

      // Should fall back to on-demand mode
      expect(manager.isUsingOnDemandMode()).toBe(true);
    });
  });

  describe('Memory Management', () => {
    it('should switch to on-demand mode when memory limit is exceeded', async () => {
      // Create large CCTs file that would exceed memory limit
      let largeCctsData = 'id,clave\n';
      for (let i = 1; i <= 20000; i++) { // 20000 records × 100 bytes = 2MB
        largeCctsData += `${i},CCT${i.toString().padStart(6, '0')}\n`;
      }
      writeFileSync(testCctsFile, largeCctsData);

      const config: CCTsManagerConfig = {
        environment: 'local',
        usePreloading: true,
        maxMemoryUsageMB: 1, // 1MB limit, should be exceeded by 2MB
        enablePerformanceTracking: true,
        localPath: testCctsFile,
      };

      const manager = new CCTsManager(mockApi, config);
      await manager.initialize();

      // Should use on-demand mode due to memory constraints
      expect(manager.isUsingOnDemandMode()).toBe(true);
    });

    it('should use pre-loading mode when memory limit allows', async () => {
      // Create small CCTs file
      writeFileSync(testCctsFile, 'id,clave\n1,01DJN0002D\n2,01DST0046C\n');

      const config: CCTsManagerConfig = {
        environment: 'local',
        usePreloading: true,
        maxMemoryUsageMB: 1024, // High limit
        enablePerformanceTracking: true,
        localPath: testCctsFile,
      };

      const manager = new CCTsManager(mockApi, config);
      await manager.initialize();

      // Should use pre-loading mode
      expect(manager.isUsingOnDemandMode()).toBe(false);
      expect(manager.getCacheStats().size).toBe(2);
    });
  });

  describe('GetOrCreate Functionality', () => {
    it('should return cached CCT in pre-loading mode', async () => {
      // Create CCTs file
      writeFileSync(testCctsFile, 'id,clave\n1,01DJN0002D\n2,01DST0046C\n');

      const config: CCTsManagerConfig = {
        environment: 'local',
        usePreloading: true,
        maxMemoryUsageMB: 1024,
        enablePerformanceTracking: true,
        localPath: testCctsFile,
      };

      const manager = new CCTsManager(mockApi, config);
      await manager.initialize();

      // Should find cached CCT
      const cctId = await manager.getOrCreateCCT('01DJN0002D');
      expect(cctId).toBe(1);

      // Should not make API call
      expect(mockApi.get).not.toHaveBeenCalled();
    });

    it('should return null for non-existent CCT in pre-loading mode', async () => {
      // Create CCTs file
      writeFileSync(testCctsFile, 'id,clave\n1,01DJN0002D\n');

      const config: CCTsManagerConfig = {
        environment: 'local',
        usePreloading: true,
        maxMemoryUsageMB: 1024,
        enablePerformanceTracking: true,
        localPath: testCctsFile,
      };

      const manager = new CCTsManager(mockApi, config);
      await manager.initialize();

      // Should return null for non-existent CCT
      const cctId = await manager.getOrCreateCCT('NONEXISTENT');
      expect(cctId).toBeNull();

      // Should not make API call
      expect(mockApi.get).not.toHaveBeenCalled();
    });

    it('should fetch CCT from API in on-demand mode', async () => {
      // Mock API response
      mockApi.get.mockResolvedValue({
        data: {
          data: [{ id: 123 }],
        },
      });

      const config: CCTsManagerConfig = {
        environment: 'local',
        usePreloading: false, // Force on-demand mode
        maxMemoryUsageMB: 1024,
        enablePerformanceTracking: true,
      };

      const manager = new CCTsManager(mockApi, config);
      await manager.initialize();

      // Should fetch from API
      const cctId = await manager.getOrCreateCCT('01DJN0002D');
      expect(cctId).toBe(123);

      // Should have made API call
      expect(mockApi.get).toHaveBeenCalledWith(
        '/ccts?filters[clave][$eq]=01DJN0002D&pagination[limit]=1'
      );
    });

    it('should cache API results to avoid duplicate calls', async () => {
      // Mock API response
      mockApi.get.mockResolvedValue({
        data: {
          data: [{ id: 456 }],
        },
      });

      const config: CCTsManagerConfig = {
        environment: 'local',
        usePreloading: false,
        maxMemoryUsageMB: 1024,
        enablePerformanceTracking: true,
      };

      const manager = new CCTsManager(mockApi, config);
      await manager.initialize();

      // First call should fetch from API
      const cctId1 = await manager.getOrCreateCCT('01DST0046C');
      expect(cctId1).toBe(456);

      // Second call should use cache
      const cctId2 = await manager.getOrCreateCCT('01DST0046C');
      expect(cctId2).toBe(456);

      // Should have made only one API call
      expect(mockApi.get).toHaveBeenCalledTimes(1);
    });

    it('should handle API errors gracefully', async () => {
      // Mock API error
      mockApi.get.mockRejectedValue(new Error('API Error'));

      const config: CCTsManagerConfig = {
        environment: 'local',
        usePreloading: false,
        maxMemoryUsageMB: 1024,
        enablePerformanceTracking: true,
      };

      const manager = new CCTsManager(mockApi, config);
      await manager.initialize();

      // Should return null on API error
      const cctId = await manager.getOrCreateCCT('01DJN0002D');
      expect(cctId).toBeNull();

      // Should have logged warning
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch CCT'),
        expect.any(String)
      );
    });

    it('should cache negative results to avoid repeated API calls', async () => {
      // Mock API response with no results
      mockApi.get.mockResolvedValue({
        data: {
          data: [],
        },
      });

      const config: CCTsManagerConfig = {
        environment: 'local',
        usePreloading: false,
        maxMemoryUsageMB: 1024,
        enablePerformanceTracking: true,
      };

      const manager = new CCTsManager(mockApi, config);
      await manager.initialize();

      // First call should fetch from API
      const cctId1 = await manager.getOrCreateCCT('NONEXISTENT');
      expect(cctId1).toBeNull();

      // Second call should use cached negative result
      const cctId2 = await manager.getOrCreateCCT('NONEXISTENT');
      expect(cctId2).toBeNull();

      // Should have made only one API call
      expect(mockApi.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('Performance Tracking', () => {
    it('should track performance metrics when enabled', async () => {
      // Create CCTs file
      writeFileSync(testCctsFile, 'id,clave\n1,01DJN0002D\n2,01DST0046C\n');

      const config: CCTsManagerConfig = {
        environment: 'local',
        usePreloading: true,
        maxMemoryUsageMB: 1024,
        enablePerformanceTracking: true,
        localPath: testCctsFile,
      };

      const manager = new CCTsManager(mockApi, config);
      await manager.initialize();

      const metrics = manager.getPerformanceMetrics();
      expect(metrics.loadingTime).toBeGreaterThanOrEqual(0); // Can be 0 for very fast operations
      expect(metrics.recordCount).toBe(2);
      expect(metrics.memoryUsage).toBeGreaterThanOrEqual(0); // Can be 0 for small datasets
    });

    it('should track cache hit rate in on-demand mode', async () => {
      // Mock API response
      mockApi.get.mockResolvedValue({
        data: {
          data: [{ id: 789 }],
        },
      });

      const config: CCTsManagerConfig = {
        environment: 'local',
        usePreloading: false,
        maxMemoryUsageMB: 1024,
        enablePerformanceTracking: true,
      };

      const manager = new CCTsManager(mockApi, config);
      await manager.initialize();

      // Make multiple calls to same CCT
      await manager.getOrCreateCCT('01DJN0002D');
      await manager.getOrCreateCCT('01DJN0002D');
      await manager.getOrCreateCCT('01DJN0002D');

      const metrics = manager.getPerformanceMetrics();
      expect(metrics.apiCallsSaved).toBe(2); // 2 calls saved due to caching
    });
  });

  describe('Reset and State Management', () => {
    it('should reset state correctly', async () => {
      // Create CCTs file
      writeFileSync(testCctsFile, 'id,clave\n1,01DJN0002D\n');

      const config: CCTsManagerConfig = {
        environment: 'local',
        usePreloading: true,
        maxMemoryUsageMB: 1024,
        enablePerformanceTracking: true,
        localPath: testCctsFile,
      };

      const manager = new CCTsManager(mockApi, config);
      await manager.initialize();

      // Verify initial state
      expect(manager.getCacheStats().isInitialized).toBe(true);
      expect(manager.getCacheStats().size).toBe(1);

      // Reset
      manager.reset();

      // Verify reset state
      expect(manager.getCacheStats().isInitialized).toBe(false);
      expect(manager.getCacheStats().size).toBe(0);
      expect(manager.isUsingOnDemandMode()).toBe(false);
    });

    it('should provide accurate configuration summary', () => {
      const config: CCTsManagerConfig = {
        environment: 'production',
        usePreloading: false,
        maxMemoryUsageMB: 512,
        enablePerformanceTracking: true,
        s3Config: {
          bucket: 'test-bucket',
          key: 'test-key.csv',
        },
      };

      const manager = new CCTsManager(mockApi, config);
      const summary = manager.getConfigSummary();

      expect(summary.environment).toBe('production');
      expect(summary.usePreloading).toBe(false);
      expect(summary.maxMemoryUsageMB).toBe(512);
      expect(summary.hasS3Config).toBe(true);
      expect(summary.hasLocalPath).toBe(false);
      expect(summary.enablePerformanceTracking).toBe(true);
      expect(summary.isInitialized).toBe(false);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle initialization errors gracefully', async () => {
      const config: CCTsManagerConfig = {
        environment: 'local',
        usePreloading: true,
        maxMemoryUsageMB: 1024,
        enablePerformanceTracking: true,
        localPath: '/invalid/path/that/does/not/exist.csv',
      };

      const manager = new CCTsManager(mockApi, config);
      
      // Should not throw error
      await expect(manager.initialize()).resolves.not.toThrow();
      
      // Should fall back to on-demand mode
      expect(manager.isUsingOnDemandMode()).toBe(true);
      expect(manager.getCacheStats().isInitialized).toBe(true);
    });

    it('should handle multiple initialization calls', async () => {
      const config: CCTsManagerConfig = {
        environment: 'local',
        usePreloading: false,
        maxMemoryUsageMB: 1024,
        enablePerformanceTracking: true,
      };

      const manager = new CCTsManager(mockApi, config);
      
      // Multiple initialization calls should be safe
      await manager.initialize();
      await manager.initialize();
      await manager.initialize();

      expect(manager.getCacheStats().isInitialized).toBe(true);
    });

    it('should handle getOrCreateCCT before initialization', async () => {
      mockApi.get.mockResolvedValue({
        data: {
          data: [{ id: 999 }],
        },
      });

      const config: CCTsManagerConfig = {
        environment: 'local',
        usePreloading: false,
        maxMemoryUsageMB: 1024,
        enablePerformanceTracking: true,
      };

      const manager = new CCTsManager(mockApi, config);
      
      // Should auto-initialize when getOrCreateCCT is called
      const cctId = await manager.getOrCreateCCT('01DJN0002D');
      expect(cctId).toBe(999);
      expect(manager.getCacheStats().isInitialized).toBe(true);
    });
  });
});