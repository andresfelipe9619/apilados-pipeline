/**
 * Comprehensive health monitoring system for production pipeline
 * Provides real-time health checks, CloudWatch integration, and alerting
 */

import { CloudWatchClient, PutMetricDataCommand, MetricDatum } from "@aws-sdk/client-cloudwatch";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { AxiosInstance } from "axios";
import { formatError } from "./utils";
import { EnvironmentType, ExecutionMode } from "./types";

export interface HealthCheckResult {
  component: string;
  status: 'healthy' | 'warning' | 'critical';
  message: string;
  timestamp: Date;
  responseTime?: number;
  details?: Record<string, any>;
}

export interface SystemHealth {
  overall: 'healthy' | 'warning' | 'critical';
  timestamp: Date;
  checks: HealthCheckResult[];
  summary: {
    healthy: number;
    warning: number;
    critical: number;
    total: number;
  };
}

export interface PerformanceMetrics {
  timestamp: Date;
  executionTime: number;
  memoryUsage: {
    used: number;
    total: number;
    percentage: number;
  };
  recordsProcessed: number;
  successRate: number;
  errorRate: number;
  apiCallsCount: number;
  cacheHitRate?: number;
  cctsMode?: 'pre-loaded' | 'on-demand';
}

export interface AlertConfig {
  enabled: boolean;
  snsTopicArn?: string;
  criticalThresholds: {
    errorRate: number; // percentage
    memoryUsage: number; // percentage
    responseTime: number; // milliseconds
  };
  warningThresholds: {
    errorRate: number;
    memoryUsage: number;
    responseTime: number;
  };
}

export interface HealthMonitorConfig {
  environment: EnvironmentType;
  executionMode: ExecutionMode;
  cloudWatch: {
    enabled: boolean;
    namespace: string;
    region?: string;
  };
  alerts: AlertConfig;
  s3Reporting: {
    enabled: boolean;
    bucket?: string;
    keyPrefix?: string;
  };
  healthChecks: {
    enabled: boolean;
    interval: number; // seconds
    timeout: number; // milliseconds
  };
}

/**
 * Comprehensive health monitoring system
 */
export class HealthMonitor {
  private config: HealthMonitorConfig;
  private cloudWatchClient?: CloudWatchClient;
  private snsClient?: SNSClient;
  private s3Client?: S3Client;
  private api?: AxiosInstance;
  private metrics: PerformanceMetrics[] = [];
  private lastHealthCheck?: SystemHealth;
  private startTime: Date = new Date();

  constructor(config: HealthMonitorConfig, api?: AxiosInstance) {
    this.config = config;
    this.api = api;

    // Initialize AWS clients based on configuration
    if (config.cloudWatch.enabled) {
      this.cloudWatchClient = new CloudWatchClient({
        region: config.cloudWatch.region || process.env.AWS_REGION
      });
    }

    if (config.alerts.enabled && config.alerts.snsTopicArn) {
      this.snsClient = new SNSClient({
        region: config.cloudWatch.region || process.env.AWS_REGION
      });
    }

    if (config.s3Reporting.enabled && config.s3Reporting.bucket) {
      this.s3Client = new S3Client({
        region: config.cloudWatch.region || process.env.AWS_REGION
      });
    }
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck(): Promise<SystemHealth> {
    console.log("[Health] Starting comprehensive health check...");
    const startTime = Date.now();
    const checks: HealthCheckResult[] = [];

    // Check Strapi API connectivity (always check, even if no API configured)
    checks.push(await this.checkStrapiHealth());

    // Check memory usage
    checks.push(await this.checkMemoryHealth());

    // Check AWS services connectivity
    if (this.config.cloudWatch.enabled) {
      checks.push(await this.checkCloudWatchHealth());
    }

    if (this.config.s3Reporting.enabled) {
      checks.push(await this.checkS3Health());
    }

    if (this.config.alerts.enabled && this.config.alerts.snsTopicArn) {
      checks.push(await this.checkSNSHealth());
    }

    // Check system resources
    checks.push(await this.checkSystemResources());

    // Calculate overall health
    const summary = this.calculateHealthSummary(checks);
    const overall = this.determineOverallHealth(summary);

    const healthResult: SystemHealth = {
      overall,
      timestamp: new Date(),
      checks,
      summary
    };

    this.lastHealthCheck = healthResult;

    const totalTime = Date.now() - startTime;
    console.log(`[Health] Health check completed in ${totalTime}ms - Overall: ${overall}`);

    // Send to CloudWatch if enabled
    if (this.config.cloudWatch.enabled) {
      await this.sendHealthMetricsToCloudWatch(healthResult, totalTime);
    }

    // Check for alerts
    await this.checkAndSendAlerts(healthResult);

    return healthResult;
  }

  /**
   * Check Strapi API health
   */
  private async checkStrapiHealth(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      if (!this.api) {
        return {
          component: 'strapi-api',
          status: 'warning',
          message: 'Strapi API client not configured',
          timestamp: new Date()
        };
      }

      // Simple health check - try to fetch a small amount of data
      const response = await this.api.get('/encuestas?pagination[limit]=1', {
        timeout: this.config.healthChecks.timeout
      });

      const responseTime = Date.now() - startTime;
      
      if (response.status === 200) {
        return {
          component: 'strapi-api',
          status: 'healthy',
          message: 'Strapi API responding normally',
          timestamp: new Date(),
          responseTime,
          details: {
            statusCode: response.status,
            dataReceived: !!response.data
          }
        };
      } else {
        return {
          component: 'strapi-api',
          status: 'warning',
          message: `Strapi API returned status ${response.status}`,
          timestamp: new Date(),
          responseTime,
          details: { statusCode: response.status }
        };
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      return {
        component: 'strapi-api',
        status: 'critical',
        message: `Strapi API health check failed: ${formatError(error)}`,
        timestamp: new Date(),
        responseTime,
        details: { error: formatError(error) }
      };
    }
  }

  /**
   * Check memory usage health
   */
  private async checkMemoryHealth(): Promise<HealthCheckResult> {
    try {
      const memoryUsage = process.memoryUsage();
      const usedMB = memoryUsage.heapUsed / 1024 / 1024;
      const totalMB = memoryUsage.heapTotal / 1024 / 1024;
      const percentage = (usedMB / totalMB) * 100;

      let status: 'healthy' | 'warning' | 'critical' = 'healthy';
      let message = `Memory usage: ${Math.round(usedMB)}MB / ${Math.round(totalMB)}MB (${Math.round(percentage)}%)`;

      if (percentage > this.config.alerts.criticalThresholds.memoryUsage) {
        status = 'critical';
        message = `Critical memory usage: ${Math.round(percentage)}%`;
      } else if (percentage > this.config.alerts.warningThresholds.memoryUsage) {
        status = 'warning';
        message = `High memory usage: ${Math.round(percentage)}%`;
      }

      return {
        component: 'memory',
        status,
        message,
        timestamp: new Date(),
        details: {
          heapUsed: usedMB,
          heapTotal: totalMB,
          percentage: Math.round(percentage),
          external: memoryUsage.external / 1024 / 1024,
          rss: memoryUsage.rss / 1024 / 1024
        }
      };
    } catch (error) {
      return {
        component: 'memory',
        status: 'critical',
        message: `Memory health check failed: ${formatError(error)}`,
        timestamp: new Date(),
        details: { error: formatError(error) }
      };
    }
  }

  /**
   * Check CloudWatch connectivity
   */
  private async checkCloudWatchHealth(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      if (!this.cloudWatchClient) {
        return {
          component: 'cloudwatch',
          status: 'warning',
          message: 'CloudWatch client not configured',
          timestamp: new Date()
        };
      }

      // Test CloudWatch connectivity with a simple metric
      const testMetric: MetricDatum = {
        MetricName: 'HealthCheck',
        Value: 1,
        Unit: 'Count',
        Timestamp: new Date()
      };

      await this.cloudWatchClient.send(new PutMetricDataCommand({
        Namespace: this.config.cloudWatch.namespace,
        MetricData: [testMetric]
      }));

      const responseTime = Date.now() - startTime;

      return {
        component: 'cloudwatch',
        status: 'healthy',
        message: 'CloudWatch connectivity verified',
        timestamp: new Date(),
        responseTime,
        details: { namespace: this.config.cloudWatch.namespace }
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      return {
        component: 'cloudwatch',
        status: 'critical',
        message: `CloudWatch health check failed: ${formatError(error)}`,
        timestamp: new Date(),
        responseTime,
        details: { error: formatError(error) }
      };
    }
  }

  /**
   * Check S3 connectivity
   */
  private async checkS3Health(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      if (!this.s3Client || !this.config.s3Reporting.bucket) {
        return {
          component: 's3',
          status: 'warning',
          message: 'S3 client or bucket not configured',
          timestamp: new Date()
        };
      }

      // Test S3 connectivity with a small health check file
      const testKey = `${this.config.s3Reporting.keyPrefix || 'health-checks'}/health-check-${Date.now()}.json`;
      const testData = JSON.stringify({ timestamp: new Date(), test: true });

      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.config.s3Reporting.bucket,
        Key: testKey,
        Body: testData,
        ContentType: 'application/json'
      }));

      const responseTime = Date.now() - startTime;

      return {
        component: 's3',
        status: 'healthy',
        message: 'S3 connectivity verified',
        timestamp: new Date(),
        responseTime,
        details: { 
          bucket: this.config.s3Reporting.bucket,
          testKey
        }
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      return {
        component: 's3',
        status: 'critical',
        message: `S3 health check failed: ${formatError(error)}`,
        timestamp: new Date(),
        responseTime,
        details: { error: formatError(error) }
      };
    }
  }

  /**
   * Check SNS connectivity
   */
  private async checkSNSHealth(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      if (!this.snsClient || !this.config.alerts.snsTopicArn) {
        return {
          component: 'sns',
          status: 'warning',
          message: 'SNS client or topic not configured',
          timestamp: new Date()
        };
      }

      // Note: We don't actually send a test message to avoid spam
      // Instead, we just verify the client is configured
      const responseTime = Date.now() - startTime;

      return {
        component: 'sns',
        status: 'healthy',
        message: 'SNS client configured and ready',
        timestamp: new Date(),
        responseTime,
        details: { topicArn: this.config.alerts.snsTopicArn }
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      return {
        component: 'sns',
        status: 'warning',
        message: `SNS health check failed: ${formatError(error)}`,
        timestamp: new Date(),
        responseTime,
        details: { error: formatError(error) }
      };
    }
  }

  /**
   * Check system resources
   */
  private async checkSystemResources(): Promise<HealthCheckResult> {
    try {
      const uptime = process.uptime();
      const loadAverage = (process as any).loadavg ? (process as any).loadavg() : [0, 0, 0];
      const cpuUsage = process.cpuUsage();

      return {
        component: 'system',
        status: 'healthy',
        message: `System running for ${Math.round(uptime)}s`,
        timestamp: new Date(),
        details: {
          uptime: Math.round(uptime),
          loadAverage: loadAverage.map((l: number) => Math.round(l * 100) / 100),
          cpuUsage: {
            user: cpuUsage.user,
            system: cpuUsage.system
          },
          nodeVersion: process.version,
          platform: process.platform
        }
      };
    } catch (error) {
      return {
        component: 'system',
        status: 'warning',
        message: `System health check failed: ${formatError(error)}`,
        timestamp: new Date(),
        details: { error: formatError(error) }
      };
    }
  }

  /**
   * Record performance metrics
   */
  recordPerformanceMetrics(metrics: Omit<PerformanceMetrics, 'timestamp'>): void {
    const performanceMetrics: PerformanceMetrics = {
      ...metrics,
      timestamp: new Date()
    };

    this.metrics.push(performanceMetrics);

    // Keep only last 100 metrics to prevent memory issues
    if (this.metrics.length > 100) {
      this.metrics = this.metrics.slice(-100);
    }

    console.log(`[Health] Performance metrics recorded: ${metrics.recordsProcessed} records, ${Math.round(metrics.successRate)}% success rate`);

    // Send to CloudWatch if enabled
    if (this.config.cloudWatch.enabled) {
      this.sendPerformanceMetricsToCloudWatch(performanceMetrics).catch(error => {
        console.warn(`[Health] Failed to send performance metrics to CloudWatch: ${formatError(error)}`);
      });
    }
  }

  /**
   * Send performance metrics to CloudWatch
   */
  private async sendPerformanceMetricsToCloudWatch(metrics: PerformanceMetrics): Promise<void> {
    if (!this.cloudWatchClient) return;

    const metricData: MetricDatum[] = [
      {
        MetricName: 'ExecutionTime',
        Value: metrics.executionTime,
        Unit: 'Milliseconds',
        Timestamp: metrics.timestamp
      },
      {
        MetricName: 'MemoryUsagePercentage',
        Value: metrics.memoryUsage.percentage,
        Unit: 'Percent',
        Timestamp: metrics.timestamp
      },
      {
        MetricName: 'RecordsProcessed',
        Value: metrics.recordsProcessed,
        Unit: 'Count',
        Timestamp: metrics.timestamp
      },
      {
        MetricName: 'SuccessRate',
        Value: metrics.successRate,
        Unit: 'Percent',
        Timestamp: metrics.timestamp
      },
      {
        MetricName: 'ErrorRate',
        Value: metrics.errorRate,
        Unit: 'Percent',
        Timestamp: metrics.timestamp
      },
      {
        MetricName: 'APICallsCount',
        Value: metrics.apiCallsCount,
        Unit: 'Count',
        Timestamp: metrics.timestamp
      }
    ];

    if (metrics.cacheHitRate !== undefined) {
      metricData.push({
        MetricName: 'CacheHitRate',
        Value: metrics.cacheHitRate,
        Unit: 'Percent',
        Timestamp: metrics.timestamp
      });
    }

    try {
      await this.cloudWatchClient.send(new PutMetricDataCommand({
        Namespace: this.config.cloudWatch.namespace,
        MetricData: metricData
      }));
    } catch (error) {
      console.warn(`[Health] Failed to send performance metrics to CloudWatch: ${formatError(error)}`);
    }
  }

  /**
   * Send health metrics to CloudWatch
   */
  private async sendHealthMetricsToCloudWatch(health: SystemHealth, responseTime: number): Promise<void> {
    if (!this.cloudWatchClient) return;

    const metricData: MetricDatum[] = [
      {
        MetricName: 'HealthCheckDuration',
        Value: responseTime,
        Unit: 'Milliseconds',
        Timestamp: health.timestamp
      },
      {
        MetricName: 'HealthyComponents',
        Value: health.summary.healthy,
        Unit: 'Count',
        Timestamp: health.timestamp
      },
      {
        MetricName: 'WarningComponents',
        Value: health.summary.warning,
        Unit: 'Count',
        Timestamp: health.timestamp
      },
      {
        MetricName: 'CriticalComponents',
        Value: health.summary.critical,
        Unit: 'Count',
        Timestamp: health.timestamp
      },
      {
        MetricName: 'OverallHealthStatus',
        Value: health.overall === 'healthy' ? 1 : health.overall === 'warning' ? 0.5 : 0,
        Unit: 'None',
        Timestamp: health.timestamp
      }
    ];

    try {
      await this.cloudWatchClient.send(new PutMetricDataCommand({
        Namespace: this.config.cloudWatch.namespace,
        MetricData: metricData
      }));
    } catch (error) {
      console.warn(`[Health] Failed to send health metrics to CloudWatch: ${formatError(error)}`);
    }
  }

  /**
   * Check for alerts and send if necessary
   */
  private async checkAndSendAlerts(health: SystemHealth): Promise<void> {
    if (!this.config.alerts.enabled || !this.snsClient || !this.config.alerts.snsTopicArn) {
      return;
    }

    const criticalIssues = health.checks.filter(check => check.status === 'critical');
    const warningIssues = health.checks.filter(check => check.status === 'warning');

    if (criticalIssues.length > 0) {
      await this.sendAlert('CRITICAL', `${criticalIssues.length} critical issues detected`, {
        overall: health.overall,
        criticalIssues: criticalIssues.map(issue => ({
          component: issue.component,
          message: issue.message
        })),
        timestamp: health.timestamp
      });
    } else if (warningIssues.length > 0 && health.overall === 'warning') {
      await this.sendAlert('WARNING', `${warningIssues.length} warning issues detected`, {
        overall: health.overall,
        warningIssues: warningIssues.map(issue => ({
          component: issue.component,
          message: issue.message
        })),
        timestamp: health.timestamp
      });
    }
  }

  /**
   * Send alert via SNS
   */
  private async sendAlert(severity: 'CRITICAL' | 'WARNING', message: string, details: any): Promise<void> {
    if (!this.snsClient || !this.config.alerts.snsTopicArn) return;

    const alertMessage = {
      severity,
      message,
      environment: this.config.environment,
      executionMode: this.config.executionMode,
      timestamp: new Date().toISOString(),
      details
    };

    try {
      await this.snsClient.send(new PublishCommand({
        TopicArn: this.config.alerts.snsTopicArn,
        Subject: `[${severity}] Pipeline Health Alert - ${this.config.environment}`,
        Message: JSON.stringify(alertMessage, null, 2)
      }));

      console.log(`[Health] ${severity} alert sent: ${message}`);
    } catch (error) {
      console.error(`[Health] Failed to send ${severity} alert: ${formatError(error)}`);
    }
  }

  /**
   * Generate and store health report in S3
   */
  async generateHealthReport(): Promise<void> {
    if (!this.config.s3Reporting.enabled || !this.s3Client || !this.config.s3Reporting.bucket) {
      return;
    }

    try {
      const report = {
        timestamp: new Date().toISOString(),
        environment: this.config.environment,
        executionMode: this.config.executionMode,
        uptime: process.uptime(),
        lastHealthCheck: this.lastHealthCheck,
        recentMetrics: this.metrics.slice(-10), // Last 10 metrics
        summary: {
          totalMetrics: this.metrics.length,
          averageExecutionTime: this.metrics.length > 0 
            ? this.metrics.reduce((sum, m) => sum + m.executionTime, 0) / this.metrics.length 
            : 0,
          averageSuccessRate: this.metrics.length > 0 
            ? this.metrics.reduce((sum, m) => sum + m.successRate, 0) / this.metrics.length 
            : 0
        }
      };

      const key = `${this.config.s3Reporting.keyPrefix || 'health-reports'}/health-report-${Date.now()}.json`;
      
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.config.s3Reporting.bucket,
        Key: key,
        Body: JSON.stringify(report, null, 2),
        ContentType: 'application/json'
      }));

      console.log(`[Health] Health report generated: s3://${this.config.s3Reporting.bucket}/${key}`);
    } catch (error) {
      console.error(`[Health] Failed to generate health report: ${formatError(error)}`);
    }
  }

  /**
   * Get current system health
   */
  getCurrentHealth(): SystemHealth | null {
    return this.lastHealthCheck || null;
  }

  /**
   * Get recent performance metrics
   */
  getRecentMetrics(count: number = 10): PerformanceMetrics[] {
    return this.metrics.slice(-count);
  }

  /**
   * Calculate health summary
   */
  private calculateHealthSummary(checks: HealthCheckResult[]): SystemHealth['summary'] {
    return {
      healthy: checks.filter(c => c.status === 'healthy').length,
      warning: checks.filter(c => c.status === 'warning').length,
      critical: checks.filter(c => c.status === 'critical').length,
      total: checks.length
    };
  }

  /**
   * Determine overall health status
   */
  private determineOverallHealth(summary: SystemHealth['summary']): 'healthy' | 'warning' | 'critical' {
    if (summary.critical > 0) {
      return 'critical';
    } else if (summary.warning > 0) {
      return 'warning';
    } else {
      return 'healthy';
    }
  }
}

/**
 * Factory function to create HealthMonitor with environment-specific configuration
 */
export function createHealthMonitor(
  environment: EnvironmentType,
  executionMode: ExecutionMode,
  api?: AxiosInstance,
  customConfig?: Partial<HealthMonitorConfig>
): HealthMonitor {
  const defaultConfig: HealthMonitorConfig = {
    environment,
    executionMode,
    cloudWatch: {
      enabled: environment === 'production',
      namespace: `Apilados/Pipeline/${environment}`,
      region: process.env.AWS_REGION
    },
    alerts: {
      enabled: environment === 'production',
      snsTopicArn: process.env.HEALTH_ALERT_SNS_TOPIC,
      criticalThresholds: {
        errorRate: 10, // 10%
        memoryUsage: 85, // 85%
        responseTime: 30000 // 30 seconds
      },
      warningThresholds: {
        errorRate: 5, // 5%
        memoryUsage: 70, // 70%
        responseTime: 15000 // 15 seconds
      }
    },
    s3Reporting: {
      enabled: environment === 'production',
      bucket: process.env.HEALTH_REPORTS_S3_BUCKET || process.env.BUCKET_NAME,
      keyPrefix: 'health-reports'
    },
    healthChecks: {
      enabled: true,
      interval: 300, // 5 minutes
      timeout: 10000 // 10 seconds
    }
  };

  const finalConfig = { ...defaultConfig, ...customConfig };

  console.log("[Health] Creating HealthMonitor with configuration:", {
    environment: finalConfig.environment,
    executionMode: finalConfig.executionMode,
    cloudWatchEnabled: finalConfig.cloudWatch.enabled,
    alertsEnabled: finalConfig.alerts.enabled,
    s3ReportingEnabled: finalConfig.s3Reporting.enabled
  });

  return new HealthMonitor(finalConfig, api);
}