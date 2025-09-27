# Health Monitoring System Guide

## Overview

The comprehensive health monitoring system provides real-time health checks, performance metrics collection, CloudWatch integration, and automated alerting for the Apilados Pipeline.

## Features

### 🏥 Real-time Health Checks
- **Strapi API Connectivity**: Verifies API endpoint availability and response times
- **Memory Usage Monitoring**: Tracks heap usage and detects memory pressure
- **AWS Services Health**: Validates CloudWatch, S3, and SNS connectivity
- **System Resources**: Monitors CPU usage, uptime, and system load

### 📊 Performance Metrics Collection
- **Execution Time Tracking**: Measures processing duration
- **Memory Usage Analysis**: Detailed heap and memory statistics
- **Success/Error Rates**: Tracks processing success and failure rates
- **Cache Performance**: Monitors cache hit rates and efficiency
- **API Call Optimization**: Tracks API usage and optimization opportunities

### ☁️ CloudWatch Integration
- **Custom Metrics**: Sends detailed performance and health metrics
- **Dashboard Support**: Pre-configured CloudWatch dashboard
- **Log Integration**: Structured logging for health events
- **Metric Namespacing**: Environment-specific metric organization

### 🚨 Automated Alerting
- **SNS Integration**: Sends alerts via SNS topics
- **Threshold-based Alerts**: Configurable warning and critical thresholds
- **Alert Severity Levels**: Critical, warning, and informational alerts
- **Environment-specific Configuration**: Different alert settings per environment

### 📋 Health Reporting
- **S3 Report Storage**: Automated health report generation and storage
- **JSON Report Format**: Structured reports for analysis
- **Historical Tracking**: Maintains health history for trend analysis
- **CLI Report Generation**: Manual report generation capabilities

## Configuration

### Environment Variables

#### Core Configuration
```bash
# Health monitoring enable/disable
HEALTH_CHECKS_ENABLED=true

# CloudWatch configuration
HEALTH_CLOUDWATCH_NAMESPACE=Apilados/Pipeline/Production
AWS_REGION=us-east-1

# Alerting configuration
HEALTH_ALERT_SNS_TOPIC=arn:aws:sns:us-east-1:123456789012:pipeline-alerts

# S3 reporting configuration
HEALTH_REPORTS_S3_BUCKET=production-health-reports
```

#### Threshold Configuration
The system uses environment-specific default thresholds:

**Production Thresholds:**
- Critical Error Rate: 10%
- Warning Error Rate: 5%
- Critical Memory Usage: 85%
- Warning Memory Usage: 70%
- Critical Response Time: 30 seconds
- Warning Response Time: 15 seconds

**Local Development Thresholds:**
- More lenient thresholds for development environments

### Programmatic Configuration

```typescript
import { createHealthMonitor } from './health-monitor';

const healthMonitor = createHealthMonitor(
  'production', // environment
  'aws',        // execution mode
  apiClient,    // optional API client
  {
    // Custom configuration overrides
    alerts: {
      enabled: true,
      criticalThresholds: {
        errorRate: 15,      // 15%
        memoryUsage: 90,    // 90%
        responseTime: 45000 // 45 seconds
      }
    }
  }
);
```

## Usage

### Integration in Lambda Functions

The health monitor is automatically integrated into the main lambda handler:

```typescript
// Automatic initialization
const { healthMonitor } = initializeConfiguration(executionMode, localConfig);

// Initial health check
const initialHealth = await healthMonitor.performHealthCheck();

// Performance metrics recording
healthMonitor.recordPerformanceMetrics({
  executionTime: totalTime,
  memoryUsage: {
    used: memoryUsage.heapUsed / 1024 / 1024,
    total: memoryUsage.heapTotal / 1024 / 1024,
    percentage: (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100
  },
  recordsProcessed: result.totalRecords,
  successRate: (result.successCount / result.totalRecords) * 100,
  errorRate: (result.errorCount / result.totalRecords) * 100,
  apiCallsCount: result.totalRecords
});

// Final health check and report generation
const finalHealth = await healthMonitor.performHealthCheck();
await healthMonitor.generateHealthReport();
```

### CLI Usage

#### Perform Health Check
```bash
# Basic health check
npm run health:check

# Production environment health check
npm run health:check -- --environment production

# Verbose output with details
npm run health:check -- --verbose

# Skip API checks (useful for testing)
npm run health:check -- --no-api
```

#### View Performance Metrics
```bash
# Show last 10 metrics
npm run health:metrics

# Show last 20 metrics
npm run health:metrics -- --count 20

# Production environment metrics
npm run health:metrics -- --environment production
```

#### Continuous Monitoring
```bash
# Monitor every 60 seconds (default)
npm run health:monitor

# Monitor every 30 seconds
npm run health:monitor -- --interval 30

# Production monitoring
npm run health:monitor -- --environment production
```

#### Generate Health Reports
```bash
# Generate report to console
npm run health:report

# Save report to file
npm run health:report -- --output health-report.json

# Production environment report
npm run health:report -- --environment production --output prod-health.json
```

### Programmatic Usage

#### Basic Health Check
```typescript
import { createHealthMonitor } from './health-monitor';

const healthMonitor = createHealthMonitor('local', 'local', apiClient);
const health = await healthMonitor.performHealthCheck();

console.log(`Overall health: ${health.overall}`);
console.log(`Components: ${health.summary.healthy} healthy, ${health.summary.critical} critical`);
```

#### Performance Metrics Recording
```typescript
// Record metrics after processing
healthMonitor.recordPerformanceMetrics({
  executionTime: 5000,
  memoryUsage: {
    used: 150,
    total: 300,
    percentage: 50
  },
  recordsProcessed: 1000,
  successRate: 98.5,
  errorRate: 1.5,
  apiCallsCount: 250,
  cacheHitRate: 85,
  cctsMode: 'pre-loaded'
});

// Get recent metrics
const recentMetrics = healthMonitor.getRecentMetrics(5);
```

#### Health Report Generation
```typescript
// Generate and store health report in S3
await healthMonitor.generateHealthReport();

// Get current health status
const currentHealth = healthMonitor.getCurrentHealth();
if (currentHealth?.overall === 'critical') {
  console.error('System is in critical state!');
}
```

## CloudWatch Dashboard

### Dashboard Setup

1. **Import Dashboard Configuration**:
   ```bash
   aws cloudwatch put-dashboard \
     --dashboard-name "Apilados-Pipeline-Health" \
     --dashboard-body file://cloudwatch-dashboard.json
   ```

2. **Dashboard Widgets**:
   - **System Health Overview**: Overall health status and component counts
   - **Performance Metrics**: Execution time and health check duration
   - **Memory Usage**: Memory usage percentage with threshold annotations
   - **Processing Rates**: Success and error rates over time
   - **Processing Volume**: Records processed and API calls
   - **Cache Performance**: Cache hit rates
   - **Health Monitoring Logs**: Recent health-related log entries

### Custom Metrics

The system sends the following custom metrics to CloudWatch:

#### Health Metrics
- `OverallHealthStatus`: 1 (healthy), 0.5 (warning), 0 (critical)
- `HealthyComponents`: Count of healthy components
- `WarningComponents`: Count of components with warnings
- `CriticalComponents`: Count of critical components
- `HealthCheckDuration`: Time taken to perform health checks

#### Performance Metrics
- `ExecutionTime`: Lambda execution time in milliseconds
- `MemoryUsagePercentage`: Memory usage as percentage
- `RecordsProcessed`: Number of records processed
- `SuccessRate`: Processing success rate percentage
- `ErrorRate`: Processing error rate percentage
- `APICallsCount`: Number of API calls made
- `CacheHitRate`: Cache hit rate percentage

## Alerting

### SNS Alert Configuration

1. **Create SNS Topic**:
   ```bash
   aws sns create-topic --name pipeline-health-alerts
   ```

2. **Subscribe to Alerts**:
   ```bash
   aws sns subscribe \
     --topic-arn arn:aws:sns:us-east-1:123456789012:pipeline-health-alerts \
     --protocol email \
     --notification-endpoint admin@example.com
   ```

3. **Configure Environment Variable**:
   ```bash
   export HEALTH_ALERT_SNS_TOPIC=arn:aws:sns:us-east-1:123456789012:pipeline-health-alerts
   ```

### Alert Types

#### Critical Alerts
Sent when:
- Any component status is critical
- Error rate exceeds critical threshold (default: 10%)
- Memory usage exceeds critical threshold (default: 85%)
- Response time exceeds critical threshold (default: 30s)

#### Warning Alerts
Sent when:
- Overall system status is warning (no critical issues)
- Error rate exceeds warning threshold (default: 5%)
- Memory usage exceeds warning threshold (default: 70%)
- Response time exceeds warning threshold (default: 15s)

### Alert Message Format

```json
{
  "severity": "CRITICAL",
  "message": "2 critical issues detected",
  "environment": "production",
  "executionMode": "aws",
  "timestamp": "2023-12-07T10:30:00.000Z",
  "details": {
    "overall": "critical",
    "criticalIssues": [
      {
        "component": "strapi-api",
        "message": "Strapi API health check failed: Connection refused"
      },
      {
        "component": "memory",
        "message": "Critical memory usage: 92%"
      }
    ]
  }
}
```

## Health Report Format

### JSON Report Structure

```json
{
  "timestamp": "2023-12-07T10:30:00.000Z",
  "environment": "production",
  "executionMode": "aws",
  "uptime": 3600,
  "lastHealthCheck": {
    "overall": "healthy",
    "timestamp": "2023-12-07T10:30:00.000Z",
    "checks": [
      {
        "component": "strapi-api",
        "status": "healthy",
        "message": "Strapi API responding normally",
        "timestamp": "2023-12-07T10:30:00.000Z",
        "responseTime": 150,
        "details": {
          "statusCode": 200,
          "dataReceived": true
        }
      }
    ],
    "summary": {
      "healthy": 5,
      "warning": 0,
      "critical": 0,
      "total": 5
    }
  },
  "recentMetrics": [
    {
      "timestamp": "2023-12-07T10:25:00.000Z",
      "executionTime": 5000,
      "memoryUsage": {
        "used": 150,
        "total": 300,
        "percentage": 50
      },
      "recordsProcessed": 1000,
      "successRate": 98.5,
      "errorRate": 1.5,
      "apiCallsCount": 250,
      "cacheHitRate": 85,
      "cctsMode": "pre-loaded"
    }
  ],
  "summary": {
    "totalMetrics": 10,
    "averageExecutionTime": 4500,
    "averageSuccessRate": 97.8
  }
}
```

## Troubleshooting

### Common Issues

#### Health Checks Failing
```bash
# Check if environment variables are set
npm run health:check -- --verbose

# Test without API connectivity
npm run health:check -- --no-api

# Check specific environment
npm run health:check -- --environment production
```

#### CloudWatch Metrics Not Appearing
1. Verify AWS credentials and permissions
2. Check CloudWatch namespace configuration
3. Verify region settings
4. Check IAM permissions for CloudWatch PutMetricData

#### Alerts Not Being Sent
1. Verify SNS topic ARN configuration
2. Check SNS topic permissions
3. Verify subscription configuration
4. Check alert thresholds

#### S3 Reports Not Generated
1. Verify S3 bucket exists and is accessible
2. Check IAM permissions for S3 PutObject
3. Verify bucket region matches configuration
4. Check S3 key prefix configuration

### Debug Commands

```bash
# Verbose health check with all details
npm run health:check -- --verbose

# Continuous monitoring with short intervals
npm run health:monitor -- --interval 10

# Generate detailed report
npm run health:report -- --output debug-report.json

# Check recent performance metrics
npm run health:metrics -- --count 20
```

### Log Analysis

Health monitoring logs include structured information:

```bash
# Filter health-related logs
grep "\[Health\]" /var/log/lambda.log

# CloudWatch Logs Insights query
fields @timestamp, @message
| filter @message like /\[Health\]/
| sort @timestamp desc
| limit 100
```

## Best Practices

### Production Deployment
1. **Enable All Features**: CloudWatch, alerting, and S3 reporting
2. **Set Conservative Thresholds**: Start with conservative alert thresholds
3. **Monitor Regularly**: Set up continuous monitoring
4. **Review Reports**: Regularly review health reports for trends
5. **Test Alerting**: Verify alert delivery before production deployment

### Development Environment
1. **Disable CloudWatch**: Save costs by disabling CloudWatch in development
2. **Use Local Reporting**: Generate reports locally for debugging
3. **Adjust Thresholds**: Use more lenient thresholds for development
4. **Enable Verbose Logging**: Use verbose mode for detailed debugging

### Performance Optimization
1. **Monitor Memory Usage**: Track memory trends to optimize Lambda configuration
2. **Analyze Cache Performance**: Use cache hit rates to optimize caching strategies
3. **Track API Usage**: Monitor API call patterns for optimization opportunities
4. **Review Execution Times**: Identify performance bottlenecks

### Security Considerations
1. **IAM Permissions**: Use least-privilege IAM policies
2. **SNS Topic Security**: Secure SNS topics with appropriate access policies
3. **S3 Bucket Security**: Enable S3 bucket encryption and access logging
4. **Credential Management**: Use IAM roles instead of access keys

## Integration Examples

### Custom Health Checks

```typescript
// Add custom health check
class CustomHealthMonitor extends HealthMonitor {
  async performHealthCheck(): Promise<SystemHealth> {
    const health = await super.performHealthCheck();
    
    // Add custom check
    const customCheck = await this.checkCustomService();
    health.checks.push(customCheck);
    
    // Recalculate summary
    health.summary = this.calculateHealthSummary(health.checks);
    health.overall = this.determineOverallHealth(health.summary);
    
    return health;
  }
  
  private async checkCustomService(): Promise<HealthCheckResult> {
    // Custom health check logic
    return {
      component: 'custom-service',
      status: 'healthy',
      message: 'Custom service is operational',
      timestamp: new Date()
    };
  }
}
```

### Custom Metrics

```typescript
// Record custom metrics
healthMonitor.recordPerformanceMetrics({
  executionTime: processingTime,
  memoryUsage: getMemoryUsage(),
  recordsProcessed: totalRecords,
  successRate: calculateSuccessRate(),
  errorRate: calculateErrorRate(),
  apiCallsCount: apiCallCounter,
  // Custom metrics
  customMetric1: customValue1,
  customMetric2: customValue2
});
```

### Event-Driven Health Checks

```typescript
// Trigger health check on specific events
eventEmitter.on('processing-complete', async () => {
  const health = await healthMonitor.performHealthCheck();
  if (health.overall === 'critical') {
    await notifyAdministrators(health);
  }
});
```

This comprehensive health monitoring system provides complete visibility into the pipeline's health and performance, enabling proactive monitoring and rapid issue resolution.