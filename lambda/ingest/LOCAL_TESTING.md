# Local Testing Framework

This document describes how to use the local testing framework for the migration lambda. The framework allows you to test the migration functionality locally with CSV files before deploying to AWS.

## Quick Start

1. **Setup Environment**
   ```bash
   # Copy environment template
   cp .env.example .env
   
   # Edit .env with your Strapi configuration
   # Set STRAPI_BASE_URL and STRAPI_TOKEN
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Validate Environment**
   ```bash
   npm run cli validate
   ```

4. **Generate Test Data**
   ```bash
   npm run cli setup
   ```

5. **Run Quick Test**
   ```bash
   npm run cli quick
   ```

## Environment Configuration

### Required Variables
- `STRAPI_BASE_URL` - Base URL for your Strapi API (e.g., `http://localhost:1337/api`)
- `STRAPI_TOKEN` - Authentication token for Strapi API

### Optional Variables
- `PROCESS_MODE` - Processing mode: `parallel` or `sequential` (default: `parallel`)
- `OMIT_GET` - Skip GET requests for performance: `true` or `false` (default: `false`)
- `BATCH_SIZE` - Number of records to process in each batch (default: `100`)
- `CHUNK_SIZE` - Chunk size for S3 processing (default: `150`)

## CLI Commands

### Environment Management
```bash
# Validate environment configuration
npm run cli validate

# Show environment summary
npm run cli env
```

### Test Data Generation
```bash
# Generate sample test data
npm run cli generate --output test-data --count 50

# Setup complete test environment
npm run cli setup --dir my-test-env
```

### Running Tests
```bash
# Quick validation test with generated data
npm run cli quick

# Test with your CSV file
npm run cli test ./data/participations.csv

# Test with custom configuration
npm run cli test ./data/participations.csv \
  --mode sequential \
  --omit-get \
  --batch-size 50 \
  --ccts ./data/ccts.csv
```

## Programmatic Usage

### Basic Test Runner
```typescript
import { runLocalTest } from './local-test-runner';

// Simple test with default configuration
const result = await runLocalTest('./data/participations.csv');
console.log('Test result:', result);
```

### Advanced Test Runner
```typescript
import { createLocalTestRunner } from './local-test-runner';
import { ProcessingConfig } from './types';

// Create test runner instance
const runner = createLocalTestRunner();

// Validate environment
const isValid = runner.validateEnvironment();
if (!isValid) {
  throw new Error('Environment validation failed');
}

// Custom configuration
const config: ProcessingConfig = {
  processMode: 'sequential',
  omitGet: true,
  batchSize: 25,
  chunkSize: 50
};

// Run test
const result = await runner.runWithCsv('./data/participations.csv', config);
```

### Development Utilities
```typescript
import { 
  validateEnv, 
  generateTestData, 
  setupTestEnvironment,
  quickTest 
} from './dev-utils';

// Validate environment
const validation = validateEnv();
if (!validation.isValid) {
  console.error('Environment issues:', validation.errors);
}

// Generate test data
const testData = await generateTestData('test-data', 100);

// Setup test environment
const testEnv = await setupTestEnvironment('my-test-env');

// Run quick test
const report = await quickTest();
```

## Test Data Format

The framework expects CSV files with the following structure:

### Participations CSV
Required columns:
- `id` - Unique participant identifier
- `nombre`, `primer_apellido`, `segundo_apellido` - Name fields
- `email` - Participant email
- `programa` - Program name
- `implementacion` - Implementation name
- `ciclo_escolar` - School cycle
- `periodo_de_implementacion` - Implementation period

Optional columns:
- `edad`, `sexo`, `telefono`, `curp`, `rfc` - Personal information
- `cct` - Centro de Trabajo identifier
- `puesto`, `puesto_detalle` - Position information
- `mod1`, `mod2`, `mod3` - Module scores
- `encuesta_inicial`, `encuesta_final` - Survey completion status

### CCTs CSV (Optional)
- `cct` - Centro de Trabajo identifier
- `nombre` - CCT name
- `municipio` - Municipality
- `entidad` - State/Entity
- `tipo` - Type of institution

## Processing Modes

### Sequential Mode
- Processes records one by one
- Easier to debug
- Slower but more predictable
- Use for debugging or when API has rate limits

```bash
npm run cli test data.csv --mode sequential
```

### Parallel Mode
- Processes multiple records simultaneously
- Faster processing
- May overwhelm API with concurrent requests
- Use for performance testing

```bash
npm run cli test data.csv --mode parallel --batch-size 50
```

## Performance Optimization

### For Development/Debugging
```typescript
const config: ProcessingConfig = {
  processMode: 'sequential',
  omitGet: true,        // Skip existence checks
  batchSize: 10,        // Small batches
  chunkSize: 20
};
```

### For Performance Testing
```typescript
const config: ProcessingConfig = {
  processMode: 'parallel',
  omitGet: false,       // Include all checks
  batchSize: 100,       // Large batches
  chunkSize: 200
};
```

## Error Handling

The framework provides comprehensive error reporting:

### Error CSV Report
When errors occur, an error report CSV is generated with:
- Participant ID and email
- Row number where error occurred
- Error category and description
- Timestamp

### Error Categories
- **API Error** - Strapi API communication issues
- **Validation Error** - Data validation failures
- **Participant Error** - Participant-specific processing issues
- **Email Error** - Email handling problems
- **CSV Processing Error** - CSV parsing issues
- **Network Error** - Network connectivity problems

## Troubleshooting

### Common Issues

1. **Environment Validation Failed**
   ```bash
   # Check your .env file
   npm run cli env
   
   # Validate configuration
   npm run cli validate
   ```

2. **Strapi Connection Issues**
   - Verify `STRAPI_BASE_URL` is correct
   - Check `STRAPI_TOKEN` is valid
   - Ensure Strapi is running and accessible

3. **CSV Processing Errors**
   - Verify CSV file format and encoding
   - Check for required columns
   - Validate data types and formats

4. **Performance Issues**
   - Reduce batch size for API rate limiting
   - Use `omitGet: true` for faster testing
   - Switch to sequential mode for debugging

### Debug Mode
Enable verbose logging:
```bash
DEBUG=true npm run cli test data.csv
```

## Integration with Development Workflow

### Pre-deployment Testing
```bash
# 1. Validate environment
npm run cli validate

# 2. Test with sample data
npm run cli quick

# 3. Test with production-like data
npm run cli test production-sample.csv --mode parallel

# 4. Performance test
npm run cli test large-dataset.csv --batch-size 200
```

### Continuous Integration
```bash
# Add to CI pipeline
npm run cli validate || exit 1
npm run cli quick || exit 1
```

### Local Development
```bash
# Setup once
npm run dev-setup

# Daily development
npm run cli test my-changes.csv --omit-get --batch-size 10
```

## Examples

See `examples/local-testing-example.ts` for comprehensive usage examples including:
- Environment validation
- Test data generation
- Performance comparisons
- Advanced test runner usage
- Error handling patterns

Run the examples:
```bash
npx ts-node examples/local-testing-example.ts
```

## API Reference

### LocalTestRunner Interface
```typescript
interface LocalTestRunner {
  runWithCsv(csvPath: string, config?: ProcessingConfig): Promise<MigrationResult>;
  validateEnvironment(): boolean;
  generateTestReport(): TestReport;
}
```

### MigrationResult Interface
```typescript
interface MigrationResult {
  successCount: number;
  errorCount: number;
  processingTime: number;
  errorCsvPath?: string;
  totalRecords: number;
}
```

### ProcessingConfig Interface
```typescript
interface ProcessingConfig {
  processMode: "parallel" | "sequential";
  omitGet: boolean;
  batchSize: number;
  chunkSize: number;
}
```

For more detailed API documentation, see the TypeScript interfaces in `types.ts`.