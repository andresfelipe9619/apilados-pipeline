# Usage Examples

This document provides comprehensive examples for using the Apilados Pipeline data processing system in various scenarios.

## Table of Contents

1. [Local Development Examples](#local-development-examples)
2. [Database Dump Examples](#database-dump-examples)
3. [S3 Event Simulation Examples](#s3-event-simulation-examples)
4. [AWS Deployment Examples](#aws-deployment-examples)
5. [CLI Usage Examples](#cli-usage-examples)
6. [Programmatic Usage Examples](#programmatic-usage-examples)
7. [Configuration Examples](#configuration-examples)
8. [Error Handling Examples](#error-handling-examples)
9. [Performance Optimization Examples](#performance-optimization-examples)
10. [Troubleshooting Guide](#troubleshooting-guide)

## Production Simulation Workflow

### Understanding the Production Environment

In production, the system works as follows:
1. **S3 Event**: A CSV file is uploaded to an S3 bucket
2. **Lambda Trigger**: The upload triggers the ingest lambda function
3. **Data Processing**: The lambda processes the CSV and adds new records to the existing Strapi database
4. **Database State**: The database already contains base data and structure

### Local Simulation Setup

To simulate this locally, we use:
- **Database Dump** (`strapi_db_2025-06-28.dump`): Acts as the "existing production database" with base data
- **Event CSV** (`apilado-universal.csv`): Simulates the "CSV file uploaded to S3" that triggers processing
- **CCTs CSV** (`ccts_export.csv`): Optional performance optimization data

### Complete Simulation Workflow

```bash
cd lambda/ingest

# 1. Validate all components are ready
npm run cli validate-dump

# 2. Option A: Use existing dump as seeders + simulate S3 events
./restore-dump.sh  # Restore the "production database state"
npm run cli simulate ./test-data/apilado-universal.csv  # Simulate S3 event processing

# 2. Option B: Create fresh dump + simulate S3 events (complete workflow)
npm run cli dump  # Create database backup
npm run cli simulate ./test-data/apilado-universal.csv  # Simulate S3 event processing

# Both options simulate the production lambda processing a CSV file
# against an existing database with base data
```

## Local Development Examples

### Basic Local Setup

```bash
# 1. Navigate to lambda directory
cd lambda/ingest

# 2. Install dependencies
npm install

# 3. Setup environment
cp .env.example .env

# 4. Edit .env file with your configuration
cat > .env << EOF
# Strapi Configuration
STRAPI_BASE_URL=http://localhost:1337/api
STRAPI_TOKEN=your-strapi-token-here

# Processing Configuration
PROCESS_MODE=parallel
BATCH_SIZE=100
OMIT_GET=false

# Database Configuration (for dump functionality)
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=strapi_db
DATABASE_USERNAME=strapi
DATABASE_PASSWORD=your_password
EOF

# 5. Validate environment
npm run cli validate

# 6. Run quick test
npm run cli quick
```

### S3 Event Simulation with Custom CSV Files

```bash
# Simulate S3 event with your own CSV file
npm run cli simulate ./data/my-participations.csv

# Simulate with custom configuration
npm run cli simulate ./data/my-participations.csv \
  --mode sequential \
  --batch-size 25 \
  --omit-get \
  --ccts ./data/my-ccts.csv

# Simulate with performance optimization
npm run cli simulate ./data/large-dataset.csv \
  --mode parallel \
  --batch-size 200 \
  --omit-get
```

### Development Workflow

```bash
# Daily development workflow
cd lambda/ingest

# 1. Validate environment
npm run cli validate

# 2. Generate test data if needed
npm run cli generate --output test-data --count 50

# 3. Simulate S3 events with small dataset
npm run cli simulate test-data/sample.csv --batch-size 10

# 4. Run full test suite
npm test

# 5. Simulate S3 events with larger dataset
npm run cli simulate test-data/large-sample.csv --mode parallel
```

## Database Dump Examples

### Understanding the Dump Workflow

The database dump provides the foundation for local development:
1. **Database dump file** (`strapi_db_2025-06-28.dump`) serves as **seeders** - contains the base database structure and initial data
2. **Event CSV** (`apilado-universal.csv`) contains the **event data to simulate** - simulates the CSV file that triggers the lambda in production
3. **CCTs CSV** (`ccts_export.csv`) provides optional performance optimization data

This allows local testing of the complete production workflow: restore database → simulate S3 events.

### Validate Dump Workflow

```bash
cd lambda/ingest

# Validate that all required files are present and ready
npm run cli validate-dump

# This checks for:
# ✅ Database dump file (seeders): strapi_db_2025-06-28.dump
# ✅ Participants CSV (data to migrate): apilado-universal.csv  
# ✅ CCTs CSV (reference data): ccts_export.csv
# ✅ PostgreSQL tools availability
# ✅ Database connection (if database is running)
```

### Basic Database Dump Operations

```bash
cd lambda/ingest

# Interactive dump (prompts for options)
npm run cli dump

# Create database dump (for creating new seeders)
npm run cli dump

# Create compressed database dump
npm run cli dump --compress --output ./backups

# Dump with custom output directory
npm run cli dump --output /path/to/backups

# Dump without timestamp in filename
npm run cli dump --no-timestamp
```

## S3 Event Simulation Examples

### Complete Development Workflow

The complete workflow simulates production: create fresh database dump (seeders) → simulate S3 events with CSV data.

```bash
# Step 1: Create database backup
npm run cli dump --compress

# Step 2: Simulate S3 event with event CSV
npm run cli simulate ./test-data/apilado-universal.csv

# This workflow:
# 1. Creates a fresh database dump (new seeders)
# 2. Automatically detects ccts_export.csv for performance optimization
# 3. Simulates S3 event processing with the event CSV
# 4. Replicates the production lambda processing a CSV upload event

# Custom simulation with specific settings
npm run cli simulate ./test-data/apilado-universal.csv \
  --mode parallel \
  --batch-size 100

# Simulation with custom CCTs file for performance optimization
npm run cli simulate ./test-data/apilado-universal.csv \
  --ccts ./test-data/ccts_export.csv \
  --mode sequential

# Performance-optimized simulation for large datasets
npm run cli simulate ./test-data/large-sample.csv \
  --mode parallel \
  --batch-size 200 \
  --omit-get
```

### Using Existing Dump as Seeders

If you already have a dump file (like `strapi_db_2025-06-28.dump`), you can restore it manually and then simulate S3 events:

```bash
# 1. Restore existing dump file (seeders) using the restore script
./restore-dump.sh

# 2. Simulate S3 event with event CSV (simulates production event)
npm run cli simulate ./test-data/apilado-universal.csv

# Or simulate with custom configuration
npm run cli simulate ./test-data/apilado-universal.csv \
  --mode parallel \
  --batch-size 100 \
  --ccts ./test-data/ccts_export.csv
```

### Database Configuration Examples

```bash
# Validate database configuration
npm run cli validate

# Test database connection before dump
npm run cli dump  # Will test connection first

# Environment-specific database dumps
DATABASE_HOST=production.db.com npm run cli dump
DATABASE_HOST=staging.db.com npm run cli dump
```

### Automated Backup Workflows

```bash
# Daily backup script
#!/bin/bash
cd /path/to/apilados-pipeline/lambda/ingest

# Create timestamped backup
npm run cli dump --compress --output ./daily-backups

# Cleanup old backups (keep last 7 days)
find ./daily-backups -name "*.sql*" -mtime +7 -delete

# Log backup completion
echo "$(date): Database backup completed" >> backup.log
```

```bash
# Pre-simulation backup workflow
#!/bin/bash
cd /path/to/apilados-pipeline/lambda/ingest

echo "Creating pre-simulation backup..."
npm run cli dump --compress --output ./pre-simulation-backups

if [ $? -eq 0 ]; then
    echo "Backup successful, proceeding with S3 event simulation..."
    npm run cli simulate ./data/new-data.csv --mode parallel
else
    echo "Backup failed, aborting simulation"
    exit 1
fi
```

### CCTs Data Handling Examples

CCTs (Centro de Trabajo) data provides optional performance optimization for event simulation.

```bash
# Auto-detect ccts_export.csv for performance optimization
npm run cli simulate ./test-data/apilado-universal.csv
# Will automatically use ./test-data/ccts_export.csv if available for performance

# Use specific CCTs file for performance optimization
npm run cli simulate ./test-data/apilado-universal.csv \
  --ccts ./test-data/ccts_export.csv

# Simulate S3 events without CCTs performance optimization (will show warnings but continue)
npm run cli simulate ./test-data/apilado-universal.csv

# Simulate with different CCTs sources for different scenarios
npm run cli simulate ./test-data/apilado-universal.csv --ccts ./test-data/ccts_export.csv
npm run cli simulate ./test-data/sample.csv --ccts ./test-data/ccts_export.csv
```

### Database Dump Troubleshooting

```bash
# Check PostgreSQL tools availability
which pg_dump pg_isready
# Should return paths to both tools

# Test database connection manually
pg_isready -h localhost -p 5432 -U strapi -d strapi_db

# Create test dump manually
pg_dump -h localhost -p 5432 -U strapi -d strapi_db -f test-dump.sql

# Validate dump file
head -20 test-dump.sql  # Should show PostgreSQL dump header

# Check dump file size
ls -lh *.sql*  # Should show reasonable file size
```

## AWS Deployment Examples

### Basic CDK Deployment

```bash
# From project root
npm run build
npx cdk bootstrap  # First time only
npx cdk deploy
```

### Custom CDK Deployment with Parameters

```typescript
// lib/apilados-pipeline-stack.ts
const params: Params = {
  bucketName: 'my-processing-bucket',
  processMode: 'parallel',
  omitGet: false,
  batchSize: 150,
  chunkSize: 200,
  strapiBaseUrl: 'https://api.production.com/api',
  strapiToken: 'production-token'
};

const stack = new ApiladosPipelineStack(app, 'ApiladosPipelineStack', {
  params,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
```

### S3 Event Processing

Once deployed, the lambda automatically processes CSV files uploaded to S3:

```bash
# Upload CSV file to trigger processing
aws s3 cp ./data/participations.csv s3://your-processing-bucket/uploads/

# Monitor lambda logs
aws logs tail /aws/lambda/apilados-pipeline-ingest --follow

# Download error reports if any
aws s3 ls s3://your-processing-bucket/errors/
aws s3 cp s3://your-processing-bucket/errors/error-report.csv ./
```

## CLI Usage Examples

### Environment Management

```bash
cd lambda/ingest

# Check environment status
npm run cli env

# Validate all configuration
npm run cli validate

# Show detailed environment info
DEBUG=true npm run cli env
```

### Test Data Generation

```bash
# Generate sample data with default settings
npm run cli generate

# Generate custom test data
npm run cli generate \
  --output my-test-data \
  --count 100 \
  --programs "Program A,Program B" \
  --implementations "Impl 1,Impl 2"

# Setup complete test environment
npm run cli setup --dir complete-test-env
```

### Testing and Validation

```bash
# Quick validation test
npm run cli quick

# Simulate specific scenarios
npm run cli simulate data.csv --mode sequential    # Debug mode
npm run cli simulate data.csv --mode parallel     # Performance mode
npm run cli simulate data.csv --omit-get          # Fast mode
npm run cli simulate data.csv --batch-size 10     # Small batches

# Performance testing
time npm run cli simulate large-dataset.csv --mode parallel --batch-size 500
```

### Database Operations

```bash
# Database dump operations
npm run cli dump                    # Create backup
npm run cli dump --compress         # Compressed backup

# S3 event simulation operations
npm run cli simulate data.csv       # Simulate S3 event

# Database configuration validation
npm run cli validate                # Includes database config check

# Environment-specific operations
NODE_ENV=production npm run cli dump --dump-only
NODE_ENV=staging npm run cli dump --dump-only
```

## Programmatic Usage Examples

### Basic Test Runner

```typescript
import { runLocalTest } from './local-test-runner';

async function basicTest() {
  try {
    const result = await runLocalTest('./data/participations.csv');
    
    console.log('Migration Results:');
    console.log(`✅ Success: ${result.successCount} records`);
    console.log(`❌ Errors: ${result.errorCount} records`);
    console.log(`⏱️ Time: ${result.processingTime}ms`);
    
    if (result.errorCsvPath) {
      console.log(`📄 Error report: ${result.errorCsvPath}`);
    }
  } catch (error) {
    console.error('Migration failed:', error);
  }
}

basicTest();
```

### Advanced Test Runner with Custom Configuration

```typescript
import { createLocalTestRunner } from './local-test-runner';
import { ProcessingConfig } from './types';

async function advancedTest() {
  const runner = createLocalTestRunner();
  
  // Validate environment first
  if (!runner.validateEnvironment()) {
    throw new Error('Environment validation failed');
  }
  
  // Custom configuration for performance testing
  const config: ProcessingConfig = {
    processMode: 'parallel',
    omitGet: true,
    batchSize: 200,
    chunkSize: 300
  };
  
  const result = await runner.runWithCsv('./data/large-dataset.csv', config);
  
  // Generate detailed report
  const report = runner.generateTestReport();
  console.log('Detailed Report:', report);
  
  return result;
}
```

### Batch Testing Multiple Files

```typescript
import { runLocalTest } from './local-test-runner';
import { glob } from 'glob';

async function batchTest() {
  const csvFiles = glob.sync('./data/*.csv');
  const results = [];
  
  for (const file of csvFiles) {
    console.log(`Processing ${file}...`);
    
    try {
      const result = await runLocalTest(file, {
        processMode: 'sequential',
        batchSize: 50,
        omitGet: false,
        chunkSize: 100
      });
      
      results.push({
        file,
        success: true,
        ...result
      });
    } catch (error) {
      results.push({
        file,
        success: false,
        error: error.message
      });
    }
  }
  
  // Summary report
  const totalSuccess = results.reduce((sum, r) => sum + (r.successCount || 0), 0);
  const totalErrors = results.reduce((sum, r) => sum + (r.errorCount || 0), 0);
  
  console.log('\n=== Batch Processing Summary ===');
  console.log(`Files processed: ${results.length}`);
  console.log(`Total success: ${totalSuccess}`);
  console.log(`Total errors: ${totalErrors}`);
  
  return results;
}
```

### Development Utilities Usage

```typescript
import { 
  validateEnv, 
  generateTestData, 
  setupTestEnvironment,
  quickTest 
} from './dev-utils';

async function developmentWorkflow() {
  // 1. Validate environment
  const validation = validateEnv();
  if (!validation.isValid) {
    console.error('Environment issues:', validation.errors);
    return;
  }
  
  // 2. Generate test data if needed
  const testData = await generateTestData('./test-data', 100);
  console.log('Generated test data:', testData);
  
  // 3. Setup test environment
  const testEnv = await setupTestEnvironment('./my-test-env');
  console.log('Test environment ready:', testEnv);
  
  // 4. Run quick validation
  const quickResult = await quickTest();
  console.log('Quick test result:', quickResult);
  
  return { validation, testData, testEnv, quickResult };
}
```

## Configuration Examples

### Environment Variables for Different Scenarios

#### Development Environment
```bash
# .env for development
STRAPI_BASE_URL=http://localhost:1337/api
STRAPI_TOKEN=dev-token-here
PROCESS_MODE=sequential
BATCH_SIZE=10
OMIT_GET=false
DEBUG=true

# Database configuration for dumps
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=strapi_dev
DATABASE_USERNAME=strapi
DATABASE_PASSWORD=dev_password
```

#### Testing Environment
```bash
# .env for testing
STRAPI_BASE_URL=https://staging-api.example.com/api
STRAPI_TOKEN=staging-token-here
PROCESS_MODE=parallel
BATCH_SIZE=50
OMIT_GET=true

# Database configuration for staging
DATABASE_HOST=staging-db.example.com
DATABASE_PORT=5432
DATABASE_NAME=strapi_staging
DATABASE_USERNAME=strapi_staging
DATABASE_PASSWORD=staging_password
```

#### Production Environment (CDK)
```typescript
// CDK deployment configuration
const productionParams: Params = {
  strapiBaseUrl: 'https://api.production.com/api',
  strapiToken: process.env.PRODUCTION_STRAPI_TOKEN!,
  processMode: 'parallel',
  omitGet: false,
  batchSize: 200,
  chunkSize: 300,
  bucketName: 'production-processing-bucket'
};
```

#### Production Database Environment
```bash
# Production database configuration (use secure methods in production)
DATABASE_HOST=prod-db.example.com
DATABASE_PORT=5432
DATABASE_NAME=strapi_production
DATABASE_USERNAME=strapi_prod
DATABASE_PASSWORD=secure_production_password
DATABASE_SSL=true
```

### Processing Configuration Examples

```typescript
// Debug configuration - slow but detailed
const debugConfig: ProcessingConfig = {
  processMode: 'sequential',
  omitGet: false,
  batchSize: 1,
  chunkSize: 10
};

// Performance configuration - fast processing
const performanceConfig: ProcessingConfig = {
  processMode: 'parallel',
  omitGet: true,
  batchSize: 500,
  chunkSize: 1000
};

// Balanced configuration - good for most cases
const balancedConfig: ProcessingConfig = {
  processMode: 'parallel',
  omitGet: false,
  batchSize: 100,
  chunkSize: 150
};
```

## Error Handling Examples

### Handling API Errors

```typescript
import { runLocalTest } from './local-test-runner';

async function handleApiErrors() {
  try {
    const result = await runLocalTest('./data/participations.csv');
    return result;
  } catch (error) {
    if (error.response?.status === 401) {
      console.error('Authentication failed - check STRAPI_TOKEN');
    } else if (error.response?.status === 429) {
      console.error('Rate limited - reduce batch size or use sequential mode');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('Cannot connect to Strapi - check STRAPI_BASE_URL');
    } else {
      console.error('Unexpected error:', error.message);
    }
    throw error;
  }
}
```

### Processing Error Reports

```typescript
import { readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';

async function analyzeErrorReport(errorCsvPath: string) {
  const errorData = readFileSync(errorCsvPath, 'utf-8');
  const errors = parse(errorData, { 
    columns: true, 
    skip_empty_lines: true 
  });
  
  // Categorize errors
  const errorCategories = errors.reduce((acc, error) => {
    const category = categorizeError(error.error);
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});
  
  console.log('Error Analysis:');
  Object.entries(errorCategories).forEach(([category, count]) => {
    console.log(`  ${category}: ${count} errors`);
  });
  
  return errorCategories;
}

function categorizeError(errorMessage: string): string {
  if (errorMessage.includes('unique constraint')) return 'Duplicate Data';
  if (errorMessage.includes('validation')) return 'Validation Error';
  if (errorMessage.includes('timeout')) return 'Timeout Error';
  if (errorMessage.includes('rate limit')) return 'Rate Limit';
  return 'Other';
}
```

## Performance Optimization Examples

### Memory-Efficient Processing

```typescript
import { createLocalTestRunner } from './local-test-runner';

async function memoryEfficientProcessing(csvPath: string) {
  const runner = createLocalTestRunner();
  
  // Configuration for large files
  const config = {
    processMode: 'sequential' as const,
    omitGet: true,
    batchSize: 50,  // Smaller batches for memory efficiency
    chunkSize: 100
  };
  
  // Monitor memory usage
  const startMemory = process.memoryUsage();
  
  const result = await runner.runWithCsv(csvPath, config);
  
  const endMemory = process.memoryUsage();
  const memoryDiff = {
    rss: endMemory.rss - startMemory.rss,
    heapUsed: endMemory.heapUsed - startMemory.heapUsed,
    external: endMemory.external - startMemory.external
  };
  
  console.log('Memory usage:', memoryDiff);
  return { result, memoryDiff };
}
```

### Performance Benchmarking

```typescript
async function benchmarkProcessingModes(csvPath: string) {
  const configs = [
    { name: 'Sequential Small', processMode: 'sequential', batchSize: 10 },
    { name: 'Sequential Medium', processMode: 'sequential', batchSize: 50 },
    { name: 'Parallel Small', processMode: 'parallel', batchSize: 10 },
    { name: 'Parallel Medium', processMode: 'parallel', batchSize: 50 },
    { name: 'Parallel Large', processMode: 'parallel', batchSize: 200 }
  ];
  
  const results = [];
  
  for (const config of configs) {
    console.log(`Testing ${config.name}...`);
    
    const startTime = Date.now();
    const result = await runLocalTest(csvPath, {
      processMode: config.processMode as 'sequential' | 'parallel',
      batchSize: config.batchSize,
      omitGet: true,
      chunkSize: 150
    });
    const endTime = Date.now();
    
    results.push({
      ...config,
      processingTime: endTime - startTime,
      successCount: result.successCount,
      errorCount: result.errorCount,
      recordsPerSecond: result.successCount / ((endTime - startTime) / 1000)
    });
  }
  
  // Display benchmark results
  console.log('\n=== Performance Benchmark Results ===');
  results.forEach(r => {
    console.log(`${r.name}: ${r.recordsPerSecond.toFixed(2)} records/sec`);
  });
  
  return results;
}
```

### API Rate Limiting Handling

```typescript
async function handleRateLimiting(csvPath: string) {
  const config = {
    processMode: 'sequential' as const,
    omitGet: false,
    batchSize: 10,  // Small batches to avoid rate limits
    chunkSize: 20
  };
  
  // Add retry logic for rate limiting
  let retries = 0;
  const maxRetries = 3;
  
  while (retries < maxRetries) {
    try {
      const result = await runLocalTest(csvPath, config);
      return result;
    } catch (error) {
      if (error.response?.status === 429 && retries < maxRetries - 1) {
        retries++;
        const delay = Math.pow(2, retries) * 1000; // Exponential backoff
        console.log(`Rate limited, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}
```

## Integration Examples

### CI/CD Pipeline Integration

```yaml
# .github/workflows/test-migration.yml
name: Test Migration

on: [push, pull_request]

jobs:
  test-migration:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v2
    
    - name: Setup Node.js
      uses: actions/setup-node@v2
      with:
        node-version: '18'
    
    - name: Install dependencies
      run: |
        cd lambda/ingest
        npm install
    
    - name: Validate environment
      run: |
        cd lambda/ingest
        npm run cli validate
      env:
        STRAPI_BASE_URL: ${{ secrets.STRAPI_BASE_URL }}
        STRAPI_TOKEN: ${{ secrets.STRAPI_TOKEN }}
    
    - name: Run quick test
      run: |
        cd lambda/ingest
        npm run cli quick
      env:
        STRAPI_BASE_URL: ${{ secrets.STRAPI_BASE_URL }}
        STRAPI_TOKEN: ${{ secrets.STRAPI_TOKEN }}
    
    - name: Run unit tests
      run: |
        cd lambda/ingest
        npm test
```

### Docker Integration

```dockerfile
# Dockerfile for local development
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY lambda/ingest/package*.json ./
RUN npm install

# Copy source code
COPY lambda/ingest/ ./

# Build TypeScript
RUN npm run build

# Default command
CMD ["npm", "run", "cli", "validate"]
```

```bash
# Build and run with Docker
docker build -t apilados-migration .
docker run -e STRAPI_BASE_URL=http://host.docker.internal:1337/api \
           -e STRAPI_TOKEN=your-token \
           -v $(pwd)/data:/app/data \
           apilados-migration npm run cli test /app/data/participations.csv
```

## Troubleshooting Guide

### Database Dump Issues

#### PostgreSQL Tools Not Found
```bash
# Error: PostgreSQL client tools not found
# Solution: Install PostgreSQL client tools

# macOS
brew install postgresql

# Ubuntu/Debian
sudo apt-get install postgresql-client

# CentOS/RHEL
sudo yum install postgresql

# Verify installation
which pg_dump pg_isready
```

#### Database Connection Issues
```bash
# Error: Database connection failed
# Check connection parameters

# Test connection manually
pg_isready -h $DATABASE_HOST -p $DATABASE_PORT -U $DATABASE_USERNAME -d $DATABASE_NAME

# Common issues and solutions:
# 1. Wrong host/port: Verify DATABASE_HOST and DATABASE_PORT
# 2. Authentication failed: Check DATABASE_USERNAME and DATABASE_PASSWORD
# 3. Database not found: Verify DATABASE_NAME exists
# 4. SSL issues: Set DATABASE_SSL=true for remote connections
```

#### Dump File Issues
```bash
# Error: Permission denied writing dump file
# Solution: Check output directory permissions
mkdir -p ./dumps
chmod 755 ./dumps

# Error: Disk space insufficient
# Solution: Check available disk space
df -h .
# Clean up old dumps or choose different output directory

# Error: Dump file already exists
# Solution: Use timestamp option or different filename
npm run cli dump --dump-only --timestamp
```

### Migration Issues

#### Environment Configuration
```bash
# Error: Environment validation failed
# Solution: Check required environment variables

# Validate configuration
npm run cli validate

# Common missing variables:
export STRAPI_BASE_URL=http://localhost:1337/api
export STRAPI_TOKEN=your-token-here

# For database dumps, also need:
export DATABASE_HOST=localhost
export DATABASE_PORT=5432
export DATABASE_NAME=strapi_db
export DATABASE_USERNAME=strapi
export DATABASE_PASSWORD=your_password
```

#### Strapi Connection Issues
```bash
# Error: Cannot connect to Strapi
# Solutions:

# 1. Check if Strapi is running
curl $STRAPI_BASE_URL/users/me -H "Authorization: Bearer $STRAPI_TOKEN"

# 2. Verify base URL format (should end with /api)
export STRAPI_BASE_URL=http://localhost:1337/api

# 3. Check token validity
# Generate new token in Strapi admin panel

# 4. Check network connectivity
ping localhost  # or your Strapi host
```

#### CSV File Issues
```bash
# Error: CSV file not found
# Solution: Check file path and permissions
ls -la ./data/participations.csv

# Error: Invalid CSV format
# Solution: Validate CSV structure
head -5 ./data/participations.csv
# Should show proper headers and data format

# Error: Large file processing issues
# Solution: Use smaller batch sizes
npm run cli test large-file.csv --batch-size 25 --mode sequential
```

#### CCTs Data Issues
```bash
# Error: CCTs file not found
# Solutions:

# 1. Place ccts_export.csv in project root for auto-detection
cp ./data/ccts.csv ./ccts_export.csv

# 2. Specify CCTs file explicitly for performance optimization
npm run cli simulate data.csv --ccts ./data/ccts.csv

# 3. Disable CCTs performance optimization if not needed
npm run cli simulate data.csv --no-auto-ccts

# Error: Invalid CCTs format
# Solution: Validate CCTs CSV structure
head -5 ./ccts_export.csv
# Should have proper CCT data format
```

### Performance Issues

#### Slow Processing
```bash
# Issue: Very slow migration processing
# Solutions:

# 1. Use parallel processing
npm run cli simulate data.csv --mode parallel

# 2. Increase batch size
npm run cli simulate data.csv --batch-size 200

# 3. Skip GET requests for performance
npm run cli simulate data.csv --omit-get

# 4. Optimize configuration
npm run cli simulate data.csv --mode parallel --batch-size 200 --omit-get
```

#### Memory Issues
```bash
# Issue: Out of memory errors
# Solutions:

# 1. Use sequential processing
npm run cli simulate data.csv --mode sequential

# 2. Reduce batch size
npm run cli simulate data.csv --batch-size 25

# 3. Process in smaller chunks
split -l 1000 large-file.csv chunk_
for chunk in chunk_*; do
  npm run cli test $chunk --mode sequential --batch-size 50
done
```

#### Rate Limiting
```bash
# Issue: API rate limiting errors
# Solutions:

# 1. Use sequential processing
npm run cli simulate data.csv --mode sequential

# 2. Reduce batch size
npm run cli simulate data.csv --batch-size 10

# 3. Add delays between requests (modify code if needed)
# 4. Check Strapi rate limiting configuration
```

### Common Error Messages and Solutions

#### "Environment validation failed"
- **Cause**: Missing required environment variables
- **Solution**: Run `npm run cli validate` and add missing variables to `.env`

#### "Database connection failed"
- **Cause**: Incorrect database configuration or database not accessible
- **Solution**: Verify database is running and connection parameters are correct

#### "PostgreSQL client tools not found"
- **Cause**: pg_dump and pg_isready not installed
- **Solution**: Install PostgreSQL client tools for your operating system

#### "CSV file not found"
- **Cause**: Incorrect file path or file doesn't exist
- **Solution**: Verify file path and ensure file exists with proper permissions

#### "Authentication failed"
- **Cause**: Invalid Strapi token or expired token
- **Solution**: Generate new token in Strapi admin panel and update STRAPI_TOKEN

#### "Rate limit exceeded"
- **Cause**: Too many requests to Strapi API
- **Solution**: Use sequential processing or reduce batch size

#### "Validation error" in migration
- **Cause**: Data doesn't match Strapi content type schema
- **Solution**: Review error report CSV and fix data format issues

#### "Unique constraint violation"
- **Cause**: Duplicate data being inserted
- **Solution**: Clean data to remove duplicates or handle conflicts in Strapi

### Debug Mode

```bash
# Enable debug mode for detailed logging
DEBUG=true npm run cli simulate data.csv

# Enable verbose logging for database operations
DEBUG=true npm run cli dump

# Check detailed error information
cat error-report-*.csv  # Review error details
```

### Getting Help

1. **Check Documentation**: Review README.md and this usage guide
2. **Validate Environment**: Always run `npm run cli validate` first
3. **Check Error Reports**: Review generated CSV error reports for details
4. **Enable Debug Mode**: Use `DEBUG=true` for verbose logging
5. **Test with Small Data**: Start with small CSV files to isolate issues
6. **Check Strapi Logs**: Review Strapi server logs for API-related issues

These examples provide comprehensive coverage of the system's capabilities and should help users understand how to effectively use the migration system in various scenarios.