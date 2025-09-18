#!/usr/bin/env node

/**
 * Command Line Interface for local migration testing
 * Provides easy access to development utilities and test runner
 */

import { Command } from "commander";
const program = new Command();
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import inquirer from "inquirer";
import { runLocalTest } from "./local-test-runner";
import {
  validateEnv,
  generateTestData,
  setupTestEnvironment,
  quickTest,
  showEnvironment,
  formatOperationError,
  formatProgressMessage,
  formatCompletionMessage,
} from "./dev-utils";
import { ProcessingConfig, DumpOptions } from "./types";
import { DatabaseDumper } from "./database-dump";

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
      console.log(`   - Environment Type: ${validation.environmentType}`);
      console.log("   - All required configuration is present");
      console.log("   - Ready for migration operations");
    } else {
      const errorMessage = formatOperationError('validation', 'Configuration validation failed');
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
  .option(
    "-d, --dir <directory>",
    "Test environment directory",
    "test-environment",
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
      console.log(
        `   - Processing Time: ${(report.result.processingTime / 1000).toFixed(2)}s`,
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
  .description("Create database dump with optional migration run")
  .option("-o, --output <path>", "Output directory for dump file", "./dumps")
  .option("--dump-only", "Only create dump, don't run migration")
  .option("--compress", "Compress the dump file")
  .option("--no-timestamp", "Don't include timestamp in filename")
  .option("--csv-file <file>", "CSV file to process (for dump-and-run)")
  .option("--ccts <file>", "Path to CCTs CSV file (for dump-and-run)")
  .option("-m, --mode <mode>", "Processing mode: parallel or sequential", "parallel")
  .option("--omit-get", "Skip GET requests for performance", false)
  .option("-b, --batch-size <size>", "Batch size for processing", "100")
  .option("-c, --chunk-size <size>", "Chunk size for S3 processing", "150")
  .action(async (options: any) => {
    console.log("🗄️  Database Dump Utility");
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
        console.error("Please install PostgreSQL client tools (pg_dump, pg_isready)");
        console.error("On macOS: brew install postgresql");
        console.error("On Ubuntu/Debian: sudo apt-get install postgresql-client");
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
        dbValidation.warnings.forEach((warning) => console.log(`   - ${warning}`));
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
      console.log(`✅ Database connection successful (${connectionTest.connectionTime}ms)`);
      console.log("");

      let dumpAndRun = false;
      let csvFile = options.csvFile;

      // Interactive prompts if not in dump-only mode and no CSV file specified
      if (!options.dumpOnly && !csvFile) {
        const answers = await inquirer.prompt([
          {
            type: 'list',
            name: 'action',
            message: 'What would you like to do?',
            choices: [
              { name: 'Create database dump and run migration', value: 'dump-and-run' },
              { name: 'Create database dump only', value: 'dump-only' }
            ]
          }
        ]);

        dumpAndRun = answers.action === 'dump-and-run';

        if (dumpAndRun) {
          const csvAnswer = await inquirer.prompt([
            {
              type: 'input',
              name: 'csvFile',
              message: 'Enter path to CSV file for migration:',
              validate: (input: string) => {
                if (!input.trim()) {
                  return 'CSV file path is required for dump-and-run';
                }
                const csvPath = resolve(input.trim());
                if (!existsSync(csvPath)) {
                  return `CSV file not found: ${csvPath}`;
                }
                return true;
              }
            }
          ]);
          csvFile = csvAnswer.csvFile;
        }
      } else if (!options.dumpOnly && csvFile) {
        dumpAndRun = true;
      }

      // Prepare dump options
      const dumpOptions: DumpOptions = {
        outputPath: options.output,
        timestamp: options.timestamp !== false,
        compress: options.compress || false,
        dumpOnly: !dumpAndRun
      };

      console.log("📋 Dump Configuration:");
      console.log(`   - Output Directory: ${dumpOptions.outputPath}`);
      console.log(`   - Include Timestamp: ${dumpOptions.timestamp}`);
      console.log(`   - Compress: ${dumpOptions.compress}`);
      console.log(`   - Action: ${dumpAndRun ? 'Dump and Run Migration' : 'Dump Only'}`);
      if (dumpAndRun && csvFile) {
        console.log(`   - CSV File: ${csvFile}`);
      }
      console.log("");

      // Create database dump with progress feedback
      console.log("🚀 Creating database dump...");
      console.log("=".repeat(50));
      
      const dumpResult = await dumper.createDump(dumpOptions, (message: string) => {
        console.log(`   ${message}`);
      });

      console.log("=".repeat(50));

      if (!dumpResult.success) {
        const errorMessage = formatOperationError('dump', dumpResult.error || 'Unknown error', {
          duration: dumpResult.duration,
          filePath: dumpOptions.outputPath
        });
        console.error(errorMessage);
        process.exit(1);
      }

      const completionMessage = formatCompletionMessage(
        dumpResult.filePath,
        dumpResult.fileSize,
        dumpResult.duration,
        "Database dump"
      );
      console.log(completionMessage);

      // Run migration if requested
      if (dumpAndRun && csvFile) {
        console.log("🚀 Running migration pipeline...");
        console.log("=".repeat(50));

        // Validate CSV file exists
        const csvPath = resolve(csvFile);
        if (!existsSync(csvPath)) {
          console.error(`❌ CSV file not found: ${csvPath}`);
          process.exit(1);
        }

        // Build processing configuration
        const config: ProcessingConfig = {
          processMode: options.mode === "sequential" ? "sequential" : "parallel",
          omitGet: options.omitGet,
          batchSize: parseInt(options.batchSize),
          chunkSize: parseInt(options.chunkSize),
        };

        console.log("📋 Migration Configuration:");
        console.log(`   - Processing Mode: ${config.processMode}`);
        console.log(`   - Omit GET: ${config.omitGet}`);
        console.log(`   - Batch Size: ${config.batchSize}`);
        console.log(`   - Chunk Size: ${config.chunkSize}`);

        // Determine CCTs file to use for dump-and-run
        let cctsFileForDump = options.ccts;
        let cctsSourceForDump = "none";

        if (!cctsFileForDump) {
          // Auto-detect ccts_export.csv from project root
          const { join } = require('node:path');
          const { existsSync } = require('node:fs');
          const cctsCsvPath = join(process.cwd(), 'ccts_export.csv');
          if (existsSync(cctsCsvPath)) {
            cctsFileForDump = cctsCsvPath;
            cctsSourceForDump = "auto-detected";
          }
        } else {
          cctsSourceForDump = "specified";
        }

        if (cctsFileForDump) {
          console.log(`   - CCTs File (${cctsSourceForDump}): ${cctsFileForDump}`);
          console.log(`   - CCTs Source: local file`);
        } else {
          console.log(`   - CCTs File: not available`);
          console.log(`   - CCTs Source: none (will continue without CCTs data)`);
        }
        console.log("");

        // Run the migration with enhanced error handling
        const migrationStartTime = Date.now();
        try {
          console.log("⏳ Migration in progress...");
          
          const migrationResult = await runLocalTest(csvPath, config, cctsFileForDump);
          const migrationDuration = Date.now() - migrationStartTime;

          console.log("📊 Migration Results:");
          console.log("=".repeat(50));
          console.log(`Total Records: ${migrationResult.totalRecords}`);
          console.log(`Successful: ${migrationResult.successCount}`);
          console.log(`Errors: ${migrationResult.errorCount}`);
          console.log(
            `Success Rate: ${((migrationResult.successCount / migrationResult.totalRecords) * 100).toFixed(1)}%`,
          );
          console.log(
            `Processing Time: ${(migrationResult.processingTime / 1000).toFixed(2)} seconds`,
          );

          if (migrationResult.errorCsvPath) {
            console.log(`Error Report: ${migrationResult.errorCsvPath}`);
          }

          // Provide feedback based on success rate
          const successRate = (migrationResult.successCount / migrationResult.totalRecords) * 100;
          if (successRate === 100) {
            console.log("🎉 Perfect! All records processed successfully.");
          } else if (successRate >= 95) {
            console.log("✅ Excellent! Very high success rate.");
          } else if (successRate >= 80) {
            console.log("⚠️  Good success rate, but some errors occurred.");
            console.log("💡 Check the error report for details on failed records.");
          } else if (successRate >= 50) {
            console.log("⚠️  Moderate success rate. Significant errors occurred.");
            console.log("💡 Review error report and check data quality or Strapi configuration.");
          } else {
            console.log("❌ Low success rate. Major issues detected.");
            console.log("💡 Recommendations:");
            console.log("   - Verify Strapi server is running and accessible");
            console.log("   - Check STRAPI_BASE_URL and STRAPI_TOKEN configuration");
            console.log("   - Review CSV data format and quality");
            console.log("   - Check network connectivity");
          }

          console.log("=".repeat(50));
          console.log("");
          console.log("✅ Dump and migration completed!");
          console.log(`   - Database Dump: ${dumpResult.filePath} (${(dumpResult.fileSize / 1024 / 1024).toFixed(2)} MB)`);
          console.log(`   - Migration Success Rate: ${successRate.toFixed(1)}%`);
          console.log(`   - Total Duration: ${((Date.now() - migrationStartTime + dumpResult.duration) / 1000).toFixed(2)} seconds`);

          // Exit with error code if there were processing errors
          process.exit(migrationResult.errorCount > 0 ? 1 : 0);
          
        } catch (migrationError) {
          const errorMessage = formatOperationError('migration', migrationError as Error, {
            filePath: csvPath,
            duration: Date.now() - migrationStartTime
          });
          console.error(errorMessage);
          console.error("");
          console.error("✅ Database dump was successful:");
          console.error(`   - File: ${dumpResult.filePath}`);
          console.error(`   - Size: ${(dumpResult.fileSize / 1024 / 1024).toFixed(2)} MB`);
          process.exit(1);
        }
      } else {
        console.log("✅ Database dump completed!");
        console.log(`   - File: ${dumpResult.filePath}`);
        console.log(`   - Size: ${(dumpResult.fileSize / 1024 / 1024).toFixed(2)} MB`);
      }

    } catch (error) {
      const errorMessage = formatOperationError('dump', error as Error);
      console.error(errorMessage);
      process.exit(1);
    }
  });

// Test command
program
  .command("test")
  .description("Run migration test with CSV file")
  .argument("<csv-file>", "Path to CSV file to process")
  .option(
    "-m, --mode <mode>",
    "Processing mode: parallel or sequential",
    "parallel",
  )
  .option("--omit-get", "Skip GET requests for performance", false)
  .option("-b, --batch-size <size>", "Batch size for processing", "100")
  .option("-c, --chunk-size <size>", "Chunk size for S3 processing", "150")
  .option("--ccts <file>", "Path to CCTs CSV file")
  .option("--no-auto-ccts", "Disable automatic ccts_export.csv detection")
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
        const { join } = require('node:path');
        const { existsSync } = require('node:fs');
        const cctsCsvPath = join(process.cwd(), 'ccts_export.csv');
        if (existsSync(cctsCsvPath)) {
          cctsFile = cctsCsvPath;
          cctsSource = "auto-detected";
          console.log(`🔍 Auto-detected CCTs file: ${cctsCsvPath}`);
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
        console.log(`   - CCTs File (${cctsSource}): ${cctsFile}`);
        console.log(`   - CCTs Source: local file`);
      } else {
        console.log(`   - CCTs File: not available`);
        console.log(`   - CCTs Source: none (will continue without CCTs data)`);
      }

      // Run the test with enhanced error handling
      const testStartTime = Date.now();
      try {
        console.log("⏳ Processing migration test...");
        
        const result = await runLocalTest(csvPath, config, cctsFile);

        console.log("\n📊 Migration Test Results:");
        console.log("=".repeat(50));
        console.log(`Total Records: ${result.totalRecords}`);
        console.log(`Successful: ${result.successCount}`);
        console.log(`Errors: ${result.errorCount}`);
        console.log(
          `Success Rate: ${((result.successCount / result.totalRecords) * 100).toFixed(1)}%`,
        );
        console.log(
          `Processing Time: ${(result.processingTime / 1000).toFixed(2)} seconds`,
        );

        if (result.errorCsvPath) {
          console.log(`Error Report: ${result.errorCsvPath}`);
        }

        // Provide detailed feedback based on results
        const successRate = (result.successCount / result.totalRecords) * 100;
        const avgProcessingTime = result.processingTime / result.totalRecords;
        
        console.log("");
        console.log("📈 Performance Analysis:");
        console.log(`   - Average time per record: ${avgProcessingTime.toFixed(2)}ms`);
        console.log(`   - Records per second: ${(1000 / avgProcessingTime).toFixed(1)}`);
        
        if (successRate === 100) {
          console.log("🎉 Perfect! All records processed successfully.");
        } else if (successRate >= 95) {
          console.log("✅ Excellent! Very high success rate.");
          if (result.errorCsvPath) {
            console.log("💡 Review the few errors in the error report for data quality improvements.");
          }
        } else if (successRate >= 80) {
          console.log("⚠️  Good success rate, but some errors occurred.");
          console.log("💡 Recommendations:");
          console.log("   - Check error report for common patterns");
          console.log("   - Validate CSV data format and completeness");
          console.log("   - Consider data cleaning before migration");
        } else if (successRate >= 50) {
          console.log("⚠️  Moderate success rate. Significant errors occurred.");
          console.log("💡 Recommendations:");
          console.log("   - Review error report for systematic issues");
          console.log("   - Check Strapi content type configurations");
          console.log("   - Validate required fields and data types");
          console.log("   - Consider processing in smaller batches");
        } else {
          console.log("❌ Low success rate. Major issues detected.");
          console.log("💡 Critical Recommendations:");
          console.log("   - Verify Strapi server is running and accessible");
          console.log("   - Check STRAPI_BASE_URL and STRAPI_TOKEN configuration");
          console.log("   - Review CSV data format matches expected schema");
          console.log("   - Check network connectivity and server resources");
          console.log("   - Try sequential processing mode for debugging");
        }

        console.log("=".repeat(50));

        // Exit with error code if there were processing errors
        process.exit(result.errorCount > 0 ? 1 : 0);
        
      } catch (testError) {
        const errorMessage = formatOperationError('migration', testError as Error, {
          filePath: csvPath,
          duration: Date.now() - testStartTime
        });
        console.error(`\n${errorMessage}`);
        process.exit(1);
      }
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

6. Create database dump (interactive):
   migration-cli dump

7. Create database dump only:
   migration-cli dump --dump-only --output ./backups

8. Create compressed database dump:
   migration-cli dump --dump-only --compress --output ./backups

9. Dump database and run migration:
   migration-cli dump --csv-file ./data/participations.csv

10. Dump with custom migration settings:
    migration-cli dump \\
      --csv-file ./data/participations.csv \\
      --mode sequential \\
      --batch-size 50 \\
      --ccts ./data/ccts.csv \\
      --compress

11. Dump with auto-detected CCTs:
    migration-cli dump --csv-file ./data/participations.csv
    # Automatically uses ccts_export.csv from project root if available

12. Test with your CSV file (auto-detects ccts_export.csv):
    migration-cli test ./data/participations.csv

13. Test with custom configuration:
    migration-cli test ./data/participations.csv \\
      --mode sequential \\
      --omit-get \\
      --batch-size 50 \\
      --ccts ./data/ccts.csv

14. Test without automatic CCTs detection:
    migration-cli test ./data/participations.csv \\
      --no-auto-ccts

15. Performance test with large batch:
    migration-cli test ./data/large-file.csv \\
      --mode parallel \\
      --batch-size 200 \\
      --chunk-size 300

Environment Setup:
1. Create .env file with your Strapi and database configuration
2. Set STRAPI_BASE_URL and STRAPI_TOKEN for migration operations
3. Set DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_USERNAME, DATABASE_PASSWORD for dump operations
4. Optionally set PROCESS_MODE, OMIT_GET, BATCH_SIZE, CHUNK_SIZE for performance tuning
5. Place ccts_export.csv in project root for automatic CCTs detection

Database Dump Requirements:
- PostgreSQL client tools (pg_dump, pg_isready) must be installed
- Database connection parameters must be configured in environment
- Output directory must be writable
- Sufficient disk space for dump files

CCTs File Auto-Detection:
- The CLI automatically detects ccts_export.csv in the project root
- Use --ccts <file> to specify a different CCTs file
- Use --no-auto-ccts to disable automatic detection
- CCTs data is optional and migration will continue without it

For more information, run: migration-cli <command> --help
`);
  });

// Parse command line arguments
program.parse(process.argv);

// If no command provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
