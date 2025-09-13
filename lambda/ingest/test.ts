import { runLocal } from "./index";
import * as path from "path";

async function runTest() {
  process.env.STRAPI_BASE_URL = "http://localhost:1337/api";
  process.env.STRAPI_TOKEN = "your-strapi-token";

  const csvFilePath = path.join(__dirname, "../../test-data/sample.csv");
  try {
    console.log("Processing CSV...");
    const result = await runLocal(csvFilePath);
    console.log(`Successfully processed ${result.successCount}/${result.totalRecords} rows from sample.csv`);
    if (result.errorCount > 0) {
      console.log(`Errors: ${result.errorCount}, Error report: ${result.errorCsvPath}`);
    }
  } catch (error) {
    console.error("Error during local test:", error);
  }
}

runTest();
