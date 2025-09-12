import { processCsv } from "./index";
import * as fs from "fs";
import * as path from "path";

async function runTest() {
  // Set mock environment variables
  process.env.STRAPI_BASE_URL = "http://localhost:1337"; // Replace with your Strapi URL
  process.env.STRAPI_TOKEN = "your-strapi-token"; // Replace with your Strapi token

  const csvFilePath = path.join(__dirname, "../../test-data/sample.csv");
  try {
    const csvContent = fs.readFileSync(csvFilePath, "utf-8");
    console.log("Processing CSV...");
    const processedRows = await processCsv(csvContent);
    console.log(`Successfully processed ${processedRows} rows from sample.csv`);
  } catch (error) {
    console.error("Error during local test:", error);
  }
}

runTest();
