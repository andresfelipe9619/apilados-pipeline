# Environment Variables

This document describes all environment variables supported by the enhanced ingest lambda function, including backward compatibility with the original migrator.js script.

## Required Environment Variables

### `STRAPI_BASE_URL` or `STRAPI_URL`
- **Description**: Base URL for the Strapi API endpoint
- **Example**: `https://api.example.com/api` or `http://localhost:1337/api`
- **Compatibility**: `STRAPI_URL` is supported for migrator.js compatibility

### `STRAPI_TOKEN`
- **Description**: Authentication token for Strapi API access
- **Example**: `your-strapi-jwt-token-here`
- **Required**: Yes

## Optional Environment Variables

### Processing Configuration

#### `PROCESS_MODE`
- **Description**: Processing mode for participant data
- **Values**: `parallel` (default) or `sequential`
- **Default**: `parallel`
- **Example**: `PROCESS_MODE=sequential`

#### `OMIT_GET` or `OMMIT_GET`
- **Description**: Skip GET requests for performance optimization
- **Values**: `true` or `false`
- **Default**: `false`
- **Compatibility**: `OMMIT_GET` is supported for migrator.js compatibility (note the typo)
- **Example**: `OMIT_GET=true`

#### `BATCH_SIZE`
- **Description**: Number of records to process in each batch
- **Values**: Positive integer
- **Default**: `100`
- **Example**: `BATCH_SIZE=50`

#### `CHUNK_SIZE`
- **Description**: S3 processing chunk size for AWS mode
- **Values**: Positive integer
- **Default**: `150`
- **Example**: `CHUNK_SIZE=200`

### Local Mode Configuration (migrator.js compatibility)

#### `PARTICIPATIONS_CSV_FILE`
- **Description**: Path to the participations CSV file for local processing
- **Example**: `PARTICIPATIONS_CSV_FILE=data/apilado_universal.csv`
- **Note**: When this is set, the lambda will automatically use local mode

#### `CCTS_CSV_FILE`
- **Description**: Path to the CCTs CSV file for local processing (optional)
- **Example**: `CCTS_CSV_FILE=data/ccts_export.csv`
- **Note**: If not provided or file doesn't exist, processing continues without CCTs

#### `OUTPUT_PATH`
- **Description**: Path for error report output in local mode
- **Default**: `simulation-errors.csv`
- **Example**: `OUTPUT_PATH=reports/errors.csv`

### AWS-Specific Environment Variables

#### `BUCKET_NAME`
- **Description**: S3 bucket name for error report uploads in AWS mode
- **Example**: `BUCKET_NAME=my-processing-bucket`
- **Note**: Automatically set by CDK deployment

#### `S3_KEY_PREFIX`
- **Description**: S3 key prefix for filtering CSV files
- **Example**: `S3_KEY_PREFIX=uploads/`
- **Note**: Automatically set by CDK deployment

## Environment Variable Precedence

When multiple environment variables provide the same configuration:

1. **STRAPI_BASE_URL** takes precedence over **STRAPI_URL**
2. **OMIT_GET** takes precedence over **OMMIT_GET**
3. Environment variables override .env file values
4. CDK deployment parameters override environment variables

## Usage Examples

### Local Development (.env file)
```bash
# Required
STRAPI_BASE_URL=http://localhost:1337/api
STRAPI_TOKEN=your-token-here

# Optional processing configuration
PROCESS_MODE=parallel
OMIT_GET=false
BATCH_SIZE=100

# Local mode (migrator.js compatibility)
PARTICIPATIONS_CSV_FILE=test-data/sample.csv
CCTS_CSV_FILE=test-data/ccts.csv
OUTPUT_PATH=reports/simulation-errors.csv
```

### AWS Lambda Environment
```bash
# Required (set by CDK)
STRAPI_BASE_URL=https://api.production.com/api
STRAPI_TOKEN=production-token

# Processing configuration (set by CDK)
PROCESS_MODE=parallel
OMIT_GET=false
BATCH_SIZE=100
CHUNK_SIZE=150

# AWS-specific (set by CDK)
BUCKET_NAME=production-processing-bucket
S3_KEY_PREFIX=uploads/
```

### Migrator.js Compatibility Mode
```bash
# Use original migrator.js variable names
STRAPI_URL=http://localhost:1337/api
STRAPI_TOKEN=your-token-here
OMMIT_GET=true
PARTICIPATIONS_CSV_FILE=data/apilado_universal.csv
CCTS_CSV_FILE=data/ccts_export.csv
```

## CDK Configuration

The CDK stack supports configurable environment variables through parameters:

```typescript
const params: Params = {
  // ... other parameters
  processMode: "parallel", // optional
  omitGet: false, // optional
  batchSize: 100, // optional
  chunkSize: 150, // optional
};
```

## Validation

The lambda function validates all environment variables on startup and will:
- **Fail** if required variables are missing
- **Warn** about missing optional files (like CCTs CSV)
- **Log** configuration details for debugging

## Migration from migrator.js

To migrate from the original migrator.js script:

1. **Keep existing .env file**: All migrator.js environment variables are supported
2. **Optional updates**: Consider using the new variable names for clarity:
   - `STRAPI_URL` → `STRAPI_BASE_URL`
   - `OMMIT_GET` → `OMIT_GET`
3. **No code changes required**: The lambda automatically detects local mode when `PARTICIPATIONS_CSV_FILE` is set