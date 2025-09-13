# Apilados Pipeline - Data Migration System

A comprehensive data migration system built with AWS CDK and TypeScript, featuring a unified lambda function for processing participant data from CSV files. The system supports both local testing and AWS deployment for S3-triggered processing.

## Architecture Overview

The system consists of:
- **Ingest Lambda**: Unified data processing function that handles CSV migration
- **S3 Integration**: Automatic processing of CSV files uploaded to S3
- **Local Testing Framework**: Complete local development and testing capabilities
- **Error Reporting**: Comprehensive error handling with CSV report generation

## Key Features

- **Dual Execution Modes**: Supports both local testing and AWS S3 event processing
- **Three-Phase Processing**: Analysis, pre-loading, and batch processing for optimal performance
- **Comprehensive Error Handling**: Detailed error logging and CSV report generation
- **Flexible Configuration**: Environment-based configuration for different deployment scenarios
- **Performance Optimization**: Configurable parallel/sequential processing modes

## Quick Start

### Local Development

1. **Setup Environment**
   ```bash
   cd lambda/ingest
   cp .env.example .env
   # Edit .env with your Strapi configuration
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Run Local Test**
   ```bash
   npm run cli quick
   ```

### AWS Deployment

1. **Build and Deploy**
   ```bash
   npm run build
   npx cdk deploy
   ```

2. **Upload CSV to S3**
   - CSV files uploaded to the configured S3 bucket will automatically trigger processing

## Project Structure

```
├── lambda/ingest/          # Main lambda function
│   ├── index.ts           # Lambda handler
│   ├── local-test-runner.ts # Local testing framework
│   ├── dev-utils.ts       # Development utilities
│   ├── processing-pipeline.ts # Core processing logic
│   ├── error-reporter.ts  # Error handling and reporting
│   └── examples/          # Usage examples
├── lib/                   # CDK stack definition
├── test/                  # CDK tests
└── test-data/            # Sample CSV files
```

## Documentation

- **[Local Testing Guide](lambda/ingest/LOCAL_TESTING.md)** - Complete guide for local development and testing
- **[Environment Variables](lambda/ingest/ENVIRONMENT_VARIABLES.md)** - Configuration reference
- **[Build Configuration](lambda/ingest/BUILD_CONFIGURATION.md)** - Build and deployment setup

## Usage Examples

### Local Testing with CLI
```bash
cd lambda/ingest

# Validate environment
npm run cli validate

# Test with sample data
npm run cli quick

# Test with your CSV file
npm run cli test ./data/participations.csv --mode parallel
```

### Programmatic Usage
```typescript
import { runLocalTest } from './lambda/ingest/local-test-runner';

const result = await runLocalTest('./data/participations.csv', {
  processMode: 'parallel',
  batchSize: 100,
  omitGet: false
});

console.log(`Processed ${result.successCount} records successfully`);
```

### AWS S3 Processing
Once deployed, simply upload CSV files to the configured S3 bucket. The lambda will:
1. Automatically detect and download the CSV file
2. Process participant data using the three-phase approach
3. Generate error reports for any failed records
4. Upload error reports back to S3

## Migration from migrator.js

The original `migrator.js` functionality has been fully integrated into the lambda function. Key improvements:

- **Unified Architecture**: Single lambda function handles both local and AWS processing
- **Enhanced Error Handling**: Comprehensive error reporting with CSV generation
- **Better Testing**: Complete local testing framework with CLI tools
- **Type Safety**: Full TypeScript implementation with proper type definitions
- **Performance**: Optimized processing with configurable batch sizes and modes

## CDK Commands

- `npm run build` - Compile TypeScript to JavaScript
- `npm run watch` - Watch for changes and compile
- `npm run test` - Run CDK unit tests
- `npx cdk deploy` - Deploy stack to AWS
- `npx cdk diff` - Compare deployed stack with current state
- `npx cdk synth` - Generate CloudFormation template

## Lambda Commands

```bash
cd lambda/ingest

# Development
npm run build          # Compile TypeScript
npm run test          # Run unit tests
npm run test:coverage # Run tests with coverage

# Local Testing
npm run cli validate  # Validate environment
npm run cli quick     # Quick test with sample data
npm run cli test <csv-file> # Test with specific CSV file
```

## Environment Configuration

The system supports flexible environment configuration for different scenarios:

### Local Development (.env)
```bash
STRAPI_BASE_URL=http://localhost:1337/api
STRAPI_TOKEN=your-development-token
PROCESS_MODE=parallel
BATCH_SIZE=50
```

### AWS Production
Environment variables are automatically configured through CDK deployment parameters.

## Error Handling

The system provides comprehensive error handling:
- **Validation Errors**: Configuration and data validation
- **API Errors**: Strapi communication issues
- **Processing Errors**: Individual record processing failures
- **CSV Reports**: Detailed error reports in CSV format

## Performance Optimization

- **Parallel Processing**: Configurable parallel/sequential modes
- **Batch Processing**: Adjustable batch sizes for optimal performance
- **Memory Management**: Streaming CSV processing for large files
- **API Optimization**: Optional GET request skipping for performance

## Contributing

1. Follow the existing code structure and TypeScript conventions
2. Add tests for new functionality
3. Update documentation for any new features
4. Ensure all tests pass before submitting changes

## Support

For issues or questions:
1. Check the documentation in `lambda/ingest/`
2. Review the examples in `lambda/ingest/examples/`
3. Run `npm run cli validate` to check configuration
4. Enable debug mode with `DEBUG=true` for verbose logging
