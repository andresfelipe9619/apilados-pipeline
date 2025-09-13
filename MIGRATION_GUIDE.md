# Migration Guide: From migrator.js to Lambda Integration

This guide helps users transition from the standalone `migrator.js` script to the new integrated lambda function architecture.

## Overview of Changes

The original `migrator.js` functionality has been fully integrated into the `lambda/ingest` function, providing:

- **Unified Architecture**: Single lambda function handles both local and AWS processing
- **Enhanced Error Handling**: Comprehensive error reporting with CSV generation
- **Better Testing**: Complete local testing framework with CLI tools
- **Type Safety**: Full TypeScript implementation with proper type definitions
- **Performance**: Optimized processing with configurable batch sizes and modes

## What's New

### ✅ Enhanced Features

1. **Dual Execution Modes**
   - Local mode for development and testing
   - AWS mode for production S3 event processing

2. **Comprehensive CLI Tools**
   - Environment validation
   - Test data generation
   - Performance testing
   - Error analysis

3. **Better Error Handling**
   - Detailed error categorization
   - CSV error reports with participant context
   - Retry mechanisms for API failures

4. **TypeScript Benefits**
   - Full type safety
   - Better IDE support
   - Compile-time error detection

5. **Testing Framework**
   - Unit tests for all components
   - Integration tests with sample data
   - Performance benchmarking tools

## Migration Steps

### Step 1: Environment Setup

Your existing `.env` file should work without changes, but you can optionally update variable names:

**Before (migrator.js):**
```bash
STRAPI_URL=http://localhost:1337/api
STRAPI_TOKEN=your-token-here
OMMIT_GET=true
PARTICIPATIONS_CSV_FILE=data/apilado_universal.csv
CCTS_CSV_FILE=data/ccts_export.csv
PROCESS_MODE=parallel
```

**After (lambda/ingest):**
```bash
# New preferred names (old names still supported)
STRAPI_BASE_URL=http://localhost:1337/api
STRAPI_TOKEN=your-token-here
OMIT_GET=true
PARTICIPATIONS_CSV_FILE=data/apilado_universal.csv
CCTS_CSV_FILE=data/ccts_export.csv
PROCESS_MODE=parallel
```

### Step 2: Update Your Workflow

**Before (migrator.js):**
```bash
# Old workflow
node migrator.js
```

**After (lambda/ingest):**
```bash
# New workflow
cd lambda/ingest
npm run cli test data/apilado_universal.csv
```

### Step 3: Leverage New Features

#### Environment Validation
```bash
cd lambda/ingest
npm run cli validate
```

#### Quick Testing
```bash
npm run cli quick
```

#### Performance Testing
```bash
npm run cli test data/large-dataset.csv --mode parallel --batch-size 200
```

## Command Equivalents

| migrator.js | Lambda Integration |
|-------------|-------------------|
| `node migrator.js` | `npm run cli test data/apilado_universal.csv` |
| N/A | `npm run cli validate` |
| N/A | `npm run cli quick` |
| N/A | `npm run cli generate` |

## Configuration Migration

### Environment Variables

| migrator.js | Lambda Integration | Notes |
|-------------|-------------------|-------|
| `STRAPI_URL` | `STRAPI_BASE_URL` | Old name still supported |
| `OMMIT_GET` | `OMIT_GET` | Fixed typo, old name supported |
| `PARTICIPATIONS_CSV_FILE` | Same | No change |
| `CCTS_CSV_FILE` | Same | No change |
| `PROCESS_MODE` | Same | No change |
| `BATCH_SIZE` | Same | No change |

### New Configuration Options

```bash
# New options available
CHUNK_SIZE=150          # S3 processing chunk size
OUTPUT_PATH=errors.csv  # Custom error report path
DEBUG=true             # Enable verbose logging
```

## Feature Comparison

### Processing Logic
- ✅ **Same three-phase approach**: Analysis, pre-loading, batch processing
- ✅ **Same entity creation order**: Programs → Implementations → Modules/Surveys/etc.
- ✅ **Same caching mechanism**: All entity caches maintained
- ✅ **Same API interactions**: Identical Strapi API calls

### Error Handling
- ✅ **Enhanced error reporting**: More detailed error context
- ✅ **Better error categorization**: API, validation, network errors
- ✅ **Improved CSV reports**: Better formatting and information

### Performance
- ✅ **Same performance characteristics**: Parallel/sequential modes
- ✅ **Configurable batch sizes**: Same flexibility
- ✅ **Memory optimization**: Streaming CSV processing

## Troubleshooting Migration Issues

### Common Issues and Solutions

#### 1. Environment Variables Not Found
```bash
# Check your environment
cd lambda/ingest
npm run cli env

# Validate configuration
npm run cli validate
```

#### 2. CSV File Path Issues
```bash
# Use absolute paths if needed
npm run cli test /full/path/to/your/data.csv

# Or relative to lambda/ingest directory
npm run cli test ../../data/apilado_universal.csv
```

#### 3. Performance Differences
```bash
# Use same configuration as migrator.js
npm run cli test data.csv --mode parallel --batch-size 100 --omit-get
```

#### 4. Missing Dependencies
```bash
cd lambda/ingest
npm install
```

### Debugging Migration Issues

#### Enable Debug Mode
```bash
DEBUG=true npm run cli test data.csv
```

#### Compare Results
```bash
# Run with same configuration as migrator.js
npm run cli test data.csv \
  --mode parallel \
  --batch-size 100 \
  --omit-get \
  --ccts data/ccts_export.csv
```

#### Check Error Reports
The new system generates more detailed error reports. Compare:

**migrator.js error format:**
```csv
participante_id,email,error
123,user@example.com,"API Error"
```

**Lambda integration error format:**
```csv
participante_id,email,error,row_number,timestamp,category
123,user@example.com,"Detailed API error message",45,2024-01-01T10:00:00Z,API_ERROR
```

## Advanced Migration Scenarios

### Batch Processing Multiple Files

**Before (migrator.js):**
```bash
# Manual process for multiple files
PARTICIPATIONS_CSV_FILE=file1.csv node migrator.js
PARTICIPATIONS_CSV_FILE=file2.csv node migrator.js
PARTICIPATIONS_CSV_FILE=file3.csv node migrator.js
```

**After (lambda/ingest):**
```bash
# Automated batch processing
for file in data/*.csv; do
  npm run cli test "$file"
done
```

### Custom Configuration per File

**Before (migrator.js):**
```bash
# Change .env file for each configuration
PROCESS_MODE=sequential node migrator.js
```

**After (lambda/ingest):**
```bash
# Command-line configuration
npm run cli test data1.csv --mode sequential --batch-size 50
npm run cli test data2.csv --mode parallel --batch-size 200
```

### Performance Monitoring

**Before (migrator.js):**
```bash
# Manual timing
time node migrator.js
```

**After (lambda/ingest):**
```bash
# Built-in performance reporting
npm run cli test data.csv  # Shows processing time automatically

# Detailed benchmarking
npm run cli benchmark data.csv
```

## AWS Deployment Migration

### CDK Integration

The lambda function is now fully integrated with CDK for AWS deployment:

```typescript
// lib/apilados-pipeline-stack.ts
const params: Params = {
  // Same configuration as your migrator.js .env
  strapiBaseUrl: 'https://api.production.com/api',
  strapiToken: process.env.STRAPI_TOKEN!,
  processMode: 'parallel',
  omitGet: false,
  batchSize: 100
};
```

### S3 Event Processing

Once deployed, CSV files uploaded to S3 automatically trigger processing:

```bash
# Upload triggers automatic processing
aws s3 cp data/participations.csv s3://your-bucket/uploads/

# Monitor processing
aws logs tail /aws/lambda/apilados-pipeline-ingest --follow
```

## Validation Checklist

Use this checklist to ensure successful migration:

### ✅ Environment Setup
- [ ] Environment variables configured
- [ ] `npm run cli validate` passes
- [ ] Strapi connection working

### ✅ Functionality Testing
- [ ] `npm run cli quick` succeeds
- [ ] Test with your actual CSV files
- [ ] Error handling works correctly
- [ ] Performance meets expectations

### ✅ Feature Parity
- [ ] Same number of records processed
- [ ] Same entities created in Strapi
- [ ] Error reports generated correctly
- [ ] Processing time comparable

### ✅ Integration Testing
- [ ] Local testing works
- [ ] CDK deployment successful (if using AWS)
- [ ] S3 event processing works (if using AWS)

## Getting Help

If you encounter issues during migration:

1. **Check Documentation**
   - [Local Testing Guide](lambda/ingest/LOCAL_TESTING.md)
   - [Environment Variables](lambda/ingest/ENVIRONMENT_VARIABLES.md)
   - [Usage Examples](USAGE_EXAMPLES.md)

2. **Use Diagnostic Tools**
   ```bash
   cd lambda/ingest
   npm run cli validate  # Check configuration
   npm run cli env      # Show environment details
   DEBUG=true npm run cli test data.csv  # Verbose logging
   ```

3. **Compare Configurations**
   - Ensure environment variables match your migrator.js setup
   - Use same processing mode and batch size
   - Verify CSV file paths and formats

4. **Test Incrementally**
   - Start with `npm run cli quick`
   - Test with small CSV files first
   - Gradually increase to full datasets

## Benefits of Migration

After successful migration, you'll have:

- **Better Development Experience**: CLI tools, validation, and testing
- **Enhanced Error Handling**: Detailed error reports and categorization
- **Type Safety**: Full TypeScript benefits
- **AWS Integration**: Seamless S3 event processing
- **Performance Monitoring**: Built-in timing and benchmarking
- **Comprehensive Testing**: Unit and integration test coverage

The migration preserves all existing functionality while adding significant improvements for development, testing, and deployment workflows.