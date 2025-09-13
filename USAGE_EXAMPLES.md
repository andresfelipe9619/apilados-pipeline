# Usage Examples

This document provides comprehensive examples for using the Apilados Pipeline data migration system in various scenarios.

## Table of Contents

1. [Local Development Examples](#local-development-examples)
2. [AWS Deployment Examples](#aws-deployment-examples)
3. [CLI Usage Examples](#cli-usage-examples)
4. [Programmatic Usage Examples](#programmatic-usage-examples)
5. [Configuration Examples](#configuration-examples)
6. [Error Handling Examples](#error-handling-examples)
7. [Performance Optimization Examples](#performance-optimization-examples)

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
STRAPI_BASE_URL=http://localhost:1337/api
STRAPI_TOKEN=your-strapi-token-here
PROCESS_MODE=parallel
BATCH_SIZE=100
OMIT_GET=false
EOF

# 5. Validate environment
npm run cli validate

# 6. Run quick test
npm run cli quick
```

### Testing with Custom CSV Files

```bash
# Test with your own CSV file
npm run cli test ./data/my-participations.csv

# Test with custom configuration
npm run cli test ./data/my-participations.csv \
  --mode sequential \
  --batch-size 25 \
  --omit-get \
  --ccts ./data/my-ccts.csv

# Test with performance optimization
npm run cli test ./data/large-dataset.csv \
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

# 3. Test changes with small dataset
npm run cli test test-data/sample.csv --batch-size 10

# 4. Run full test suite
npm test

# 5. Test with larger dataset
npm run cli test test-data/large-sample.csv --mode parallel
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
  bucketName: 'my-migration-bucket',
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
aws s3 cp ./data/participations.csv s3://your-migration-bucket/uploads/

# Monitor lambda logs
aws logs tail /aws/lambda/apilados-pipeline-ingest --follow

# Download error reports if any
aws s3 ls s3://your-migration-bucket/errors/
aws s3 cp s3://your-migration-bucket/errors/error-report.csv ./
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

# Test specific scenarios
npm run cli test data.csv --mode sequential    # Debug mode
npm run cli test data.csv --mode parallel     # Performance mode
npm run cli test data.csv --omit-get          # Fast mode
npm run cli test data.csv --batch-size 10     # Small batches

# Performance testing
time npm run cli test large-dataset.csv --mode parallel --batch-size 500
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
```

#### Testing Environment
```bash
# .env for testing
STRAPI_BASE_URL=https://staging-api.example.com/api
STRAPI_TOKEN=staging-token-here
PROCESS_MODE=parallel
BATCH_SIZE=50
OMIT_GET=true
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
  bucketName: 'production-migration-bucket'
};
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

These examples provide comprehensive coverage of the system's capabilities and should help users understand how to effectively use the migration system in various scenarios.