#!/usr/bin/env node

/**
 * Command Line Interface for database operations and event simulation
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
  showEnvironment,
  formatOperationError,
  formatCompletionMessage,
} from "./dev-utils";
import { ProcessingConfig, DumpOptions } from "./types";
import { DatabaseDumper } from "./database-dump";
import { DumpWorkflowValidator } from "./validate-dump-workflow";

// CLI version
const VERSION = "1.0.0";

program
  .name("migration-cli")
  .description(
    "Local development CLI for database backup operations and S3 event simulation"
  )
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
      console.log(`   - Environment Type: ${validation.environmentType}`);
      console.log("   - All required configuration is present");
      console.log("   - Ready for database and event simulation operations");
    } else {
      const errorMessage = formatOperationError(
        "validation",
        "Configuration validation failed"
      );
      console.log(errorMessage);
      console.log("\n" + validation.configurationGuidance);
    }

    if (validation.warnings.length > 0) {
      console.log("\n⚠️  WARNINGS:");
      validation.warnings.forEach((warning) => console.log(`   • ${warning}`));
    }

    if (validation.recommendations.length > 0) {
      console.log("\n💡 RECOMMENDATIONS:");
      validation.recommendations.forEach((rec) => console.log(`   • ${rec}`));
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
  .description("Generate sample CSV event files for S3 event simulation")
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
  .description("Setup complete test environment with sample CSV event files")
  .option(
    "-d, --dir <directory>",
    "Test environment directory",
    "test-environment"
  )
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
      console.log("   3. Run: migration-cli simulate <csv-file>");
    } catch (error) {
      console.error("❌ Failed to setup test environment:", error);
      process.exit(1);
    }
  });

// Quick test command
program
  .command("quick")
  .description("Run quick S3 event simulation with generated sample data")
  .action(async () => {
    console.log("🚀 Running quick validation test...");

    try {
      const report = await quickTest();

      console.log("\n📊 Quick Test Results:");
      console.log(`   - Total Records: ${report.result.totalRecords}`);
      console.log(`   - Successful: ${report.result.successCount}`);
      console.log(`   - Errors: ${report.result.errorCount}`);
      console.log(
        `   - Processing Time: ${(report.result.processingTime / 1000).toFixed(2)}s`
      );

      if (report.result.errorCount > 0) {
        console.log(`   - Error Report: ${report.result.errorCsvPath}`);
      }

      process.exit(report.result.errorCount > 0 ? 1 : 0);
    } catch (error) {
      console.error("❌ Quick test failed:", error);
      process.exit(1);
    }
  });

// Database dump command
program
  .command("dump")
  .description("Create database backup (PostgreSQL dump operation)")
  .option("-o, --output <path>", "Output directory for dump file", "./dumps")
  .option("--compress", "Compress the dump file")
  .option("--no-timestamp", "Don't include timestamp in filename")
  .action(async (options: any) => {
    console.log("🗄️  Database Backup Utility");
    console.log("=".repeat(50));

    try {
      // Validate environment first
      const validation = validateEnv();
      if (!validation.isValid) {
        console.error("❌ Environment validation failed:");
        validation.errors.forEach((error) => console.error(`   - ${error}`));
        console.error("\nRun 'migration-cli validate' for more details");
        process.exit(1);
      }

      // Check if PostgreSQL tools are available
      const pgToolsAvailable = await DatabaseDumper.checkPgToolsAvailable();
      if (!pgToolsAvailable) {
        console.error("❌ PostgreSQL client tools not found.");
        console.error(
          "Please install PostgreSQL client tools (pg_dump, pg_isready)"
        );
        console.error("On macOS: brew install postgresql");
        console.error(
          "On Ubuntu/Debian: sudo apt-get install postgresql-client"
        );
        process.exit(1);
      }

      // Validate database environment variables
      const dbValidation = DatabaseDumper.validateEnvironmentVariables();
      if (!dbValidation.isValid) {
        console.error("❌ Database configuration validation failed:");
        dbValidation.errors.forEach((error) => console.error(`   - ${error}`));
        console.error("\nRequired environment variables:");
        DatabaseDumper.getRequiredEnvironmentVariables().forEach((envVar) => {
          console.error(`   - ${envVar}`);
        });
        process.exit(1);
      }

      if (dbValidation.warnings.length > 0) {
        console.log("⚠️  Database configuration warnings:");
        dbValidation.warnings.forEach((warning) =>
          console.log(`   - ${warning}`)
        );
        console.log("");
      }

      // Create database dumper
      const dumper = new DatabaseDumper();
      const dbConfig = dumper.getConfigSummary();

      console.log("📋 Database Configuration:");
      console.log(`   - Host: ${dbConfig.host}`);
      console.log(`   - Port: ${dbConfig.port}`);
      console.log(`   - Database: ${dbConfig.database}`);
      console.log(`   - Username: ${dbConfig.username}`);
      console.log("");

      // Test database connection
      console.log("🔍 Testing database connection...");
      const connectionTest = await dumper.validateConnection();
      if (!connectionTest.success) {
        console.error(`❌ Database connection failed: ${connectionTest.error}`);
        process.exit(1);
      }
      console.log(
        `✅ Database connection successful (${connectionTest.connectionTime}ms)`
      );
      console.log("");

      // Prepare dump options
      const dumpOptions: DumpOptions = {
        outputPath: options.output,
        timestamp: options.timestamp !== false,
        compress: options.compress || false,
      };

      console.log("📋 Backup Configuration:");
      console.log(`   - Output Directory: ${dumpOptions.outputPath}`);
      console.log(`   - Include Timestamp: ${dumpOptions.timestamp}`);
      console.log(`   - Compress: ${dumpOptions.compress}`);
      console.log("");

      // Create database backup with progress feedback
      console.log("🚀 Creating database backup...");
      console.log("=".repeat(50));

      const dumpResult = await dumper.createDump(
        dumpOptions,
        (message: string) => {
          console.log(`   ${message}`);
        }
      );

      console.log("=".repeat(50));

      if (!dumpResult.success) {
        const errorMessage = formatOperationError(
          "dump",
          dumpResult.error || "Unknown error",
          {
            duration: dumpResult.duration,
            filePath: dumpOptions.outputPath,
          }
        );
        console.error(errorMessage);
        process.exit(1);
      }

      const completionMessage = formatCompletionMessage(
        dumpResult.filePath,
        dumpResult.fileSize,
        dumpResult.duration,
        "Database backup"
      );
      console.log(completionMessage);

      console.log("✅ Database backup completed!");
      console.log(`   - File: ${dumpResult.filePath}`);
      console.log(
        `   - Size: ${(dumpResult.fileSize / 1024 / 1024).toFixed(2)} MB`
      );
    } catch (error) {
      const errorMessage = formatOperationError("dump", error as Error);
      console.error(errorMessage);
      process.exit(1);
    }
  });

// Simulate command
program
  .command("simulate")
  .description(
    "Simulate S3 bucket event processing with CSV event file (replicates production Lambda behavior)"
  )
  .argument(
    "<csv-file>",
    "Path to CSV event file (REQUIRED - simulates S3 bucket event that triggers Lambda processing)"
  )
  .option(
    "-m, --mode <mode>",
    "Lambda event processing mode: parallel or sequential",
    "parallel"
  )
  .option(
    "--omit-get",
    "Skip GET requests during Lambda event simulation for performance",
    false
  )
  .option(
    "-b, --batch-size <size>",
    "Batch size for Lambda event processing",
    "100"
  )
  .option(
    "-c, --chunk-size <size>",
    "Chunk size for Lambda event processing",
    "150"
  )
  .option(
    "--ccts <file>",
    "Path to CCTs CSV file (optional performance optimization for Lambda processing)"
  )
  .option(
    "--no-auto-ccts",
    "Disable automatic CCTs performance optimization detection"
  )
  .action(async (csvFile: string, options: any) => {
    // Validate CSV file argument is provided (Commander should handle this, but double-check)
    if (!csvFile || csvFile.trim() === "") {
      console.error(
        "❌ Error: CSV event file path is required for S3 event simulation"
      );
      console.error("");
      console.error("Usage: migration-cli simulate <csv-file> [options]");
      console.error("");
      console.error(
        "The CSV file simulates an S3 bucket event that triggers Lambda processing."
      );
      console.error(
        "This file contains the event data that would be processed in production."
      );
      console.error("");
      console.error("Examples:");
      console.error("  migration-cli simulate ./data/participations.csv");
      console.error(
        "  migration-cli simulate ./test-data/sample.csv --mode sequential"
      );
      console.error("");
      console.error("For help: migration-cli simulate --help");
      process.exit(1);
    }

    console.log(
      `🚀 Running S3 event simulation with CSV event file: ${csvFile}`
    );

    // Validate CSV event file exists and is accessible
    const csvPath = resolve(csvFile);
    if (!existsSync(csvPath)) {
      console.error(`❌ Error: CSV event file not found`);
      console.error(`   File path: ${csvPath}`);
      console.error("");
      console.error(
        "The CSV event file is required to simulate S3 bucket events that trigger"
      );
      console.error("Lambda processing in production. Please ensure:");
      console.error("");
      console.error("1. The file path is correct");
      console.error("2. The file exists and is readable");
      console.error("3. The file contains valid CSV data for event simulation");
      console.error("");
      console.error("To generate sample test data:");
      console.error("  migration-cli generate --output test-data");
      console.error("");
      console.error("To setup a complete test environment:");
      console.error("  migration-cli setup");
      process.exit(1);
    }

    // Additional validation: check if file is readable
    try {
      const fs = require("node:fs");
      fs.accessSync(csvPath, fs.constants.R_OK);
    } catch (error) {
      console.error(`❌ Error: CSV event file is not accessible`);
      console.error(`   File path: ${csvPath}`);
      console.error(`   Access error: ${(error as Error).message}`);
      console.error("");
      console.error(
        "Please ensure the file has proper read permissions and is not"
      );
      console.error("currently being used by another process.");
      process.exit(1);
    }

    // Additional validation: basic CSV format check
    try {
      const fs = require("node:fs");
      const fileContent = fs.readFileSync(csvPath, "utf8");

      if (fileContent.trim().length === 0) {
        console.error(`❌ Error: CSV event file is empty`);
        console.error(`   File path: ${csvPath}`);
        console.error("");
        console.error(
          "The CSV event file must contain data to simulate S3 events."
        );
        console.error(
          "An empty file cannot be used for Lambda event simulation."
        );
        process.exit(1);
      }

      // Check if it looks like CSV (has at least one comma or is single column)
      const lines = fileContent.trim().split("\n");
      if (lines.length < 2) {
        console.error(`❌ Error: CSV event file appears to be invalid`);
        console.error(`   File path: ${csvPath}`);
        console.error(
          `   Issue: File must contain at least a header row and one data row`
        );
        console.error("");
        console.error("The CSV event file should contain:");
        console.error("1. A header row with column names");
        console.error("2. At least one data row for event simulation");
        process.exit(1);
      }
    } catch (error) {
      console.error(`❌ Error: Failed to read CSV event file`);
      console.error(`   File path: ${csvPath}`);
      console.error(`   Read error: ${(error as Error).message}`);
      console.error("");
      console.error(
        "Please ensure the file is a valid text file and not corrupted."
      );
      process.exit(1);
    }

    // Validate environment first
    const validation = validateEnv();
    if (!validation.isValid) {
      console.error("❌ Environment validation failed:");
      validation.errors.forEach((error) => console.error(`   - ${error}`));
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

      // Determine CCTs file to use
      let cctsFile = options.ccts;
      let cctsSource = "none";

      if (!cctsFile && options.autoCcts !== false) {
        // Auto-detect ccts_export.csv from project root
        const { join } = require("node:path");
        const { existsSync } = require("node:fs");
        const cctsCsvPath = join(process.cwd(), "ccts_export.csv");
        if (existsSync(cctsCsvPath)) {
          cctsFile = cctsCsvPath;
          cctsSource = "auto-detected";
          console.log(
            `🔍 Auto-detected CCTs performance optimization file: ${cctsCsvPath}`
          );
        }
      } else if (cctsFile) {
        cctsSource = "specified";
      }

      console.log("📋 Configuration:");
      console.log(`   - Processing Mode: ${config.processMode}`);
      console.log(`   - Omit GET: ${config.omitGet}`);
      console.log(`   - Batch Size: ${config.batchSize}`);
      console.log(`   - Chunk Size: ${config.chunkSize}`);

      if (cctsFile) {
        console.log(`   - CCTs Performance File (${cctsSource}): ${cctsFile}`);
        console.log(`   - CCTs Source: local file (performance optimization)`);
      } else {
        console.log(`   - CCTs Performance File: not available`);
        console.log(
          `   - CCTs Source: none (will continue without performance optimization)`
        );
      }

      // Run the simulation with enhanced error handling
      const simulationStartTime = Date.now();
      try {
        console.log("⏳ Processing Lambda S3 event simulation...");

        const result = await runLocalTest(csvPath, config, cctsFile);

        console.log("\n📊 Lambda S3 Event Simulation Results:");
        console.log("=".repeat(50));
        console.log(`Total Records: ${result.totalRecords}`);
        console.log(`Successful: ${result.successCount}`);
        console.log(`Errors: ${result.errorCount}`);
        console.log(
          `Success Rate: ${((result.successCount / result.totalRecords) * 100).toFixed(1)}%`
        );
        console.log(
          `Processing Time: ${(result.processingTime / 1000).toFixed(2)} seconds`
        );

        if (result.errorCsvPath) {
          console.log(`Error Report: ${result.errorCsvPath}`);
        }

        // Provide detailed feedback based on results
        const successRate = (result.successCount / result.totalRecords) * 100;
        const avgProcessingTime = result.processingTime / result.totalRecords;

        console.log("");
        console.log("📈 Performance Analysis:");
        console.log(
          `   - Average time per record: ${avgProcessingTime.toFixed(2)}ms`
        );
        console.log(
          `   - Records per second: ${(1000 / avgProcessingTime).toFixed(1)}`
        );

        if (successRate === 100) {
          console.log("🎉 Perfect! All records processed successfully.");
        } else if (successRate >= 95) {
          console.log("✅ Excellent! Very high success rate.");
          if (result.errorCsvPath) {
            console.log(
              "💡 Review the few errors in the error report for event data quality improvements."
            );
          }
        } else if (successRate >= 80) {
          console.log("⚠️  Good success rate, but some errors occurred.");
          console.log("💡 Recommendations:");
          console.log("   - Check error report for common patterns");
          console.log(
            "   - Validate CSV event file data format and completeness"
          );
          console.log("   - Consider data cleaning before event simulation");
        } else if (successRate >= 50) {
          console.log(
            "⚠️  Moderate success rate. Significant errors occurred."
          );
          console.log("💡 Recommendations:");
          console.log("   - Review error report for systematic issues");
          console.log("   - Check Strapi content type configurations");
          console.log("   - Validate required fields and data types");
          console.log("   - Consider processing in smaller batches");
        } else {
          console.log("❌ Low success rate. Major issues detected.");
          console.log("💡 Critical Recommendations:");
          console.log("   - Verify Strapi server is running and accessible");
          console.log(
            "   - Check STRAPI_BASE_URL and STRAPI_TOKEN configuration"
          );
          console.log(
            "   - Review CSV event file data format matches expected schema"
          );
          console.log("   - Check network connectivity and server resources");
          console.log("   - Try sequential processing mode for debugging");
        }

        console.log("=".repeat(50));

        // Exit with error code if there were processing errors
        process.exit(result.errorCount > 0 ? 1 : 0);
      } catch (simulationError) {
        const errorMessage = formatOperationError(
          "simulation",
          simulationError as Error,
          {
            filePath: csvPath,
            duration: Date.now() - simulationStartTime,
          }
        );
        console.error(`\n${errorMessage}`);
        process.exit(1);
      }
    } catch (error) {
      console.error("❌ Lambda S3 event simulation failed:", error);
      process.exit(1);
    }
  });

// Validate dump workflow command
program
  .command("validate-dump")
  .description(
    "Validate database dump workflow - check PostgreSQL tools, database connection, and existing backup files"
  )
  .action(async () => {
    console.log("🔍 Validating database dump workflow...\n");

    try {
      const validator = new DumpWorkflowValidator();
      const result = await validator.validateWorkflow();
      validator.printResults(result);

      process.exit(result.success ? 0 : 1);
    } catch (error) {
      console.error("❌ Database dump validation failed:", error);
      process.exit(1);
    }
  });

// Help command with examples
program
  .command("help-examples")
  .description("Show usage examples")
  .action(() => {
    console.log(`
Database Backup and S3 Event Simulation CLI Usage Examples:

=== ENVIRONMENT SETUP ===

1. Validate environment configuration:
   migration-cli validate

2. Show current environment configuration:
   migration-cli env

3. Generate sample CSV event files for testing:
   migration-cli generate --output test-data --count 50

4. Setup complete test environment with sample files:
   migration-cli setup --dir my-test-env

=== DATABASE BACKUP OPERATIONS ===

5. Validate database backup workflow (PostgreSQL tools, connection, existing backups):
   migration-cli validate-dump

6. Create database backup (PostgreSQL dump):
   migration-cli dump

7. Create database backup with custom output directory:
   migration-cli dump --output ./backups

8. Create compressed database backup:
   migration-cli dump --compress --output ./backups

=== S3 EVENT SIMULATION ===

9. Run quick S3 event simulation with generated sample data:
   migration-cli quick

10. Simulate S3 bucket event with your CSV event file:
    migration-cli simulate ./data/participations.csv

11. Simulate S3 event with custom Lambda processing configuration:
    migration-cli simulate ./data/participations.csv \\
      --mode sequential \\
      --omit-get \\
      --batch-size 50 \\
      --ccts ./data/ccts.csv

12. Simulate S3 event without automatic CCTs performance optimization:
    migration-cli simulate ./data/participations.csv \\
      --no-auto-ccts

13. Simulate large S3 event with optimized Lambda processing:
    migration-cli simulate ./data/large-file.csv \\
      --mode parallel \\
      --batch-size 200 \\
      --chunk-size 300

=== TYPICAL WORKFLOW ===

For local development, you typically need both database data and event simulation:

Step 1 - Get production data locally:
   migration-cli dump --output ./backups
   # Restore the dump to your local database

Step 2 - Test Lambda processing with events:
   migration-cli simulate ./test-data/sample.csv

This separates database backup operations from S3 event simulation,
reflecting the actual production architecture where:
- Database dumps provide real production data
- CSV files simulate S3 bucket events that trigger Lambda processing

=== ENVIRONMENT CONFIGURATION ===

Database Backup Operations require:
- DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_USERNAME, DATABASE_PASSWORD
- PostgreSQL client tools (pg_dump, pg_isready) installed locally
- Writable output directory with sufficient disk space

S3 Event Simulation requires:
- STRAPI_BASE_URL and STRAPI_TOKEN for Lambda processing simulation
- CSV event file (simulates S3 bucket event that triggers Lambda)
- Optional: PROCESS_MODE, OMIT_GET, BATCH_SIZE, CHUNK_SIZE for performance tuning
- Optional: ccts_export.csv in project root for automatic performance optimization

=== KEY CONCEPTS ===

Database Backup:
- Creates PostgreSQL dump files for data backup/restore
- Independent of CSV processing - focuses on database operations
- Uses database terminology: backup, restore, dump

S3 Event Simulation:
- Simulates production S3 bucket events that trigger Lambda processing
- Requires CSV event file to replicate production behavior
- Uses event terminology: simulation, Lambda processing, S3 events
- CCTs file is optional performance optimization (not core event data)

For detailed help on any command: migration-cli <command> --help

=== MIGRATION FROM OLD COMMANDS ===

If you're migrating from older versions of this CLI:

• 'test' command → Use 'simulate' command instead
• 'dump --csv-file' → Use separate 'dump' and 'simulate' commands
• 'dump --dump-only' → Just use 'dump' (dump-only is now default)

See CLI_MIGRATION_GUIDE.md for complete migration instructions.
`);
  });

// Parse command line arguments
program.parse(process.argv);

// If no command provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
