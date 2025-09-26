#!/usr/bin/env node

/**
 * Health monitoring CLI tool
 * Provides manual health checks and monitoring capabilities
 */

import { Command } from 'commander';
import axios from 'axios';
import { createHealthMonitor } from './health-monitor';
import { loadEnvironmentConfig } from './config';
import { formatError } from './utils';

const program = new Command();

program
  .name('health-cli')
  .description('Health monitoring CLI for Apilados Pipeline')
  .version('1.0.0');

program
  .command('check')
  .description('Perform comprehensive health check')
  .option('-e, --environment <env>', 'Environment (local|production)', 'local')
  .option('-v, --verbose', 'Verbose output')
  .option('--no-api', 'Skip API health checks')
  .action(async (options) => {
    try {
      console.log('🏥 Starting health check...\n');

      // Load environment configuration
      const envConfig = loadEnvironmentConfig();
      
      // Create API client if not skipped
      let api;
      if (options.api) {
        api = axios.create({
          baseURL: envConfig.strapiBaseUrl,
          headers: {
            Authorization: `Bearer ${envConfig.strapiToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        });
      }

      // Create health monitor
      const healthMonitor = createHealthMonitor(
        options.environment === 'production' ? 'production' : 'local',
        options.environment === 'production' ? 'aws' : 'local',
        api
      );

      // Perform health check
      const health = await healthMonitor.performHealthCheck();

      // Display results
      console.log(`📊 Overall Health: ${getHealthEmoji(health.overall)} ${health.overall.toUpperCase()}`);
      console.log(`🕐 Timestamp: ${health.timestamp.toISOString()}`);
      console.log(`📈 Summary: ${health.summary.healthy} healthy, ${health.summary.warning} warning, ${health.summary.critical} critical\n`);

      // Display individual checks
      console.log('🔍 Component Health Checks:');
      health.checks.forEach(check => {
        const emoji = getHealthEmoji(check.status);
        const responseTime = check.responseTime ? ` (${check.responseTime}ms)` : '';
        console.log(`  ${emoji} ${check.component}: ${check.message}${responseTime}`);
        
        if (options.verbose && check.details) {
          console.log(`    Details: ${JSON.stringify(check.details, null, 2)}`);
        }
      });

      // Exit with appropriate code
      process.exit(health.overall === 'critical' ? 1 : 0);

    } catch (error) {
      console.error('❌ Health check failed:', formatError(error));
      process.exit(1);
    }
  });

program
  .command('metrics')
  .description('Display recent performance metrics')
  .option('-c, --count <count>', 'Number of recent metrics to show', '10')
  .option('-e, --environment <env>', 'Environment (local|production)', 'local')
  .action(async (options) => {
    try {
      console.log('📊 Recent Performance Metrics:\n');

      // Create health monitor
      const healthMonitor = createHealthMonitor(
        options.environment === 'production' ? 'production' : 'local',
        options.environment === 'production' ? 'aws' : 'local'
      );

      const metrics = healthMonitor.getRecentMetrics(parseInt(options.count));

      if (metrics.length === 0) {
        console.log('No performance metrics available.');
        return;
      }

      metrics.forEach((metric, index) => {
        console.log(`📈 Metric ${metrics.length - index}:`);
        console.log(`  🕐 Timestamp: ${metric.timestamp.toISOString()}`);
        console.log(`  ⏱️  Execution Time: ${metric.executionTime}ms`);
        console.log(`  🧠 Memory Usage: ${Math.round(metric.memoryUsage.used)}MB / ${Math.round(metric.memoryUsage.total)}MB (${Math.round(metric.memoryUsage.percentage)}%)`);
        console.log(`  📝 Records Processed: ${metric.recordsProcessed}`);
        console.log(`  ✅ Success Rate: ${Math.round(metric.successRate)}%`);
        console.log(`  ❌ Error Rate: ${Math.round(metric.errorRate)}%`);
        console.log(`  🔗 API Calls: ${metric.apiCallsCount}`);
        if (metric.cacheHitRate !== undefined) {
          console.log(`  💾 Cache Hit Rate: ${Math.round(metric.cacheHitRate)}%`);
        }
        if (metric.cctsMode) {
          console.log(`  🗂️  CCTs Mode: ${metric.cctsMode}`);
        }
        console.log('');
      });

    } catch (error) {
      console.error('❌ Failed to retrieve metrics:', formatError(error));
      process.exit(1);
    }
  });

program
  .command('monitor')
  .description('Continuous health monitoring')
  .option('-i, --interval <seconds>', 'Check interval in seconds', '60')
  .option('-e, --environment <env>', 'Environment (local|production)', 'local')
  .option('--no-api', 'Skip API health checks')
  .action(async (options) => {
    try {
      const interval = parseInt(options.interval) * 1000;
      console.log(`🔄 Starting continuous health monitoring (every ${options.interval}s)...\n`);

      // Load environment configuration
      const envConfig = loadEnvironmentConfig();
      
      // Create API client if not skipped
      let api;
      if (options.api) {
        api = axios.create({
          baseURL: envConfig.strapiBaseUrl,
          headers: {
            Authorization: `Bearer ${envConfig.strapiToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        });
      }

      // Create health monitor
      const healthMonitor = createHealthMonitor(
        options.environment === 'production' ? 'production' : 'local',
        options.environment === 'production' ? 'aws' : 'local',
        api
      );

      let checkCount = 0;

      const performCheck = async () => {
        try {
          checkCount++;
          console.log(`🏥 Health Check #${checkCount} - ${new Date().toISOString()}`);
          
          const health = await healthMonitor.performHealthCheck();
          const emoji = getHealthEmoji(health.overall);
          
          console.log(`   Status: ${emoji} ${health.overall.toUpperCase()}`);
          console.log(`   Components: ${health.summary.healthy}✅ ${health.summary.warning}⚠️ ${health.summary.critical}❌`);
          
          // Show critical issues
          const criticalIssues = health.checks.filter(check => check.status === 'critical');
          if (criticalIssues.length > 0) {
            console.log('   🚨 Critical Issues:');
            criticalIssues.forEach(issue => {
              console.log(`     - ${issue.component}: ${issue.message}`);
            });
          }
          
          console.log('');
          
        } catch (error) {
          console.error(`❌ Health check #${checkCount} failed:`, formatError(error));
        }
      };

      // Perform initial check
      await performCheck();

      // Set up interval
      const intervalId = setInterval(performCheck, interval);

      // Handle graceful shutdown
      process.on('SIGINT', () => {
        console.log('\n🛑 Stopping health monitoring...');
        clearInterval(intervalId);
        process.exit(0);
      });

      process.on('SIGTERM', () => {
        console.log('\n🛑 Stopping health monitoring...');
        clearInterval(intervalId);
        process.exit(0);
      });

    } catch (error) {
      console.error('❌ Failed to start monitoring:', formatError(error));
      process.exit(1);
    }
  });

program
  .command('report')
  .description('Generate health report')
  .option('-e, --environment <env>', 'Environment (local|production)', 'local')
  .option('-o, --output <file>', 'Output file (default: console)')
  .action(async (options) => {
    try {
      console.log('📋 Generating health report...\n');

      // Create health monitor
      const healthMonitor = createHealthMonitor(
        options.environment === 'production' ? 'production' : 'local',
        options.environment === 'production' ? 'aws' : 'local'
      );

      // Perform health check
      const health = await healthMonitor.performHealthCheck();
      const metrics = healthMonitor.getRecentMetrics(10);

      const report = {
        timestamp: new Date().toISOString(),
        environment: options.environment,
        health,
        recentMetrics: metrics,
        summary: {
          overallHealth: health.overall,
          totalComponents: health.summary.total,
          healthyComponents: health.summary.healthy,
          warningComponents: health.summary.warning,
          criticalComponents: health.summary.critical,
          recentMetricsCount: metrics.length,
          averageExecutionTime: metrics.length > 0 
            ? metrics.reduce((sum, m) => sum + m.executionTime, 0) / metrics.length 
            : 0,
          averageSuccessRate: metrics.length > 0 
            ? metrics.reduce((sum, m) => sum + m.successRate, 0) / metrics.length 
            : 0
        }
      };

      if (options.output) {
        const fs = require('fs');
        fs.writeFileSync(options.output, JSON.stringify(report, null, 2));
        console.log(`📄 Health report saved to: ${options.output}`);
      } else {
        console.log(JSON.stringify(report, null, 2));
      }

    } catch (error) {
      console.error('❌ Failed to generate report:', formatError(error));
      process.exit(1);
    }
  });

function getHealthEmoji(status: string): string {
  switch (status) {
    case 'healthy': return '✅';
    case 'warning': return '⚠️';
    case 'critical': return '❌';
    default: return '❓';
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

program.parse();