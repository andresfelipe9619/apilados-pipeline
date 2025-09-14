/**
 * Tests for the three-phase processing pipeline
 */

import { Readable } from "node:stream";
import { AxiosInstance } from "axios";
import {
  CsvAnalysisPhase,
  EntityCreationPhase,
  BatchProcessingPhase,
  ThreePhaseProcessingPipeline,
} from "../../processing-pipeline";
import { CacheManager } from "../../cache";
import { EntityManager } from "../../entities";
import { ProcessingConfig } from "../../types";

// Mock dependencies
const mockApi = {
  get: jest.fn(),
  post: jest.fn(),
} as unknown as AxiosInstance;

const mockProcessingConfig: ProcessingConfig = {
  processMode: "parallel",
  omitGet: false,
  batchSize: 10,
  chunkSize: 1000,
};

const mockCacheManager = {
  getCache: jest.fn(() => ({
    programas: new Map(),
    ccts: new Map(),
    participantes: new Map(),
    implementaciones: new Map(),
    modulos: new Map(),
    encuestas: new Map(),
    asistencias: new Map(),
    trabajos: new Map(),
  })),
  getCacheStats: jest.fn(() => ({
    programas: 0,
    ccts: 0,
    participantes: 0,
    implementaciones: 0,
    modulos: 0,
    encuestas: 0,
    asistencias: 0,
    trabajos: 0,
  })),
  validateCache: jest.fn(() => ({ isValid: true, issues: [] })),
  createImplementationKey: jest.fn(),
  createImplementationCacheKey: jest.fn(),
  getCachedId: jest.fn(),
  setCachedId: jest.fn(),
  hasCachedId: jest.fn(),
  precacheSimpleEntities: jest.fn(),
  loadCctsFromCsv: jest.fn(),
} as unknown as CacheManager;

const mockEntityManager = {
  getOrCreate: jest.fn(),
  precacheSimpleEntities: jest.fn(),
  loadCctsFromCsv: jest.fn(),
  createPrograms: jest.fn(),
  createImplementations: jest.fn(),
  createImplementationDependentEntities: jest.fn(),
  initializeAllCaches: jest.fn(),
  getCacheStats: jest.fn(() => ({})),
  validateCache: jest.fn(() => ({ isValid: true, issues: [] })),
} as unknown as EntityManager;

describe("CsvAnalysisPhase", () => {
  let analysisPhase: CsvAnalysisPhase;

  beforeEach(() => {
    analysisPhase = new CsvAnalysisPhase(mockProcessingConfig);
  });

  it("should analyze CSV data and collect unique entities", async () => {
    const csvData = `id,programa,implementacion,ciclo_escolar,periodo_de_implementacion,cct
1,Programa A,Impl 1,2023,Periodo 1,CCT001
2,Programa B,Impl 2,2023,Periodo 2,CCT002`;

    const csvStream = Readable.from([csvData]);

    const result = await analysisPhase.analyzeCsv(csvStream);

    expect(result.records).toHaveLength(2);
    expect(result.uniqueSets.programas.size).toBe(2);
    expect(result.uniqueSets.programas.has("Programa A")).toBe(true);
    expect(result.uniqueSets.programas.has("Programa B")).toBe(true);
    expect(result.uniqueSets.ccts.size).toBe(2);
    expect(result.uniqueSets.implementaciones.size).toBe(2);
    expect(result.stats.recordsProcessed).toBe(2);
  });

  it("should handle empty CSV data", async () => {
    const csvData = `id,programa,implementacion,ciclo_escolar,periodo_de_implementacion,cct`;
    const csvStream = Readable.from([csvData]);

    const result = await analysisPhase.analyzeCsv(csvStream);

    expect(result.records).toHaveLength(0);
    expect(result.uniqueSets.programas.size).toBe(0);
    expect(result.stats.recordsProcessed).toBe(0);
  });

  it("should collect attendance and work fields", async () => {
    const csvData = `id,asist_session1,trip_1,trabajo_1,evidencia_1
1,present,attended,completed,submitted`;

    const csvStream = Readable.from([csvData]);

    const result = await analysisPhase.analyzeCsv(csvStream);

    expect(result.uniqueSets.asistenciaFields.has("asist_session1")).toBe(true);
    expect(result.uniqueSets.asistenciaFields.has("trip_1")).toBe(true);
    expect(result.uniqueSets.trabajoFields.has("trabajo_1")).toBe(true);
    expect(result.uniqueSets.trabajoFields.has("evidencia_1")).toBe(true);
  });
});

describe("EntityCreationPhase", () => {
  let creationPhase: EntityCreationPhase;

  beforeEach(() => {
    creationPhase = new EntityCreationPhase(
      mockEntityManager,
      mockCacheManager,
      mockProcessingConfig
    );
    jest.clearAllMocks();
  });

  it("should execute creation phase successfully", async () => {
    const uniqueSets = {
      ccts: new Set(["CCT001"]),
      programas: new Set(["Programa A"]),
      implementaciones: new Map([
        ["impl1|2023|periodo1", {
          nombre: "Impl 1",
          ciclo_escolar: "2023",
          periodo: "Periodo 1",
          programa: "Programa A",
        }],
      ]),
      asistenciaFields: new Set(["asist_1"]),
      asistenciaModalities: new Map(),
      trabajoFields: new Set(["trabajo_1"]),
    };

    await expect(creationPhase.executeCreationPhase(uniqueSets)).resolves.not.toThrow();

    expect(mockEntityManager.precacheSimpleEntities).toHaveBeenCalled();
    expect(mockCacheManager.validateCache).toHaveBeenCalled();
  });
});

describe("BatchProcessingPhase", () => {
  let batchPhase: BatchProcessingPhase;

  beforeEach(() => {
    batchPhase = new BatchProcessingPhase(
      mockApi,
      mockEntityManager,
      mockCacheManager,
      mockProcessingConfig
    );
    jest.clearAllMocks();
  });

  it("should process records in parallel mode", async () => {
    const records = [
      {
        id: "1",
        implementacion: "Impl 1",
        ciclo_escolar: "2023",
        periodo_de_implementacion: "Periodo 1",
      },
      {
        id: "2",
        implementacion: "Impl 1",
        ciclo_escolar: "2023",
        periodo_de_implementacion: "Periodo 1",
      },
    ];

    // Mock successful responses
    (mockCacheManager.getCachedId as jest.Mock).mockReturnValue(1);
    (mockCacheManager.createImplementationKey as jest.Mock).mockReturnValue("impl-key");
    (mockEntityManager.getOrCreate as jest.Mock).mockResolvedValue(1);
    (mockApi.get as jest.Mock).mockResolvedValue({ data: { data: [] } });
    (mockApi.post as jest.Mock).mockResolvedValue({ data: { data: { id: 1 } } });

    const result = await batchPhase.executeBatchProcessing(records);

    expect(result.totalRecords).toBe(2);
    expect(result.successCount).toBe(2);
    expect(result.errorCount).toBe(0);
  });

  it("should handle processing errors gracefully", async () => {
    const records = [
      {
        id: "1",
        implementacion: "Impl 1",
        ciclo_escolar: "2023",
        periodo_de_implementacion: "Periodo 1",
      },
    ];

    // Mock error
    (mockCacheManager.getCachedId as jest.Mock).mockReturnValue(null);
    (mockEntityManager.getOrCreate as jest.Mock).mockRejectedValue(new Error("Test error"));

    const result = await batchPhase.executeBatchProcessing(records);

    expect(result.totalRecords).toBe(1);
    expect(result.successCount).toBe(0);
    expect(result.errorCount).toBe(1);
    expect(batchPhase.getErrorRecords()).toHaveLength(1);
  });

  describe("Participant Creation Logic", () => {
    it("should create participant with all fields properly mapped", async () => {
      const participantRow = {
        id: "PART001",
        edad: "25",
        sexo: "M",
        telefono: "555-1234",
        curp: "CURP123456789",
        rfc: "RFC123456789",
        nombre: "Juan",
        primer_apellido: "Pérez",
        segundo_apellido: "García",
        nombre_completo: "Juan Pérez García",
        entidad: "CDMX",
        estado_civil: "Soltero",
        lengua_indigena: "true",
        hablante_maya: "false",
        nivel_educativo: "Licenciatura",
        cct: "CCT001",
        implementacion: "Impl 1",
        ciclo_escolar: "2023",
        periodo_de_implementacion: "Periodo 1",
        email: "juan.perez@example.com",
      };

      // Mock cache responses
      (mockCacheManager.createImplementationKey as jest.Mock).mockReturnValue("impl-key");
      (mockCacheManager.getCachedId as jest.Mock)
        .mockReturnValueOnce(100) // implementation ID
        .mockReturnValueOnce(50); // CCT ID
      
      // Mock participant creation
      (mockEntityManager.getOrCreate as jest.Mock).mockResolvedValue(123);
      
      // Mock participation creation
      (mockApi.get as jest.Mock).mockResolvedValue({ data: { data: [] } });
      (mockApi.post as jest.Mock).mockResolvedValue({ data: { data: { id: 456 } } });

      const result = await batchPhase.executeBatchProcessing([participantRow]);

      expect(result.successCount).toBe(1);
      expect(result.errorCount).toBe(0);

      // Verify participant creation was called with correct data
      expect(mockEntityManager.getOrCreate).toHaveBeenCalledWith(
        "participantes",
        { id_externo: "PART001" },
        {
          id_externo: "PART001",
          edad: 25,
          sexo: "M",
          telefono: "555-1234",
          curp: "CURP123456789",
          rfc: "RFC123456789",
          nombre: "Juan",
          primer_apellido: "Pérez",
          segundo_apellido: "García",
          nombre_completo: "Juan Pérez García",
          entidad: "CDMX",
          estado_civil: "Soltero",
          lengua_indigena: true,
          hablante_maya: false,
          nivel_educativo: "Licenciatura",
          cct: 50,
        },
        "participantes",
        "PART001"
      );
    });

    it("should handle NA values in participant data", async () => {
      const participantRow = {
        id: "PART002",
        edad: "NA",
        estado_civil: "NA",
        nivel_educativo: "NA",
        implementacion: "Impl 1",
        ciclo_escolar: "2023",
        periodo_de_implementacion: "Periodo 1",
      };

      // Mock cache responses
      (mockCacheManager.createImplementationKey as jest.Mock).mockReturnValue("impl-key");
      (mockCacheManager.getCachedId as jest.Mock).mockReturnValue(100);
      (mockEntityManager.getOrCreate as jest.Mock).mockResolvedValue(123);
      (mockApi.get as jest.Mock).mockResolvedValue({ data: { data: [] } });
      (mockApi.post as jest.Mock).mockResolvedValue({ data: { data: { id: 456 } } });

      const result = await batchPhase.executeBatchProcessing([participantRow]);

      expect(result.successCount).toBe(1);

      // Verify NA values are converted to null
      expect(mockEntityManager.getOrCreate).toHaveBeenCalledWith(
        "participantes",
        { id_externo: "PART002" },
        expect.objectContaining({
          edad: null,
          estado_civil: null,
          nivel_educativo: null,
        }),
        "participantes",
        "PART002"
      );
    });

    it("should throw error when critical IDs are missing", async () => {
      const participantRow = {
        id: "PART003",
        implementacion: "Impl 1",
        ciclo_escolar: "2023",
        periodo_de_implementacion: "Periodo 1",
      };

      // Mock missing implementation ID
      (mockCacheManager.createImplementationKey as jest.Mock).mockReturnValue("impl-key");
      (mockCacheManager.getCachedId as jest.Mock).mockReturnValue(null);
      (mockEntityManager.getOrCreate as jest.Mock).mockResolvedValue(123);

      const result = await batchPhase.executeBatchProcessing([participantRow]);

      expect(result.successCount).toBe(0);
      expect(result.errorCount).toBe(1);
      expect(batchPhase.getErrorRecords()[0].error).toContain("Missing critical IDs");
    });
  });

  describe("Email Handling System", () => {
    let batchPhaseWithOmitGet: BatchProcessingPhase;

    beforeEach(() => {
      const configWithOmitGet = { ...mockProcessingConfig, omitGet: true };
      batchPhaseWithOmitGet = new BatchProcessingPhase(
        mockApi,
        mockEntityManager,
        mockCacheManager,
        configWithOmitGet
      );
      jest.clearAllMocks();
    });

    it("should create email directly when omitGet is true", async () => {
      const participantRow = {
        id: "PART004",
        email: "test@example.com",
        implementacion: "Impl 1",
        ciclo_escolar: "2023",
        periodo_de_implementacion: "Periodo 1",
      };

      // Mock successful responses
      (mockCacheManager.createImplementationKey as jest.Mock).mockReturnValue("impl-key");
      (mockCacheManager.getCachedId as jest.Mock).mockReturnValue(100);
      (mockEntityManager.getOrCreate as jest.Mock).mockResolvedValue(123);
      (mockApi.post as jest.Mock).mockResolvedValue({ data: { data: { id: 456 } } });

      const result = await batchPhaseWithOmitGet.executeBatchProcessing([participantRow]);

      expect(result.successCount).toBe(1);

      // Verify email creation was called
      expect(mockApi.post).toHaveBeenCalledWith("/correo-participantes", {
        data: {
          participante: 123,
          correo: "test@example.com",
          principal: true,
        },
      });
    });

    it("should handle primary email logic when omitGet is false", async () => {
      const participantRow = {
        id: "PART005",
        email: "primary@example.com",
        implementacion: "Impl 1",
        ciclo_escolar: "2023",
        periodo_de_implementacion: "Periodo 1",
      };

      // Mock responses for email checking
      (mockCacheManager.createImplementationKey as jest.Mock).mockReturnValue("impl-key");
      (mockCacheManager.getCachedId as jest.Mock).mockReturnValue(100);
      (mockEntityManager.getOrCreate as jest.Mock).mockResolvedValue(123);
      
      // Mock no existing emails (should be primary)
      (mockApi.get as jest.Mock)
        .mockResolvedValueOnce({ data: { data: [] } }) // participation check
        .mockResolvedValueOnce({ data: { data: [] } }) // existing emails check
        .mockResolvedValueOnce({ data: { data: [] } }); // specific email check
      
      (mockApi.post as jest.Mock).mockResolvedValue({ data: { data: { id: 456 } } });

      const result = await batchPhase.executeBatchProcessing([participantRow]);

      expect(result.successCount).toBe(1);

      // Verify email creation with principal=true
      expect(mockApi.post).toHaveBeenCalledWith("/correo-participantes", {
        data: {
          participante: 123,
          correo: "primary@example.com",
          principal: true,
        },
      });
    });

    it("should handle secondary email when participant already has emails", async () => {
      const participantRow = {
        id: "PART006",
        email: "secondary@example.com",
        implementacion: "Impl 1",
        ciclo_escolar: "2023",
        periodo_de_implementacion: "Periodo 1",
      };

      // Mock responses
      (mockCacheManager.createImplementationKey as jest.Mock).mockReturnValue("impl-key");
      (mockCacheManager.getCachedId as jest.Mock).mockReturnValue(100);
      (mockEntityManager.getOrCreate as jest.Mock).mockResolvedValue(123);
      
      // Mock existing emails (should not be primary)
      (mockApi.get as jest.Mock)
        .mockResolvedValueOnce({ data: { data: [] } }) // participation check
        .mockResolvedValueOnce({ data: { data: [{ id: 1 }] } }) // existing emails check
        .mockResolvedValueOnce({ data: { data: [] } }); // specific email check
      
      (mockApi.post as jest.Mock).mockResolvedValue({ data: { data: { id: 456 } } });

      const result = await batchPhase.executeBatchProcessing([participantRow]);

      expect(result.successCount).toBe(1);

      // Verify email creation with principal=false
      expect(mockApi.post).toHaveBeenCalledWith("/correo-participantes", {
        data: {
          participante: 123,
          correo: "secondary@example.com",
          principal: false,
        },
      });
    });

    it("should skip email creation for NA or empty emails", async () => {
      const participantRows = [
        {
          id: "PART007",
          email: "NA",
          implementacion: "Impl 1",
          ciclo_escolar: "2023",
          periodo_de_implementacion: "Periodo 1",
        },
        {
          id: "PART008",
          email: "",
          implementacion: "Impl 1",
          ciclo_escolar: "2023",
          periodo_de_implementacion: "Periodo 1",
        },
        {
          id: "PART009",
          // no email field
          implementacion: "Impl 1",
          ciclo_escolar: "2023",
          periodo_de_implementacion: "Periodo 1",
        },
      ];

      // Mock successful responses
      (mockCacheManager.createImplementationKey as jest.Mock).mockReturnValue("impl-key");
      (mockCacheManager.getCachedId as jest.Mock).mockReturnValue(100);
      (mockEntityManager.getOrCreate as jest.Mock).mockResolvedValue(123);
      (mockApi.get as jest.Mock).mockResolvedValue({ data: { data: [] } });
      (mockApi.post as jest.Mock).mockResolvedValue({ data: { data: { id: 456 } } });

      const result = await batchPhase.executeBatchProcessing(participantRows);

      expect(result.successCount).toBe(3);

      // Verify no email creation calls were made
      const emailCalls = (mockApi.post as jest.Mock).mock.calls.filter(
        call => call[0] === "/correo-participantes"
      );
      expect(emailCalls).toHaveLength(0);
    });

    it("should not create duplicate emails", async () => {
      const participantRow = {
        id: "PART010",
        email: "existing@example.com",
        implementacion: "Impl 1",
        ciclo_escolar: "2023",
        periodo_de_implementacion: "Periodo 1",
      };

      // Mock responses
      (mockCacheManager.createImplementationKey as jest.Mock).mockReturnValue("impl-key");
      (mockCacheManager.getCachedId as jest.Mock).mockReturnValue(100);
      (mockEntityManager.getOrCreate as jest.Mock).mockResolvedValue(123);
      
      // Mock existing specific email
      (mockApi.get as jest.Mock)
        .mockResolvedValueOnce({ data: { data: [] } }) // participation check
        .mockResolvedValueOnce({ data: { data: [{ id: 1 }] } }) // existing emails check
        .mockResolvedValueOnce({ data: { data: [{ id: 2 }] } }); // specific email exists
      
      (mockApi.post as jest.Mock).mockResolvedValue({ data: { data: { id: 456 } } });

      const result = await batchPhase.executeBatchProcessing([participantRow]);

      expect(result.successCount).toBe(1);

      // Verify no email creation call was made (email already exists)
      const emailCalls = (mockApi.post as jest.Mock).mock.calls.filter(
        call => call[0] === "/correo-participantes"
      );
      expect(emailCalls).toHaveLength(0);
    });
  });
});

describe("ThreePhaseProcessingPipeline", () => {
  let pipeline: ThreePhaseProcessingPipeline;

  beforeEach(() => {
    pipeline = new ThreePhaseProcessingPipeline(
      mockApi,
      mockEntityManager,
      mockCacheManager,
      mockProcessingConfig
    );
    jest.clearAllMocks();
  });

  it("should execute full pipeline successfully", async () => {
    const csvData = `id,programa,implementacion,ciclo_escolar,periodo_de_implementacion
1,Programa A,Impl 1,2023,Periodo 1`;

    const participationsCsv = Readable.from([csvData]);

    // Mock successful responses
    (mockCacheManager.getCachedId as jest.Mock).mockReturnValue(1);
    (mockCacheManager.createImplementationKey as jest.Mock).mockReturnValue("impl-key");
    (mockEntityManager.getOrCreate as jest.Mock).mockResolvedValue(1);
    (mockApi.get as jest.Mock).mockResolvedValue({ data: { data: [] } });
    (mockApi.post as jest.Mock).mockResolvedValue({ data: { data: { id: 1 } } });

    const result = await pipeline.executeFullPipeline(participationsCsv);

    expect(result.totalRecords).toBe(1);
    expect(result.successCount).toBe(1);
    expect(result.errorCount).toBe(0);
    expect(typeof result.processingTime).toBe("number");
  });

  it("should handle pipeline errors", async () => {
    const csvData = `invalid,csv,data`;
    const participationsCsv = Readable.from([csvData]);

    // Mock error in entity creation
    (mockEntityManager.precacheSimpleEntities as jest.Mock).mockRejectedValue(
      new Error("Entity creation failed")
    );

    await expect(pipeline.executeFullPipeline(participationsCsv)).rejects.toThrow();
  });
});