/**
 * Development utilities for local testing and debugging
 * Provides helper functions, sample data generation, and environment validation
 */

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  EnvironmentConfig,
  ProcessingConfig,
  LocalConfig,
  ValidationResult,
  TestReport,
  ParticipantCsvRow,
} from "./types";
import {
  loadEnvironmentConfig,
  createProcessingConfig,
  validateConfiguration,
  getRequiredEnvironmentVariables,
  getOptionalEnvironmentVariables,
} from "./config";
import { createLocalTestRunner } from "./local-test-runner";

/**
 * Development utilities class
 * Provides comprehensive development and debugging support
 */
export class DevUtils {
  private static instance: DevUtils;
  private envConfig: EnvironmentConfig;

  private constructor() {
    this.envConfig = loadEnvironmentConfig();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): DevUtils {
    if (!DevUtils.instance) {
      DevUtils.instance = new DevUtils();
    }
    return DevUtils.instance;
  }

  /**
   * Validate complete environment setup
   * @returns Detailed validation result with recommendations
   */
  validateEnvironmentSetup(): ValidationResult & { recommendations: string[] } {
    console.log("🔍 Performing comprehensive environment validation");

    const recommendations: string[] = [];
    const validation = validateConfiguration("local", this.envConfig);

    // Check for .env file
    const envFilePath = join(process.cwd(), ".env");
    if (!existsSync(envFilePath)) {
      recommendations.push(
        "Create a .env file in the project root for local development"
      );
      recommendations.push(
        "Copy .env.example to .env and fill in the required values"
      );
    }

    // Check required environment variables
    const requiredVars = getRequiredEnvironmentVariables();
    const missingRequired = requiredVars.filter(
      (varName) => !process.env[varName]
    );

    if (missingRequired.length > 0) {
      recommendations.push(
        `Set required environment variables: ${missingRequired.join(", ")}`
      );
    }

    // Check optional environment variables and suggest defaults
    const optionalVars = getOptionalEnvironmentVariables();
    const missingOptional = Object.keys(optionalVars).filter(
      (varName) => !process.env[varName]
    );

    if (missingOptional.length > 0) {
      recommendations.push(
        "Consider setting optional environment variables for better control:"
      );
      missingOptional.forEach((varName) => {
        recommendations.push(
          `  - ${varName}=${optionalVars[varName]} (default)`
        );
      });
    }

    // Check test data directory
    const testDataDir = join(process.cwd(), "test-data");
    if (!existsSync(testDataDir)) {
      recommendations.push(
        "Create a test-data directory with sample CSV files for testing"
      );
    }

    // Check for sample CSV files
    const sampleCsvPath = join(testDataDir, "sample.csv");
    if (!existsSync(sampleCsvPath)) {
      recommendations.push(
        "Create sample.csv in test-data directory for testing"
      );
    }

    return {
      ...validation,
      recommendations,
    };
  }

  /**
   * Generate sample CSV data for testing
   * @param outputPath - Path where to save the sample CSV
   * @param recordCount - Number of sample records to generate
   * @returns Path to generated CSV file
   */
  async generateSampleCsv(
    outputPath: string,
    recordCount: number = 10
  ): Promise<string> {
    console.log(`📝 Generating sample CSV with ${recordCount} records`);

    const headers = [
      "id",
      "nombre",
      "primer_apellido",
      "segundo_apellido",
      "nombre_completo",
      "email",
      "edad",
      "sexo",
      "telefono",
      "curp",
      "rfc",
      "entidad",
      "estado_civil",
      "lengua_indigena",
      "hablante_maya",
      "nivel_educativo",
      "cct",
      "programa",
      "implementacion",
      "ciclo_escolar",
      "periodo_de_implementacion",
      "puesto",
      "puesto_detalle",
      "antiguedad",
      "estudiantes_a_cargo",
      "turno",
      "participa_director_a",
      "centro_de_trabajo_verificado",
      "constancia",
      "involucramiento",
      "promedio_modulos",
      "minutos_app",
      "descarga_app",
      "mod1",
      "mod2",
      "mod3",
      "encuesta_inicial",
      "encuesta_final",
    ];

    const csvLines = [headers.join(",")];

    for (let i = 1; i <= recordCount; i++) {
      const record = this.generateSampleRecord(i);
      const values = headers.map((header) => {
        const value = record[header as keyof typeof record];
        return this.escapeCsvValue(String(value || ""));
      });
      csvLines.push(values.join(","));
    }

    const csvContent = csvLines.join("\n");
    const fullPath = resolve(outputPath);

    // Ensure directory exists
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    await writeFile(fullPath, csvContent, "utf-8");
    console.log(`✅ Sample CSV generated: ${fullPath}`);

    return fullPath;
  }

  /**
   * Generate sample CCTs CSV for testing
   * @param outputPath - Path where to save the CCTs CSV
   * @param cctCount - Number of CCT records to generate
   * @returns Path to generated CCTs CSV file
   */
  async generateSampleCctsCsv(
    outputPath: string,
    cctCount: number = 5
  ): Promise<string> {
    console.log(`📝 Generating sample CCTs CSV with ${cctCount} records`);

    const headers = ["cct", "nombre", "municipio", "entidad", "tipo"];
    const csvLines = [headers.join(",")];

    const municipios = [
      "Mérida",
      "Cancún",
      "Playa del Carmen",
      "Valladolid",
      "Campeche",
    ];
    const entidades = ["Yucatán", "Quintana Roo", "Campeche"];
    const tipos = ["Primaria", "Secundaria", "Preescolar", "Bachillerato"];

    for (let i = 1; i <= cctCount; i++) {
      const cct = `31DPR${String(i).padStart(4, "0")}X`;
      const nombre = `Centro de Trabajo ${i}`;
      const municipio = municipios[i % municipios.length];
      const entidad = entidades[i % entidades.length];
      const tipo = tipos[i % tipos.length];

      const values = [cct, nombre, municipio, entidad, tipo].map((v) =>
        this.escapeCsvValue(v)
      );
      csvLines.push(values.join(","));
    }

    const csvContent = csvLines.join("\n");
    const fullPath = resolve(outputPath);

    // Ensure directory exists
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    await writeFile(fullPath, csvContent, "utf-8");
    console.log(`✅ Sample CCTs CSV generated: ${fullPath}`);

    return fullPath;
  }

  /**
   * Create a complete test environment setup
   * @param testDir - Directory where to create test environment
   * @returns Object with paths to created files
   */
  async createTestEnvironment(testDir: string = "test-environment"): Promise<{
    testDir: string;
    sampleCsv: string;
    cctsCsv: string;
    envFile: string;
  }> {
    console.log(`🏗️  Creating test environment in: ${testDir}`);

    const fullTestDir = resolve(testDir);

    // Create test directory
    if (!existsSync(fullTestDir)) {
      await mkdir(fullTestDir, { recursive: true });
    }

    // Generate sample CSV files
    const sampleCsv = await this.generateSampleCsv(
      join(fullTestDir, "sample-participations.csv"),
      20
    );
    const cctsCsv = await this.generateSampleCctsCsv(
      join(fullTestDir, "sample-ccts.csv"),
      10
    );

    // Create .env file template
    const envFile = await this.createEnvTemplate(
      join(fullTestDir, ".env.test")
    );

    // Create README with instructions
    await this.createTestReadme(join(fullTestDir, "README.md"));

    console.log(`✅ Test environment created successfully in: ${fullTestDir}`);

    return {
      testDir: fullTestDir,
      sampleCsv,
      cctsCsv,
      envFile,
    };
  }

  /**
   * Run a quick validation test with sample data
   * @param csvPath - Optional path to CSV file (will generate if not provided)
   * @returns Test result
   */
  async runQuickTest(csvPath?: string): Promise<TestReport> {
    console.log("🚀 Running quick validation test");

    let testCsvPath = csvPath;

    // Generate sample data if no CSV provided
    if (!testCsvPath) {
      const tempDir = join(process.cwd(), "temp-test");
      if (!existsSync(tempDir)) {
        await mkdir(tempDir, { recursive: true });
      }
      testCsvPath = await this.generateSampleCsv(
        join(tempDir, "quick-test.csv"),
        5
      );
    }

    // Validate environment first
    const envValidation = this.validateEnvironmentSetup();
    if (!envValidation.isValid) {
      console.error("❌ Environment validation failed - cannot run test");
      throw new Error(
        `Environment validation failed: ${envValidation.errors.join(", ")}`
      );
    }

    // Run the test
    const runner = createLocalTestRunner();
    const result = await runner.runWithCsv(testCsvPath, {
      processMode: "sequential",
      omitGet: true, // Skip GET requests for quick test
      batchSize: 5,
      chunkSize: 10,
    });

    const report: TestReport = {
      environment: this.envConfig,
      processingConfig: createProcessingConfig(),
      result,
      errors: [],
      timestamp: new Date().toISOString(),
    };

    console.log("✅ Quick test completed");
    return report;
  }

  /**
   * Display environment configuration summary
   */
  displayEnvironmentSummary(): void {
    console.log("\n📋 Environment Configuration Summary");
    console.log("=".repeat(50));
    console.log(
      `Strapi Base URL: ${this.envConfig.strapiBaseUrl || "NOT SET"}`
    );
    console.log(
      `Strapi Token: ${this.envConfig.strapiToken ? "SET" : "NOT SET"}`
    );
    console.log(`Process Mode: ${this.envConfig.processMode}`);
    console.log(`Omit GET: ${this.envConfig.omitGet}`);
    console.log(`Batch Size: ${this.envConfig.batchSize}`);
    console.log(`Chunk Size: ${this.envConfig.chunkSize}`);
    console.log("=".repeat(50));

    // Show validation status
    const validation = this.validateEnvironmentSetup();
    if (validation.isValid) {
      console.log("✅ Environment is valid and ready for testing");
    } else {
      console.log("❌ Environment has validation issues:");
      validation.errors.forEach((error) => console.log(`   - ${error}`));
    }

    if (validation.recommendations.length > 0) {
      console.log("\n💡 Recommendations:");
      validation.recommendations.forEach((rec) => console.log(`   - ${rec}`));
    }
  }

  /**
   * Generate a single sample participant record
   * @param index - Record index for uniqueness
   * @returns Sample participant record
   */
  private generateSampleRecord(index: number): Partial<ParticipantCsvRow> {
    const nombres = [
      "Juan",
      "María",
      "Carlos",
      "Ana",
      "Luis",
      "Carmen",
      "José",
      "Elena",
    ];
    const apellidos = [
      "García",
      "López",
      "Martínez",
      "González",
      "Rodríguez",
      "Pérez",
      "Sánchez",
    ];
    const programas = ["Programa A", "Programa B", "Programa C"];
    const implementaciones = ["Implementación 2024-1", "Implementación 2024-2"];
    const sexos = ["M", "F"];
    const entidades = ["Yucatán", "Quintana Roo", "Campeche"];

    const nombre = nombres[index % nombres.length];
    const primerApellido = apellidos[index % apellidos.length];
    const segundoApellido = apellidos[(index + 1) % apellidos.length];

    return {
      id: `PART${String(index).padStart(6, "0")}`,
      nombre,
      primer_apellido: primerApellido,
      segundo_apellido: segundoApellido,
      nombre_completo: `${nombre} ${primerApellido} ${segundoApellido}`,
      email: `${nombre.toLowerCase()}.${primerApellido.toLowerCase()}${index}@example.com`,
      edad: String(25 + (index % 40)),
      sexo: sexos[index % sexos.length],
      telefono: `999${String(1000000 + index).slice(-7)}`,
      curp: `CURP${String(index).padStart(12, "0")}`,
      rfc: `RFC${String(index).padStart(9, "0")}`,
      entidad: entidades[index % entidades.length],
      estado_civil: index % 3 === 0 ? "Soltero" : "Casado",
      lengua_indigena: index % 4 === 0 ? "true" : "false",
      hablante_maya: index % 5 === 0 ? "true" : "false",
      nivel_educativo: index % 3 === 0 ? "Licenciatura" : "Bachillerato",
      cct: `31DPR${String((index % 5) + 1).padStart(4, "0")}X`,
      programa: programas[index % programas.length],
      implementacion: implementaciones[index % implementaciones.length],
      ciclo_escolar: "2024-2025",
      periodo_de_implementacion: "Enero-Junio 2024",
      puesto: index % 2 === 0 ? "Docente" : "Director",
      puesto_detalle: "Tiempo completo",
      antiguedad: String(1 + (index % 20)),
      estudiantes_a_cargo: String(20 + (index % 30)),
      turno: index % 2 === 0 ? "Matutino" : "Vespertino",
      participa_director_a: index % 3 === 0 ? "true" : "false",
      centro_de_trabajo_verificado: "true",
      constancia: index % 4 !== 0 ? "true" : "false",
      involucramiento: "Alto",
      promedio_modulos: String(7 + (index % 3)),
      minutos_app: String(60 + (index % 120)),
      descarga_app: index % 3 !== 0 ? "true" : "false",
      mod1: String(7 + (index % 3)),
      mod2: String(8 + (index % 2)),
      mod3: String(6 + (index % 4)),
      encuesta_inicial: "Completada",
      encuesta_final: index % 2 === 0 ? "Completada" : "NA",
    };
  }

  /**
   * Escape CSV values properly
   * @param value - Value to escape
   * @returns Escaped CSV value
   */
  private escapeCsvValue(value: string): string {
    if (!value) return "";

    if (value.includes(",") || value.includes('"') || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`;
    }

    return value;
  }

  /**
   * Create .env template file
   * @param filePath - Path where to create the .env file
   * @returns Path to created file
   */
  private async createEnvTemplate(filePath: string): Promise<string> {
    const envTemplate = `# Migration Lambda Environment Configuration
# Copy this file to .env and fill in your actual values

# Required: Strapi API Configuration
STRAPI_BASE_URL=http://localhost:1337/api
STRAPI_TOKEN=your_strapi_token_here

# Optional: Processing Configuration
PROCESS_MODE=parallel
OMIT_GET=false
BATCH_SIZE=100
CHUNK_SIZE=150

# Development: Set to true for verbose logging
DEBUG=false
`;

    await writeFile(filePath, envTemplate, "utf-8");
    return filePath;
  }

  /**
   * Create test environment README
   * @param filePath - Path where to create the README
   * @returns Path to created file
   */
  private async createTestReadme(filePath: string): Promise<string> {
    const readmeContent = `# Migration Lambda Test Environment

This directory contains sample data and configuration for testing the migration lambda locally.

## Files

- \`sample-participations.csv\` - Sample participant data for testing
- \`sample-ccts.csv\` - Sample CCT (Centro de Trabajo) data
- \`.env.test\` - Environment configuration template
- \`README.md\` - This file

## Usage

1. Copy \`.env.test\` to \`.env\` in your project root
2. Fill in the required values in \`.env\` (especially STRAPI_BASE_URL and STRAPI_TOKEN)
3. Run a test using the sample data:

\`\`\`bash
# Using the local test runner
node -e "
const { runLocalTest } = require('./lambda/ingest/local-test-runner');
runLocalTest('./test-environment/sample-participations.csv')
  .then(result => console.log('Test completed:', result))
  .catch(err => console.error('Test failed:', err));
"
\`\`\`

## Environment Variables

### Required
- \`STRAPI_BASE_URL\` - Base URL for your Strapi API
- \`STRAPI_TOKEN\` - Authentication token for Strapi API

### Optional
- \`PROCESS_MODE\` - Processing mode: "parallel" or "sequential" (default: "parallel")
- \`OMIT_GET\` - Skip GET requests for performance: "true" or "false" (default: "false")
- \`BATCH_SIZE\` - Number of records to process in each batch (default: 100)
- \`CHUNK_SIZE\` - Chunk size for S3 processing (default: 150)

## Sample Data

The sample CSV files contain realistic test data that follows the expected format:
- 20 participant records with varied data
- 10 CCT records for testing CCT lookup functionality
- All required fields populated with valid sample values

## Testing Tips

1. Start with small batch sizes for initial testing
2. Use \`OMIT_GET=true\` for faster testing (skips existence checks)
3. Use \`PROCESS_MODE=sequential\` for easier debugging
4. Check the generated error reports for any issues

## Troubleshooting

If tests fail, check:
1. Environment variables are set correctly
2. Strapi API is running and accessible
3. Authentication token is valid
4. Network connectivity to Strapi instance
`;

    await writeFile(filePath, readmeContent, "utf-8");
    return filePath;
  }
}

/**
 * Convenience functions for common development tasks
 */

/**
 * Get development utilities instance
 * @returns DevUtils singleton instance
 */
export function getDevUtils(): DevUtils {
  return DevUtils.getInstance();
}

/**
 * Quick environment validation
 * @returns Validation result with recommendations
 */
export function validateEnv(): ValidationResult & {
  recommendations: string[];
} {
  return getDevUtils().validateEnvironmentSetup();
}

/**
 * Generate sample test data
 * @param outputDir - Directory where to create test files
 * @param recordCount - Number of records to generate
 * @returns Object with paths to generated files
 */
export async function generateTestData(
  outputDir: string = "test-data",
  recordCount: number = 20
): Promise<{
  participationsCsv: string;
  cctsCsv: string;
}> {
  const utils = getDevUtils();

  const participationsCsv = await utils.generateSampleCsv(
    join(outputDir, "sample-participations.csv"),
    recordCount
  );

  const cctsCsv = await utils.generateSampleCctsCsv(
    join(outputDir, "sample-ccts.csv"),
    Math.ceil(recordCount / 4)
  );

  return { participationsCsv, cctsCsv };
}

/**
 * Setup complete test environment
 * @param testDir - Directory for test environment
 * @returns Object with paths to created files
 */
export async function setupTestEnvironment(
  testDir: string = "test-environment"
): Promise<{
  testDir: string;
  sampleCsv: string;
  cctsCsv: string;
  envFile: string;
}> {
  return getDevUtils().createTestEnvironment(testDir);
}

/**
 * Run quick validation test
 * @param csvPath - Optional path to CSV file
 * @returns Test report
 */
export async function quickTest(csvPath?: string): Promise<TestReport> {
  return getDevUtils().runQuickTest(csvPath);
}

/**
 * Display environment summary
 */
export function showEnvironment(): void {
  getDevUtils().displayEnvironmentSummary();
}
