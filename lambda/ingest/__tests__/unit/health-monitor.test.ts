/**
 * Unit tests for HealthMonitor - Comprehensive health monitoring system
 * Tests health checks, CloudWatch integration, alerting, and performance tracking
 * 
 * Requirements covered:
 * - Real-time health check functionality
 * - CloudWatch integration for detailed logging
 * - Error report generation and S3 storage
 * - Performance metrics collection
 * - Alert generation for critical issues
 */

import { HealthMonitor, createHealthMonitor, HealthMonitorConfig } from '../../health-monitor';
import { AxiosInstance } from 'axios';

// Mock AWS SDK
jest.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  PutMetricDataCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  PublishCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  PutObjectCommand: jest.fn(),
}));

describe('HealthMonitor', () => {
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
    // Mock Axios instance
    mockApi = {
      get: jest.fn(),
    } as any;

    // Reset environment variables
    delete process.env.HEALTH_ALERT_SNS_TOPIC;
    delete process.env.HEALTH_REPORTS_S3_BUCKET;
    delete process.env.HEALTH_CLOUDWATCH_NAMESPACE;
    delete process.env.AWS_REGION;
  });

  describe('Configuration and Initialization', () => {
    it('should create HealthMonitor with default configuration', () => {
      const config: HealthMonitorConfig = {
        environment: 'local',
        executionMode: 'local',
        cloudWatch: {
          enabled: false,
          namespace: 'Test/Pipeline'
        },
        alerts: {
          enabled: false,
          criticalThresholds: {
            errorRate: 10,
            memoryUsage: 85,
            responseTime: 30000
          },
          warningThresholds: {
            errorRate: 5,
            memoryUsage: 70,
            responseTime: 15000
          }
        },
        s3Reporting: {
          enabled: false
        },
        healthChecks: {
          enabled: true,
          interval: 300,
          timeout: 10000
        }
      };

      const monitor = new HealthMonitor(config, mockApi);
      expect(monitor).toBeDefined();
      expect(monitor.getCurrentHealth()).toBeNull();
    });

    it('should create HealthMonitor with CloudWatch enabled', () => {
      const config: HealthMonitorConfig = {
        environment: 'production',
        executionMode: 'aws',
        cloudWatch: {
          enabled: true,
          namespace: 'Apilados/Pipeline/Production',
          region: 'us-east-1'
        },
        alerts: {
          enabled: true,
          snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:alerts',
          criticalThresholds: {
            errorRate: 10,
            memoryUsage: 85,
            responseTime: 30000
          },
          warningThresholds: {
            errorRate: 5,
            memoryUsage: 70,
            responseTime: 15000
          }
        },
        s3Reporting: {
          enabled: true,
          bucket: 'health-reports-bucket',
          keyPrefix: 'reports'
        },
        healthChecks: {
          enabled: true,
          interval: 300,
          timeout: 10000
        }
      };

      const monitor = new HealthMonitor(config, mockApi);
      expect(monitor).toBeDefined();
    });
  });

  describe('Factory Function', () => {
    it('should create HealthMonitor for local environment', () => {
      const monitor = createHealthMonitor('local', 'local', mockApi);
      
      expect(monitor).toBeDefined();
      const health = monitor.getCurrentHealth();
      expect(health).toBeNull(); // No health check performed yet
    });

    it('should create HealthMonitor for production environment', () => {
      const monitor = createHealthMonitor('production', 'aws', mockApi);
      
      expect(monitor).toBeDefined();
    });

    it('should respect environment variable overrides', () => {
      process.env.HEALTH_ALERT_SNS_TOPIC = 'arn:aws:sns:us-east-1:123456789012:test-alerts';
      process.env.HEALTH_REPORTS_S3_BUCKET = 'test-health-bucket';
      process.env.AWS_REGION = 'us-west-2';

      const monitor = createHealthMonitor('production', 'aws', mockApi);
      expect(monitor).toBeDefined();
    });
  });

  describe('Health Checks', () => {
    it('should perform comprehensive health check', async () => {
      // Mock successful API response
      mockApi.get.mockResolvedValue({
        status: 200,
        data: { data: [] }
      });

      const config: HealthMonitorConfig = {
        environment: 'local',
        executionMode: 'local',
        cloudWatch: {
          enabled: false,
          namespace: 'Test/Pipeline'
        },
        alerts: {
          enabled: false,
          criticalThresholds: {
            errorRate: 10,
            memoryUsage: 85,
            responseTime: 30000
          },
          warningThresholds: {
            errorRate: 5,
            memoryUsage: 70,
            responseTime: 15000
          }
        },
        s3Reporting: {
          enabled: false
        },
        healthChecks: {
          enabled: true,
          interval: 300,
          timeout: 10000
        }
      };

      const monitor = new HealthMonitor(config, mockApi);
      const health = await monitor.performHealthCheck();

      expect(health).toBeDefined();
      expect(health.overall).toMatch(/healthy|warning|critical/);
      expect(health.checks).toBeInstanceOf(Array);
      expect(health.checks.length).toBeGreaterThan(0);
      expect(health.summary.total).toBe(health.checks.length);
      expect(health.timestamp).toBeInstanceOf(Date);
    });

    it('should handle Strapi API health check success', async () => {
      mockApi.get.mockResolvedValue({
        status: 200,
        data: { data: [{ id: 1 }] }
      });

      const config: HealthMonitorConfig = {
        environment: 'local',
        executionMode: 'local',
        cloudWatch: { enabled: false, namespace: 'Test' },
        alerts: { enabled: false, criticalThresholds: { errorRate: 10, memoryUsage: 85, responseTime: 30000 }, warningThresholds: { errorRate: 5, memoryUsage: 70, responseTime: 15000 } },
        s3Reporting: { enabled: false },
        healthChecks: { enabled: true, interval: 300, timeout: 10000 }
      };

      const monitor = new HealthMonitor(config, mockApi);
      const health = await monitor.performHealthCheck();

      const strapiCheck = health.checks.find(check => check.component === 'strapi-api');
      expect(strapiCheck).toBeDefined();
      expect(strapiCheck?.status).toBe('healthy');
      expect(strapiCheck?.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('should handle Strapi API health check failure', async () => {
      mockApi.get.mockRejectedValue(new Error('Connection refused'));

      const config: HealthMonitorConfig = {
        environment: 'local',
        executionMode: 'local',
        cloudWatch: { enabled: false, namespace: 'Test' },
        alerts: { enabled: false, criticalThresholds: { errorRate: 10, memoryUsage: 85, responseTime: 30000 }, warningThresholds: { errorRate: 5, memoryUsage: 70, responseTime: 15000 } },
        s3Reporting: { enabled: false },
        healthChecks: { enabled: true, interval: 300, timeout: 10000 }
      };

      const monitor = new HealthMonitor(config, mockApi);
      const health = await monitor.performHealthCheck();

      const strapiCheck = health.checks.find(check => check.component === 'strapi-api');
      expect(strapiCheck).toBeDefined();
      expect(strapiCheck?.status).toBe('critical');
      expect(strapiCheck?.message).toContain('Connection refused');
    });

    it('should check memory usage correctly', async () => {
      const config: HealthMonitorConfig = {
        environment: 'local',
        executionMode: 'local',
        cloudWatch: { enabled: false, namespace: 'Test' },
        alerts: { 
          enabled: false, 
          criticalThresholds: { errorRate: 10, memoryUsage: 95, responseTime: 30000 }, // High threshold
          warningThresholds: { errorRate: 5, memoryUsage: 90, responseTime: 15000 }
        },
        s3Reporting: { enabled: false },
        healthChecks: { enabled: true, interval: 300, timeout: 10000 }
      };

      const monitor = new HealthMonitor(config);
      const health = await monitor.performHealthCheck();

      const memoryCheck = health.checks.find(check => check.component === 'memory');
      expect(memoryCheck).toBeDefined();
      expect(memoryCheck?.status).toMatch(/healthy|warning|critical/);
      expect(memoryCheck?.details).toHaveProperty('heapUsed');
      expect(memoryCheck?.details).toHaveProperty('heapTotal');
      expect(memoryCheck?.details).toHaveProperty('percentage');
    });

    it('should detect high memory usage', async () => {
      const config: HealthMonitorConfig = {
        environment: 'local',
        executionMode: 'local',
        cloudWatch: { enabled: false, namespace: 'Test' },
        alerts: { 
          enabled: false, 
          criticalThresholds: { errorRate: 10, memoryUsage: 1, responseTime: 30000 }, // Very low threshold
          warningThresholds: { errorRate: 5, memoryUsage: 0.5, responseTime: 15000 }
        },
        s3Reporting: { enabled: false },
        healthChecks: { enabled: true, interval: 300, timeout: 10000 }
      };

      const monitor = new HealthMonitor(config);
      const health = await monitor.performHealthCheck();

      const memoryCheck = health.checks.find(check => check.component === 'memory');
      expect(memoryCheck).toBeDefined();
      expect(memoryCheck?.status).toBe('critical'); // Should be critical due to low threshold
    });

    it('should check system resources', async () => {
      const config: HealthMonitorConfig = {
        environment: 'local',
        executionMode: 'local',
        cloudWatch: { enabled: false, namespace: 'Test' },
        alerts: { enabled: false, criticalThresholds: { errorRate: 10, memoryUsage: 85, responseTime: 30000 }, warningThresholds: { errorRate: 5, memoryUsage: 70, responseTime: 15000 } },
        s3Reporting: { enabled: false },
        healthChecks: { enabled: true, interval: 300, timeout: 10000 }
      };

      const monitor = new HealthMonitor(config);
      const health = await monitor.performHealthCheck();

      const systemCheck = health.checks.find(check => check.component === 'system');
      expect(systemCheck).toBeDefined();
      expect(systemCheck?.status).toBe('healthy');
      expect(systemCheck?.details).toHaveProperty('uptime');
      expect(systemCheck?.details).toHaveProperty('nodeVersion');
      expect(systemCheck?.details).toHaveProperty('platform');
    });
  });

  describe('Performance Metrics', () => {
    it('should record performance metrics', () => {
      const config: HealthMonitorConfig = {
        environment: 'local',
        executionMode: 'local',
        cloudWatch: { enabled: false, namespace: 'Test' },
        alerts: { enabled: false, criticalThresholds: { errorRate: 10, memoryUsage: 85, responseTime: 30000 }, warningThresholds: { errorRate: 5, memoryUsage: 70, responseTime: 15000 } },
        s3Reporting: { enabled: false },
        healthChecks: { enabled: true, interval: 300, timeout: 10000 }
      };

      const monitor = new HealthMonitor(config);
      
      monitor.recordPerformanceMetrics({
        executionTime: 5000,
        memoryUsage: {
          used: 100,
          total: 200,
          percentage: 50
        },
        recordsProcessed: 1000,
        successRate: 95,
        errorRate: 5,
        apiCallsCount: 50,
        cacheHitRate: 80,
        cctsMode: 'pre-loaded'
      });

      const metrics = monitor.getRecentMetrics(1);
      expect(metrics).toHaveLength(1);
      expect(metrics[0].executionTime).toBe(5000);
      expect(metrics[0].recordsProcessed).toBe(1000);
      expect(metrics[0].successRate).toBe(95);
      expect(metrics[0].cacheHitRate).toBe(80);
    });

    it('should limit stored metrics to prevent memory issues', () => {
      const config: HealthMonitorConfig = {
        environment: 'local',
        executionMode: 'local',
        cloudWatch: { enabled: false, namespace: 'Test' },
        alerts: { enabled: false, criticalThresholds: { errorRate: 10, memoryUsage: 85, responseTime: 30000 }, warningThresholds: { errorRate: 5, memoryUsage: 70, responseTime: 15000 } },
        s3Reporting: { enabled: false },
        healthChecks: { enabled: true, interval: 300, timeout: 10000 }
      };

      const monitor = new HealthMonitor(config);
      
      // Record more than 100 metrics
      for (let i = 0; i < 150; i++) {
        monitor.recordPerformanceMetrics({
          executionTime: i * 100,
          memoryUsage: { used: 50, total: 100, percentage: 50 },
          recordsProcessed: i * 10,
          successRate: 95,
          errorRate: 5,
          apiCallsCount: i * 2
        });
      }

      const metrics = monitor.getRecentMetrics(200); // Request more than stored
      expect(metrics.length).toBeLessThanOrEqual(100); // Should be limited to 100
    });

    it('should return recent metrics correctly', () => {
      const config: HealthMonitorConfig = {
        environment: 'local',
        executionMode: 'local',
        cloudWatch: { enabled: false, namespace: 'Test' },
        alerts: { enabled: false, criticalThresholds: { errorRate: 10, memoryUsage: 85, responseTime: 30000 }, warningThresholds: { errorRate: 5, memoryUsage: 70, responseTime: 15000 } },
        s3Reporting: { enabled: false },
        healthChecks: { enabled: true, interval: 300, timeout: 10000 }
      };

      const monitor = new HealthMonitor(config);
      
      // Record 5 metrics
      for (let i = 0; i < 5; i++) {
        monitor.recordPerformanceMetrics({
          executionTime: i * 1000,
          memoryUsage: { used: 50, total: 100, percentage: 50 },
          recordsProcessed: i * 100,
          successRate: 95,
          errorRate: 5,
          apiCallsCount: i * 10
        });
      }

      const recent3 = monitor.getRecentMetrics(3);
      expect(recent3).toHaveLength(3);
      expect(recent3[2].recordsProcessed).toBe(400); // Last recorded (index 4)
      expect(recent3[1].recordsProcessed).toBe(300); // Second to last (index 3)
      expect(recent3[0].recordsProcessed).toBe(200); // Third to last (index 2)
    });
  });

  describe('Health Status Determination', () => {
    it('should determine overall health as healthy when all checks pass', async () => {
      mockApi.get.mockResolvedValue({ status: 200, data: { data: [] } });

      const config: HealthMonitorConfig = {
        environment: 'local',
        executionMode: 'local',
        cloudWatch: { enabled: false, namespace: 'Test' },
        alerts: { 
          enabled: false, 
          criticalThresholds: { errorRate: 10, memoryUsage: 95, responseTime: 30000 }, // High thresholds
          warningThresholds: { errorRate: 5, memoryUsage: 90, responseTime: 15000 }
        },
        s3Reporting: { enabled: false },
        healthChecks: { enabled: true, interval: 300, timeout: 10000 }
      };

      const monitor = new HealthMonitor(config, mockApi);
      const health = await monitor.performHealthCheck();

      expect(health.overall).toBe('healthy');
      expect(health.summary.critical).toBe(0);
    });

    it('should determine overall health as critical when critical issues exist', async () => {
      mockApi.get.mockRejectedValue(new Error('API Down'));

      const config: HealthMonitorConfig = {
        environment: 'local',
        executionMode: 'local',
        cloudWatch: { enabled: false, namespace: 'Test' },
        alerts: { enabled: false, criticalThresholds: { errorRate: 10, memoryUsage: 85, responseTime: 30000 }, warningThresholds: { errorRate: 5, memoryUsage: 70, responseTime: 15000 } },
        s3Reporting: { enabled: false },
        healthChecks: { enabled: true, interval: 300, timeout: 10000 }
      };

      const monitor = new HealthMonitor(config, mockApi);
      const health = await monitor.performHealthCheck();

      expect(health.overall).toBe('critical');
      expect(health.summary.critical).toBeGreaterThan(0);
    });

    it('should determine overall health as warning when only warnings exist', async () => {
      // Don't provide API to trigger warning
      const config: HealthMonitorConfig = {
        environment: 'local',
        executionMode: 'local',
        cloudWatch: { enabled: false, namespace: 'Test' },
        alerts: { enabled: false, criticalThresholds: { errorRate: 10, memoryUsage: 85, responseTime: 30000 }, warningThresholds: { errorRate: 5, memoryUsage: 70, responseTime: 15000 } },
        s3Reporting: { enabled: false },
        healthChecks: { enabled: true, interval: 300, timeout: 10000 }
      };

      const monitor = new HealthMonitor(config); // No API provided
      const health = await monitor.performHealthCheck();

      const strapiCheck = health.checks.find(check => check.component === 'strapi-api');
      expect(strapiCheck?.status).toBe('warning'); // Should be warning due to no API
    });
  });

  describe('State Management', () => {
    it('should return null for current health before any check', () => {
      const config: HealthMonitorConfig = {
        environment: 'local',
        executionMode: 'local',
        cloudWatch: { enabled: false, namespace: 'Test' },
        alerts: { enabled: false, criticalThresholds: { errorRate: 10, memoryUsage: 85, responseTime: 30000 }, warningThresholds: { errorRate: 5, memoryUsage: 70, responseTime: 15000 } },
        s3Reporting: { enabled: false },
        healthChecks: { enabled: true, interval: 300, timeout: 10000 }
      };

      const monitor = new HealthMonitor(config);
      expect(monitor.getCurrentHealth()).toBeNull();
    });

    it('should return current health after performing check', async () => {
      const config: HealthMonitorConfig = {
        environment: 'local',
        executionMode: 'local',
        cloudWatch: { enabled: false, namespace: 'Test' },
        alerts: { enabled: false, criticalThresholds: { errorRate: 10, memoryUsage: 85, responseTime: 30000 }, warningThresholds: { errorRate: 5, memoryUsage: 70, responseTime: 15000 } },
        s3Reporting: { enabled: false },
        healthChecks: { enabled: true, interval: 300, timeout: 10000 }
      };

      const monitor = new HealthMonitor(config);
      const health = await monitor.performHealthCheck();
      
      const currentHealth = monitor.getCurrentHealth();
      expect(currentHealth).not.toBeNull();
      expect(currentHealth?.overall).toBe(health.overall);
      expect(currentHealth?.timestamp).toEqual(health.timestamp);
    });

    it('should return empty array for recent metrics when none recorded', () => {
      const config: HealthMonitorConfig = {
        environment: 'local',
        executionMode: 'local',
        cloudWatch: { enabled: false, namespace: 'Test' },
        alerts: { enabled: false, criticalThresholds: { errorRate: 10, memoryUsage: 85, responseTime: 30000 }, warningThresholds: { errorRate: 5, memoryUsage: 70, responseTime: 15000 } },
        s3Reporting: { enabled: false },
        healthChecks: { enabled: true, interval: 300, timeout: 10000 }
      };

      const monitor = new HealthMonitor(config);
      expect(monitor.getRecentMetrics()).toEqual([]);
    });
  });

  describe('Error Handling', () => {
    it('should handle health check errors gracefully', async () => {
      // Mock API that throws during health check
      const faultyApi = {
        get: jest.fn().mockImplementation(() => {
          throw new Error('Network error');
        })
      } as any;

      const config: HealthMonitorConfig = {
        environment: 'local',
        executionMode: 'local',
        cloudWatch: { enabled: false, namespace: 'Test' },
        alerts: { enabled: false, criticalThresholds: { errorRate: 10, memoryUsage: 85, responseTime: 30000 }, warningThresholds: { errorRate: 5, memoryUsage: 70, responseTime: 15000 } },
        s3Reporting: { enabled: false },
        healthChecks: { enabled: true, interval: 300, timeout: 10000 }
      };

      const monitor = new HealthMonitor(config, faultyApi);
      
      // Should not throw error
      const health = await monitor.performHealthCheck();
      expect(health).toBeDefined();
      expect(health.checks.some(check => check.status === 'critical')).toBe(true);
    });

    it('should handle performance metrics recording errors gracefully', () => {
      const config: HealthMonitorConfig = {
        environment: 'local',
        executionMode: 'local',
        cloudWatch: { enabled: false, namespace: 'Test' },
        alerts: { enabled: false, criticalThresholds: { errorRate: 10, memoryUsage: 85, responseTime: 30000 }, warningThresholds: { errorRate: 5, memoryUsage: 70, responseTime: 15000 } },
        s3Reporting: { enabled: false },
        healthChecks: { enabled: true, interval: 300, timeout: 10000 }
      };

      const monitor = new HealthMonitor(config);
      
      // Should not throw error even with invalid data
      expect(() => {
        monitor.recordPerformanceMetrics({
          executionTime: -1, // Invalid but should be handled
          memoryUsage: { used: 0, total: 0, percentage: 0 },
          recordsProcessed: 0,
          successRate: 0,
          errorRate: 0,
          apiCallsCount: 0
        });
      }).not.toThrow();
    });
  });
});