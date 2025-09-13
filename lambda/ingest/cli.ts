#!/usr/bin/env node

/**
 * Command Line Interface for local migration testing
 * Provides easy access to development utilities and test runner
 */

import { Command } from "commander";
const program = new Command();
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { runLocalTest } from "./local-test-runner";
import { 
  validateEnv, 
  generateTestData, 
  setupTestEnvironment, 
  quickTest, 
  showEnvironment 
} from "./dev-utils";
import { ProcessingConfig } from "./types";

// CLI version
const VERSION = "1.0.0";

program
  .name("migration-cli")
  .description("Local testing CLI for migration lambda")
  .version(VERSION);

// Environment validation command
program
  .command("validate")
  .description("Validate environment configuration")
  .action(async () => {
    console.log("🔍 Validating environment configuration...\n");
    
    const validation = validateEnv();
    
    if (validation.isValid) {
      console.log("✅ Environment validation passed!");
    } else {
      console.log("❌ Environment validation failed:");
      validation.errors.forEach(error => console.log(`   - ${error}`));
    }
    
    if (validation.warnings.length > 0) {
      console.log("\n⚠️  Warnings:");
      validation.warnings.forEach(warning => console.log(`   - ${warning}`));
    }
    
    if (validation.recommendations.length > 0) {
      console.log("\n💡 Recommendations:");
      validation.recommendations.forEach(rec => console.log(`   - ${rec}`));
    }
    
    process.exit(validation.isValid ? 0 : 1);
  });

// Environment summary command
program
  .command("env")
  .description("Display environment configuration summary")
  .action(() => {
    showEnvironment();
  });

// Generate test data command
program
  .command("generate")
  .description("Generate sample test data")
  .option("-o, --output <dir>", "Output directory", "test-data")
  .option("-c, --count <number>", "Number of records to generate", "20")
  .action(async (options: any) => {
    console.log(`📝 Generating test data in: ${options.output}`);
    
    try {
      const recordCount = parseInt(options.count);
      const result = await generateTestData(options.output, recordCount);
      
      console.log("✅ Test data generated successfully:");
      console.log(`   - Participations CSV: ${result.participationsCsv}`);
      console.log(`   - CCTs CSV: ${result.cctsCsv}`);
    } catch (error) {
      console.error("❌ Failed to generate test data:", error);
      process.exit(1);
    }
  });

// Setup test environment command
program
  .command("setup")
  .description("Setup complete test environment")
  .option("-d, --dir <directory>", "Test environment directory", "test-environment")
  .action(async (options: any) => {
    console.log(`🏗️  Setting up test environment in: ${options.dir}`);
    
    try {
      const result = await setupTestEnvironment(options.dir);
      
      console.log("✅ Test environment created successfully:");
      console.log(`   - Directory: ${result.testDir}`);
      console.log(`   - Sample CSV: ${result.sampleCsv}`);
      console.log(`   - CCTs CSV: ${result.cctsCsv}`);
      console.log(`   - Environment template: ${result.envFile}`);
      console.log("\n💡 Next steps:");
      console.log("   1. Copy .env.test to .env in your project root");
      console.log("   2. Fill in your Strapi configuration in .env");
      console.log("   3. Run: migration-cli test <csv-file>");
    } catch (error) {
      console.error("❌ Failed to setup test environment:", error);
      process.exit(1);
    }
  });

// Quick test command
program
  .command("quick")
  .description("Run quick validation test with generated sample data")
  .action(async () => {
    console.log("🚀 Running quick validation test...");
    
    try {
      const report = await quickTest();
      
      console.log("\n📊 Quick Test Results:");
      console.log(`   - Total Records: ${report.result.totalRecords}`);
      console.log(`   - Successful: ${report.result.successCount}`);
      console.log(`   - Errors: ${report.result.errorCount}`);
      console.log(`   - Processing Time: ${(report.result.processingTime / 1000).toFixed(2)}s`);
      
      if (report.result.errorCount > 0) {
        console.log(`   - Error Report: ${report.result.errorCsvPath}`);
      }
      
      process.exit(report.result.errorCount > 0 ? 1 : 0);
    } catch (error) {
      console.error("❌ Quick test failed:", error);
      process.exit(1);
    }
  });

// Test command
program
  .command("test")
  .description("Run migration test with CSV file")
  .argument("<csv-file>", "Path to CSV file to process")
  .option("-m, --mode <mode>", "Processing mode: parallel or sequential", "parallel")
  .option("--omit-get", "Skip GET requests for performance", false)
  .option("-b, --batch-size <size>", "Batch size for processing", "100")
  .option("-c, --chunk-size <size>", "Chunk size for S3 processing", "150")
  .option("--ccts <file>", "Path to CCTs CSV file")
  .action(async (csvFile: string, options: any) => {
    console.log(`🚀 Running migration test with: ${csvFile}`);
    
    // Validate CSV file exists
    const csvPath = resolve(csvFile);
    if (!existsSync(csvPath)) {
      console.error(`❌ CSV file not found: ${csvPath}`);
      process.exit(1);
    }
    
    // Validate environment first
    const validation = validateEnv();
    if (!validation.isValid) {
      console.error("❌ Environment validation failed:");
      validation.errors.forEach(error => console.error(`   - ${error}`));
      console.error("\nRun 'migration-cli validate' for more details");
      process.exit(1);
    }
    
    try {
      // Build processing configuration
      const config: ProcessingConfig = {
        processMode: options.mode === "sequential" ? "sequential" : "parallel",
        omitGet: options.omitGet,
        batchSize: parseInt(options.batchSize),
        chunkSize: parseInt(options.chunkSize),
      };
      
      console.log("📋 Configuration:");
      console.log(`   - Processing Mode: ${config.processMode}`);
      console.log(`   - Omit GET: ${config.omitGet}`);
      console.log(`   - Batch Size: ${config.batchSize}`);
      console.log(`   - Chunk Size: ${config.chunkSize}`);
      
      if (options.ccts) {
        console.log(`   - CCTs File: ${options.ccts}`);
      }
      
      // Run the test
      const result = await runLocalTest(csvPath, config);
      
      console.log("\n📊 Migration Test Results:");
      console.log("=" .repeat(50));
      console.log(`Total Records: ${result.totalRecords}`);
      console.log(`Successful: ${result.successCount}`);
      console.log(`Errors: ${result.errorCount}`);
      console.log(`Success Rate: ${((result.successCount / result.totalRecords) * 100).toFixed(1)}%`);
      console.log(`Processing Time: ${(result.processingTime / 1000).toFixed(2)} seconds`);
      
      if (result.errorCsvPath) {
        console.log(`Error Report: ${result.errorCsvPath}`);
      }
      
      console.log("=" .repeat(50));
      
      // Exit with error code if there were processing errors
      process.exit(result.errorCount > 0 ? 1 : 0);
      
    } catch (error) {
      console.error("❌ Migration test failed:", error);
      process.exit(1);
    }
  });

// Help command with examples
program
  .command("help-examples")
  .description("Show usage examples")
  .action(() => {
    console.log(`
Migration CLI Usage Examples:

1. Validate environment:
   migration-cli validate

2. Show environment configuration:
   migration-cli env

3. Generate sample test data:
   migration-cli generate --output test-data --count 50

4. Setup complete test environment:
   migration-cli setup --dir my-test-env

5. Run quick validation test:
   migration-cli quick

6. Test with your CSV file:
   migration-cli test ./data/participations.csv

7. Test with custom configuration:
   migration-cli test ./data/participations.csv \\
     --mode sequential \\
     --omit-get \\
     --batch-size 50 \\
     --ccts ./data/ccts.csv

8. Performance test with large batch:
   migration-cli test ./data/large-file.csv \\
     --mode parallel \\
     --batch-size 200 \\
     --chunk-size 300

Environment Setup:
1. Create .env file with your Strapi configuration
2. Set STRAPI_BASE_URL and STRAPI_TOKEN
3. Optionally set PROCESS_MODE, OMIT_GET, BATCH_SIZE, CHUNK_SIZE

For more information, run: migration-cli <command> --help
`);
  });

// Parse command line arguments
program.parse(process.argv);

// If no command provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}