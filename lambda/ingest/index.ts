import { S3Event, S3Handler } from "aws-lambda";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import axios, { AxiosInstance } from "axios";
import csvParser from "csv-parser";
import {
  CsvRow,
  UniqueSets,
  CacheMaps,
  ParticipantCsvRow,
  EnvironmentConfig,
  ProcessingConfig,
  StrapiListResponse,
  StrapiCreateResponse,
  StrapiEntity,
  Dict,
  ExecutionMode,
} from "./types";
import {
  detectExecutionMode,
  loadEnvironmentConfig,
  createProcessingConfig,
  validateConfiguration,
  logValidationResults,
} from "./config";
import {
  toBoolean,
  normalizeHeaders,
  toNumber,
  formatError,
} from "./utils";
import { CacheManager } from "./cache";
import { EntityManager } from "./entities";

const s3 = new S3Client({});

// Global configuration - will be initialized in handler
let globalConfig: EnvironmentConfig;
let processingConfig: ProcessingConfig;

const streamToString = async (stream: Readable) =>
  await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c) => chunks.push(Buffer.from(c)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });

// API client - will be initialized with configuration
let api: AxiosInstance;

// Cache manager - will be initialized with API client
let cacheManager: CacheManager;

// Entity manager - will be initialized with API client and cache manager
let entityManager: EntityManager;

// Utility functions are now imported from ./utils
// Cache management is now handled by CacheManager class

// getOrCreate function is now handled by EntityManager

async function handleParticipantEmail(
  row: ParticipantCsvRow,
  participantId: number
) {
  const email = row.email?.trim();
  if (email && processingConfig.omitGet) {
    await api.post("/correo-participantes", {
      data: { participante: participantId, correo: email, principal: true },
    });
    // console.log(`   → Correo asignado: ${email} (principal=${true})`);
  } else if (email && email.toUpperCase() !== "NA") {
    // ¿Tiene ya algún correo registrado?
    const { data: existingAll } = await api.get<
      StrapiListResponse<StrapiEntity & Record<string, unknown>>
    >(
      `/correo-participantes?filters[participante][id][$eq]=${participantId}&pagination[limit]=1`
    );

    const shouldBePrincipal = existingAll.data.length === 0;

    // ¿Ya existe este mismo email?
    const { data: existingByEmail } = await api.get<
      StrapiListResponse<StrapiEntity & Record<string, unknown>>
    >(
      `/correo-participantes?filters[participante][id][$eq]=${participantId}&filters[correo][$eq]=${encodeURIComponent(
        email
      )}&pagination[limit]=1`
    );

    if (existingByEmail.data.length === 0) {
      // No existía: lo creo y marco principal sólo si es el primero
      await api.post("/correo-participantes", {
        data: {
          participante: participantId,
          correo: email,
          principal: shouldBePrincipal,
        },
      });
      console.log(
        `   → Correo asignado: ${email} (principal=${shouldBePrincipal})`
      );
    } else {
      console.log(`   → Correo ya registrado: ${email}`);
    }
  } else {
    console.log(`   → Participante sin correo: ${email}`);
  }
}

/**
 * Procesa una sola fila del CSV. Ahora es muy "ligera", principalmente obtiene
 * IDs de la caché y crea los registros finales.
 */
async function processParticipationRow(row: ParticipantCsvRow) {
  // PASO 1: Obtener IDs de la caché. Deben existir.
  const implementacionKey = cacheManager.createImplementationKey(
    row.implementacion || "",
    row.ciclo_escolar || "",
    row.periodo_de_implementacion || ""
  );
  const implementacionId = cacheManager.getCachedId("implementaciones", implementacionKey);
  const cctId = row.cct ? cacheManager.getCachedId("ccts", row.cct) : null;

  // PASO 2: Manejar participantes "on the run"
  const participantId = await entityManager.getOrCreate(
    "participantes",
    { id_externo: row.id },
    {
      id_externo: row.id,
      edad: toNumber(row.edad),
      sexo: row.sexo,
      telefono: row.telefono,
      curp: row.curp,
      rfc: row.rfc,
      nombre: row.nombre,
      primer_apellido: row.primer_apellido,
      segundo_apellido: row.segundo_apellido,
      nombre_completo: row.nombre_completo,
      entidad: row.entidad,
      estado_civil:
        row.estado_civil?.toUpperCase() !== "NA" ? row.estado_civil : null,
      lengua_indigena: toBoolean(row.lengua_indigena),
      hablante_maya: toBoolean(row.hablante_maya),
      nivel_educativo:
        row.nivel_educativo?.toUpperCase() !== "NA"
          ? row.nivel_educativo
          : null,
      cct: cctId,
    },
    "participantes",
    row.id
  );

  if (!participantId || !implementacionId) {
    throw new Error(
      `Faltan IDs críticos para la fila con id_externo ${row.id}. ParticipanteID: ${participantId}, ImplementacionID: ${implementacionId}`
    );
  }

  // PASO 3: Crear la Participación
  if (!processingConfig.omitGet) {
    const existingPartRes = await api.get<
      StrapiListResponse<StrapiEntity & Record<string, unknown>>
    >(
      `/participaciones?filters[participante][id][$eq]=${participantId}&filters[implementacion][id][$eq]=${implementacionId}&pagination[limit]=1`
    );
    if (existingPartRes.data.data.length > 0) {
      console.log(
        "Participante en esta implementacion ya existe. Ignorando fila..."
      );
      return;
    }
  }

  const { data: partRes } = await api.post<StrapiCreateResponse<StrapiEntity>>(
    "/participaciones",
    {
      data: {
        participante: participantId,
        implementacion: implementacionId,
        puesto: row.puesto,
        puesto_detalle: row.puesto_detalle,
        antiguedad: row.antiguedad,
        estudiantes_a_cargo: toNumber(row.estudiantes_a_cargo),
        turno: row.turno,
        participa_director: toBoolean(row.participa_director_a),
        cct_verificado: toBoolean(row.centro_de_trabajo_verificado),
        obtuvo_constancia: toBoolean(row.constancia),
        involucramiento: row.involucramiento,
        promedio_modulos: row.promedio_modulos,
      },
    }
  );
  const participationId = partRes.data.id;

  const creationPromises = [];
  if (
    (row.minutos_app && row.minutos_app.toUpperCase() !== "NA") ||
    toBoolean(row.descarga_app)
  ) {
    creationPromises.push(
      api
        .post("/uso-app-participantes", {
          data: {
            participante: participantId,
            minutos_uso_app: toNumber(row.minutos_app) || 0,
            descargo_app: toBoolean(row.descarga_app),
          },
        })
        .catch(() => {})
    );
  }

  for (const mod of ["mod1", "mod2", "mod3"]) {
    if (
      row[mod] &&
      typeof row[mod] === "string" &&
      row[mod].toUpperCase() !== "NA"
    ) {
      const cacheKey = cacheManager.createImplementationCacheKey(mod, implementacionId);
      const moduleId = cacheManager.getCachedId("modulos", cacheKey);
      if (moduleId) {
        creationPromises.push(
          api.post("/modulo-progreso-registros", {
            data: {
              participacion: participationId,
              modulo: moduleId,
              calificacion: toNumber(row[mod]),
            },
          })
        );
      }
    }
  }

  for (const key of ["encuesta_inicial", "encuesta_final"] as const) {
    const val = row[key];
    if (typeof val === "string" && val.toUpperCase() !== "NA") {
      const encId = cacheManager.getCachedId("encuestas", key);
      if (encId) {
        creationPromises.push(
          api.post("/encuesta-completada-registros", {
            data: {
              participacion: participationId,
              encuesta: encId,
              estado: "Completada",
            },
          })
        );
      }
    }
  }

  const attendanceFields = Object.keys(row).filter(
    (k) => k.startsWith("asist_") || k.startsWith("trip") || k.startsWith("ses")
  );
  for (const field of attendanceFields) {
    const val = row[field];
    if (typeof val === "string" && val.toUpperCase() !== "NA") {
      const cacheKey = cacheManager.createImplementationCacheKey(field, implementacionId);
      const asisId = cacheManager.getCachedId("asistencias", cacheKey);
      if (asisId) {
        creationPromises.push(
          api.post("/participante-asistencia-registros", {
            data: {
              participacion: participationId,
              asistencia: asisId,
              presente: true,
            },
          })
        );
      }
    }
  }

  const workFields = Object.keys(row).filter(
    (k) => k.startsWith("trabajo") || k.startsWith("evidencia")
  );
  for (const field of workFields) {
    const val = row[field];
    if (typeof val === "string" && val.toUpperCase() !== "NA") {
      const cacheKey = cacheManager.createImplementationCacheKey(field, implementacionId);
      const jobId = cacheManager.getCachedId("trabajos", cacheKey);
      if (jobId) {
        creationPromises.push(
          api.post("/trabajo-realizado-registros", {
            data: {
              participacion: participationId,
              trabajo: jobId,
              completado: true,
            },
          })
        );
      }
    }
  }

  await Promise.allSettled(creationPromises);
  await handleParticipantEmail(row, participantId);
}

/**
 * Initialize configuration and API client
 */
function initializeConfiguration(executionMode: ExecutionMode): void {
  // Load environment configuration
  globalConfig = loadEnvironmentConfig();

  // Create processing configuration
  processingConfig = createProcessingConfig();

  // Validate configuration
  const validation = validateConfiguration(
    executionMode,
    globalConfig,
    undefined,
    processingConfig
  );
  logValidationResults(validation, `${executionMode.toUpperCase()} Mode`);

  if (!validation.isValid) {
    throw new Error(
      `Configuration validation failed: ${validation.errors.join(", ")}`
    );
  }

  // Initialize API client
  api = axios.create({
    baseURL: globalConfig.strapiBaseUrl,
    headers: {
      Authorization: `Bearer ${globalConfig.strapiToken}`,
      "Content-Type": "application/json",
    },
    timeout: 30000,
  });

  // Initialize cache manager
  cacheManager = new CacheManager(api);

  // Initialize entity manager
  entityManager = new EntityManager(api, cacheManager, processingConfig);

  console.log(`✅ Configuration initialized for ${executionMode} mode`);
  console.log(`   - Process Mode: ${processingConfig.processMode}`);
  console.log(`   - Omit GET: ${processingConfig.omitGet}`);
  console.log(`   - Batch Size: ${processingConfig.batchSize}`);
  console.log(`   - Chunk Size: ${processingConfig.chunkSize}`);
}

export const handler: S3Handler = async (event: S3Event) => {
  console.log("🚀 Starting migrator lambda execution");

  // Detect execution mode and initialize configuration
  const executionMode = detectExecutionMode(event);
  console.log(`📋 Detected execution mode: ${executionMode}`);

  // Initialize configuration
  initializeConfiguration(executionMode);

  for (const r of event.Records) {
    const bucket = r.s3.bucket.name;
    const key = decodeURIComponent(r.s3.object.key);

    console.log(`📁 Processing file: s3://${bucket}/${key}`);

    const records: CsvRow[] = [];
    const unique: UniqueSets = {
      ccts: new Set<string>(),
      programas: new Set<string>(),
      implementaciones: new Map(),
      asistenciaFields: new Set<string>(),
      asistenciaModalities: new Map<string, string>(),
      trabajoFields: new Set<string>(),
    };

    // fetch object
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );

    await new Promise<void>((resolve, reject) => {
      (obj.Body as Readable)
        .pipe(csvParser({ mapHeaders: normalizeHeaders }))
        .on("data", (row: CsvRow) => {
          records.push(row);
          // CCTS y programas
          if (row.cct) unique.ccts.add(String(row.cct));
          if (row.programa) unique.programas.add(String(row.programa));
          // Implementaciones
          if (
            row.implementacion &&
            row.ciclo_escolar &&
            row.periodo_de_implementacion
          ) {
            const implKey = `${row.implementacion}|${row.ciclo_escolar}|${row.periodo_de_implementacion}`;
            if (!unique.implementaciones.has(implKey)) {
              unique.implementaciones.set(implKey, {
                nombre: row.implementacion,
                ciclo_escolar: row.ciclo_escolar,
                periodo: row.periodo_de_implementacion,
                programa: row.programa,
              });
            }
          }
          // Asistencias y modalidades
          Object.keys(row).forEach((k) => {
            if (
              k.startsWith("asist_") ||
              k.startsWith("trip") ||
              k.startsWith("ses")
            ) {
              unique.asistenciaFields.add(k);
              const modKey = `modalidad_${k}`;
              const rawVal = row[modKey];
              const modVal =
                typeof rawVal === "string"
                  ? rawVal.trim()
                  : rawVal === undefined || rawVal === null
                    ? ""
                    : String(rawVal).trim();
              if (modVal && modVal.toUpperCase() !== "NA") {
                const implKey = `${row.implementacion}|${row.ciclo_escolar}|${row.periodo_de_implementacion}`;
                const mapKey = `${implKey}|${k}`;
                if (
                  unique.asistenciaModalities.has(mapKey) &&
                  unique.asistenciaModalities.get(mapKey) !== modVal
                ) {
                  // console.warn(
                  //   `[WARN] Modalidad cambiante para ${k} en implementación ${implKey}: "${unique.asistenciaModalities.get(mapKey)}" vs "${modVal}"`
                  // );
                } else {
                  unique.asistenciaModalities.set(mapKey, modVal);
                }
              }
            }
            if (k.startsWith("trabajo") || k.startsWith("evidencia"))
              unique.trabajoFields.add(k);
          });
        })
        .on("end", () => resolve())
        .on("error", (e: Error) => reject(e));
    });

    console.log(`✅ Processed ${records.length} records from CSV`);
  }
};
