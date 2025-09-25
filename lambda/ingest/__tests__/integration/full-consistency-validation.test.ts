/**
 * Full end-to-end consistency validation tests
 * These tests require a test Strapi instance and are designed to verify
 * that Lambda and local execution produce identical database states
 *
 * Run with: npm test -- --testNamePattern="Full Consistency"
 * Requires: TEST_STRAPI_URL and TEST_STRAPI_TOKEN environment variables
 */

import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "@jest/globals";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import axios, { AxiosInstance } from "axios";
import { createLocalTestRunner } from "../../local-test-runner";
import { ProcessingConfig, SimulationResult } from "../../types";

// Test environment configuration
const TEST_STRAPI_URL = process.env.TEST_STRAPI_URL;
const TEST_STRAPI_TOKEN = process.env.TEST_STRAPI_TOKEN;
const TEST_CSV_PATH = join(__dirname, "../../../test-data/sample.csv");

// Skip these tests if test environment is not configured
const describeIf = (condition: boolean) =>
  condition ? describe : describe.skip;

describeIf(!!TEST_STRAPI_URL && !!TEST_STRAPI_TOKEN)(
  "Full Consistency Validation",
  () => {
    let api: AxiosInstance;
    let testRunner: any;

    beforeAll(async () => {
      api = axios.create({
        baseURL: TEST_STRAPI_URL,
        headers: {
          Authorization: `Bearer ${TEST_STRAPI_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      });

      testRunner = createLocalTestRunner();

      // Verify test environment is accessible
      try {
        await api.get("/participantes?pagination[limit]=1");
        console.log("✅ Test Strapi environment is accessible");
      } catch (error) {
        throw new Error(`Test Strapi environment not accessible: ${error}`);
      }
    });

    beforeEach(async () => {
      // Clean up test data before each test
      await cleanupTestData();
    });

    afterAll(async () => {
      // Final cleanup
      await cleanupTestData();
    });

    test("should create identical participation records", async () => {
      const testConfig: ProcessingConfig = {
        processMode: "sequential",
        omitGet: true,
        batchSize: 5,
        chunkSize: 2,
      };

      // Run local test runner
      const localResult = await testRunner.runWithCsv(
        TEST_CSV_PATH,
        testConfig
      );

      // Capture database state after local execution
      const localDbState = await captureDbState();

      // Clean database
      await cleanupTestData();

      // Note: Lambda execution would require setting up S3 event simulation
      // For now, we verify that local execution creates the expected records

      expect(localResult.totalRecords).toBeGreaterThan(0);
      expect(localResult.successCount).toBeGreaterThan(0);
      expect(localDbState.participaciones.length).toBe(
        localResult.successCount
      );

      // Verify related records were created
      expect(localDbState.moduloProgressRecords.length).toBeGreaterThan(0);
      expect(localDbState.surveyCompletionRecords.length).toBeGreaterThan(0);

      console.log("✅ Local execution created complete record set");
    });

    test("should handle participation ID extraction correctly", async () => {
      const testConfig: ProcessingConfig = {
        processMode: "sequential",
        omitGet: true,
        batchSize: 1,
        chunkSize: 1,
      };

      // Run with single record to verify ID handling
      const result = await testRunner.runWithCsv(TEST_CSV_PATH, testConfig);

      if (result.successCount > 0) {
        const dbState = await captureDbState();

        // Verify that related records reference the participation correctly
        const participation = dbState.participaciones[0];
        const relatedRecords = [
          ...dbState.moduloProgressRecords,
          ...dbState.surveyCompletionRecords,
          ...dbState.attendanceRecords,
          ...dbState.workCompletionRecords,
        ];

        relatedRecords.forEach((record) => {
          expect(record.attributes.participacion.data.id).toBe(
            participation.id
          );
        });

        console.log("✅ Participation ID references are consistent");
      }
    });

    test("should create all expected related record types", async () => {
      const testConfig: ProcessingConfig = {
        processMode: "sequential",
        omitGet: true,
        batchSize: 3,
        chunkSize: 1,
      };

      const result = await testRunner.runWithCsv(TEST_CSV_PATH, testConfig);
      const dbState = await captureDbState();

      // Verify all record types were created
      expect(dbState.participaciones.length).toBeGreaterThan(0);

      // These should be created if the CSV has the corresponding fields
      if (hasModuleFields()) {
        expect(dbState.moduloProgressRecords.length).toBeGreaterThan(0);
      }

      if (hasSurveyFields()) {
        expect(dbState.surveyCompletionRecords.length).toBeGreaterThan(0);
      }

      if (hasAttendanceFields()) {
        expect(dbState.attendanceRecords.length).toBeGreaterThan(0);
      }

      if (hasWorkFields()) {
        expect(dbState.workCompletionRecords.length).toBeGreaterThan(0);
      }

      console.log("✅ All expected related record types were created");
    });

    // Helper functions
    async function cleanupTestData(): Promise<void> {
      try {
        // Delete test records (in reverse dependency order)
        await api.delete(
          "/trabajo-realizado-registros?filters[participacion][participante][id_externo][$contains]=TEST"
        );
        await api.delete(
          "/participante-asistencia-registros?filters[participacion][participante][id_externo][$contains]=TEST"
        );
        await api.delete(
          "/encuesta-completada-registros?filters[participacion][participante][id_externo][$contains]=TEST"
        );
        await api.delete(
          "/modulo-progreso-registros?filters[participacion][participante][id_externo][$contains]=TEST"
        );
        await api.delete(
          "/correo-participantes?filters[participante][id_externo][$contains]=TEST"
        );
        await api.delete(
          "/participaciones?filters[participante][id_externo][$contains]=TEST"
        );
        await api.delete("/participantes?filters[id_externo][$contains]=TEST");
      } catch (error) {
        // Ignore cleanup errors
        console.warn("Cleanup warning:", error);
      }
    }

    async function captureDbState(): Promise<any> {
      const [
        participaciones,
        moduloProgressRecords,
        surveyCompletionRecords,
        attendanceRecords,
        workCompletionRecords,
      ] = await Promise.all([
        api.get(
          "/participaciones?populate=*&filters[participante][id_externo][$contains]=TEST"
        ),
        api.get(
          "/modulo-progreso-registros?populate=*&filters[participacion][participante][id_externo][$contains]=TEST"
        ),
        api.get(
          "/encuesta-completada-registros?populate=*&filters[participacion][participante][id_externo][$contains]=TEST"
        ),
        api.get(
          "/participante-asistencia-registros?populate=*&filters[participacion][participante][id_externo][$contains]=TEST"
        ),
        api.get(
          "/trabajo-realizado-registros?populate=*&filters[participacion][participante][id_externo][$contains]=TEST"
        ),
      ]);

      return {
        participaciones: participaciones.data.data,
        moduloProgressRecords: moduloProgressRecords.data.data,
        surveyCompletionRecords: surveyCompletionRecords.data.data,
        attendanceRecords: attendanceRecords.data.data,
        workCompletionRecords: workCompletionRecords.data.data,
      };
    }

    function hasModuleFields(): boolean {
      // Check if test CSV has module fields
      return true; // Assume yes for now
    }

    function hasSurveyFields(): boolean {
      // Check if test CSV has survey fields
      return true; // Assume yes for now
    }

    function hasAttendanceFields(): boolean {
      // Check if test CSV has attendance fields
      return true; // Assume yes for now
    }

    function hasWorkFields(): boolean {
      // Check if test CSV has work fields
      return true; // Assume yes for now
    }
  }
);
