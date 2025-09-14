/**
 * Example script demonstrating local testing framework usage
 * Shows various ways to test the migration lambda locally
 */

import { join } from "node:path";
import {
  runLocalTest,
  createLocalTestRunner,
} from "__tests__/unit/local-test-runner";
import {
  validateEnv,
  generateTestData,
  setupTestEnvironment,
  quickTest,
  showEnvironment,
} from "../dev-utils";
import { ProcessingConfig } from "../types";

/**
 * Example 1: Basic environment validation
 */
async function example1_validateEnvironment() {
  console.log("=".repeat(60));
  console.log("Example 1: Environment Validation");
  console.log("=".repeat(60));

  // Show current environment configuration
  showEnvironment();

  // Validate environment setup
  const validation = validateEnv();

  if (validation.isValid) {
    console.log("✅ Environment is ready for testing!");
  } else {
    console.log("❌ Environment needs configuration:");
    validation.errors.forEach((error) => console.log(`   - ${error}`));

    if (validation.recommendations.length > 0) {
      console.log("\n💡 Recommendations:");
      validation.recommendations.forEach((rec) => console.log(`   - ${rec}`));
    }
  }

  return validation.isValid;
}

/**
 * Example 2: Generate test data and setup environment
 */
async function example2_setupTestData() {
  console.log("\n" + "=".repeat(60));
  console.log("Example 2: Test Data Generation");
  console.log("=".repeat(60));

  try {
    // Generate sample test data
    console.log("📝 Generating sample test data...");
    const testData = await generateTestData("examples/test-data", 15);

    console.log("✅ Test data generated:");
    console.log(`   - Participations: ${testData.participationsCsv}`);
    console.log(`   - CCTs: ${testData.cctsCsv}`);

    // Setup complete test environment
    console.log("\n🏗️  Setting up complete test environment...");
    const testEnv = await setupTestEnvironment("examples/test-environment");

    console.log("✅ Test environment created:");
    console.log(`   - Directory: ${testEnv.testDir}`);
    console.log(`   - Sample CSV: ${testEnv.sampleCsv}`);
    console.log(`   - CCTs CSV: ${testEnv.cctsCsv}`);
    console.log(`   - Environment template: ${testEnv.envFile}`);

    return testData;
  } catch (error) {
    console.error("❌ Failed to setup test data:", error);
    throw error;
  }
}

/**
 * Example 3: Quick validation test
 */
async function example3_quickTest() {
  console.log("\n" + "=".repeat(60));
  console.log("Example 3: Quick Validation Test");
  console.log("=".repeat(60));

  try {
    console.log("🚀 Running quick validation test...");
    const report = await quickTest();

    console.log("📊 Quick Test Results:");
    console.log(
      `   - Environment: ${report.environment.strapiBaseUrl ? "Configured" : "Not configured"}`,
    );
    console.log(`   - Processing Mode: ${report.processingConfig.processMode}`);
    console.log(`   - Total Records: ${report.result.totalRecords}`);
    console.log(`   - Successful: ${report.result.successCount}`);
    console.log(`   - Errors: ${report.result.errorCount}`);
    console.log(
      `   - Processing Time: ${(report.result.processingTime / 1000).toFixed(2)}s`,
    );
    console.log(`   - Timestamp: ${report.timestamp}`);

    return report;
  } catch (error) {
    console.error("❌ Quick test failed:", error);
    throw error;
  }
}

/**
 * Example 4: Custom configuration test
 */
async function example4_customConfigTest(csvPath: string) {
  console.log("\n" + "=".repeat(60));
  console.log("Example 4: Custom Configuration Test");
  console.log("=".repeat(60));

  try {
    // Test with sequential processing and small batches
    const sequentialConfig: ProcessingConfig = {
      processMode: "sequential",
      omitGet: true, // Skip GET requests for faster testing
      batchSize: 5,
      chunkSize: 10,
    };

    console.log("🔄 Testing with sequential processing...");
    const sequentialResult = await runLocalTest(csvPath, sequentialConfig);

    console.log("📊 Sequential Test Results:");
    console.log(`   - Records: ${sequentialResult.totalRecords}`);
    console.log(`   - Success: ${sequentialResult.successCount}`);
    console.log(`   - Errors: ${sequentialResult.errorCount}`);
    console.log(
      `   - Time: ${(sequentialResult.processingTime / 1000).toFixed(2)}s`,
    );

    // Test with parallel processing
    const parallelConfig: ProcessingConfig = {
      processMode: "parallel",
      omitGet: true,
      batchSize: 10,
      chunkSize: 20,
    };

    console.log("\n🚀 Testing with parallel processing...");
    const parallelResult = await runLocalTest(csvPath, parallelConfig);

    console.log("📊 Parallel Test Results:");
    console.log(`   - Records: ${parallelResult.totalRecords}`);
    console.log(`   - Success: ${parallelResult.successCount}`);
    console.log(`   - Errors: ${parallelResult.errorCount}`);
    console.log(
      `   - Time: ${(parallelResult.processingTime / 1000).toFixed(2)}s`,
    );

    // Compare performance
    const speedup =
      sequentialResult.processingTime / parallelResult.processingTime;
    console.log(`\n⚡ Performance Comparison:`);
    console.log(
      `   - Sequential: ${(sequentialResult.processingTime / 1000).toFixed(2)}s`,
    );
    console.log(
      `   - Parallel: ${(parallelResult.processingTime / 1000).toFixed(2)}s`,
    );
    console.log(`   - Speedup: ${speedup.toFixed(2)}x`);

    return { sequentialResult, parallelResult };
  } catch (error) {
    console.error("❌ Custom configuration test failed:", error);
    throw error;
  }
}

/**
 * Example 5: Advanced test runner usage
 */
async function example5_advancedTestRunner(csvPath: string) {
  console.log("\n" + "=".repeat(60));
  console.log("Example 5: Advanced Test Runner Usage");
  console.log("=".repeat(60));

  try {
    // Create a test runner instance for more control
    const runner = createLocalTestRunner();

    // Validate environment first
    console.log("🔍 Validating environment...");
    const isValid = runner.validateEnvironment();

    if (!isValid) {
      console.log("❌ Environment validation failed - cannot proceed");
      return;
    }

    // Run test with custom configuration
    const config: ProcessingConfig = {
      processMode: "parallel",
      omitGet: false, // Include GET requests for complete testing
      batchSize: 8,
      chunkSize: 15,
    };

    console.log("🚀 Running comprehensive test...");
    const result = await runner.runWithCsv(csvPath, config);

    // Generate detailed test report
    const report = runner.generateTestReport();

    console.log("📊 Comprehensive Test Results:");
    console.log(`   - Total Records: ${result.totalRecords}`);
    console.log(`   - Successful: ${result.successCount}`);
    console.log(`   - Errors: ${result.errorCount}`);
    console.log(
      `   - Success Rate: ${((result.successCount / result.totalRecords) * 100).toFixed(1)}%`,
    );
    console.log(
      `   - Processing Time: ${(result.processingTime / 1000).toFixed(2)}s`,
    );
    console.log(
      `   - Average per Record: ${(result.processingTime / result.totalRecords).toFixed(0)}ms`,
    );

    if (result.errorCsvPath) {
      console.log(`   - Error Report: ${result.errorCsvPath}`);
    }

    return { result, report };
  } catch (error) {
    console.error("❌ Advanced test runner failed:", error);
    throw error;
  }
}

/**
 * Main example runner
 */
async function runExamples() {
  console.log("🚀 Migration Lambda Local Testing Examples");
  console.log(
    "This script demonstrates various ways to test the migration lambda locally.\n",
  );

  try {
    // Example 1: Validate environment
    const isEnvValid = await example1_validateEnvironment();

    if (!isEnvValid) {
      console.log(
        "\n⚠️  Environment validation failed. Please configure your environment before running tests.",
      );
      console.log("Create a .env file with STRAPI_BASE_URL and STRAPI_TOKEN");
      return;
    }

    // Example 2: Setup test data
    const testData = await example2_setupTestData();

    // Example 3: Quick test
    await example3_quickTest();

    // Example 4: Custom configuration tests
    await example4_customConfigTest(testData.participationsCsv);

    // Example 5: Advanced test runner
    await example5_advancedTestRunner(testData.participationsCsv);

    console.log("\n" + "=".repeat(60));
    console.log("✅ All examples completed successfully!");
    console.log("=".repeat(60));

    console.log("\n💡 Next Steps:");
    console.log("   1. Use the generated test data for your own testing");
    console.log("   2. Modify the examples to test with your actual CSV files");
    console.log("   3. Use the CLI tool: npm run cli -- test <your-csv-file>");
    console.log(
      "   4. Integrate the test runner into your development workflow",
    );
  } catch (error) {
    console.error("\n❌ Examples failed:", error);
    process.exit(1);
  }
}

// Run examples if this file is executed directly
if (require.main === module) {
  runExamples().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

// Export functions for use in other scripts
export {
  example1_validateEnvironment,
  example2_setupTestData,
  example3_quickTest,
  example4_customConfigTest,
  example5_advancedTestRunner,
  runExamples,
};
