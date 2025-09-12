import { S3Event, S3Handler } from "aws-lambda";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import * as axios from "axios";
import csvParser from "csv-parser";

const s3 = new S3Client({});

const STRAPI_BASE_URL = process.env.STRAPI_BASE_URL!;
const STRAPI_TOKEN = process.env.STRAPI_TOKEN!;
const CHUNK_SIZE = Number(process.env.CHUNK_SIZE || "150");

// Nuevo: modo de procesamiento
const PROCESS_MODE = (process.env.PROCESS_MODE || "parallel").toLowerCase();
const RUN_SEQUENTIAL = PROCESS_MODE === "sequential";
const OMMIT_GET = process.env.OMMIT_GET === "true";
const BATCH_SIZE = 100;

// Types
type Primitive = string | number | boolean | null | undefined;
type Dict<T = unknown> = Record<string, T>;

type CsvRow = {
  cct?: string;
  programa?: string;
  implementacion?: string;
  ciclo_escolar?: string;
  periodo_de_implementacion?: string;
  [key: string]: Primitive;
};

type UniqueSets = {
  ccts: Set<string>;
  programas: Set<string>;
  implementaciones: Map<
    string,
    {
      nombre: string | undefined;
      ciclo_escolar: string | undefined;
      periodo: string | undefined;
      programa: string | undefined;
    }
  >;
  asistenciaFields: Set<string>;
  asistenciaModalities: Map<string, string>;
  trabajoFields: Set<string>;
};

type CacheMaps = {
  programas: Map<unknown, unknown>;
  ccts: Map<unknown, unknown>;
  participantes: Map<unknown, unknown>;
  implementaciones: Map<unknown, unknown>;
  modulos: Map<unknown, unknown>;
  encuestas: Map<unknown, unknown>;
  asistencias: Map<unknown, unknown>;
  trabajos: Map<unknown, unknown>;
};

// Shared types for participant-related CSV rows
type BaseParticipantCsv = {
  id?: string;
  edad?: string;
  sexo?: string;
  telefono?: string;
  curp?: string;
  rfc?: string;
  nombre?: string;
  primer_apellido?: string;
  segundo_apellido?: string;
  nombre_completo?: string;
  entidad?: string;
  estado_civil?: string;
  lengua_indigena?: string;
  hablante_maya?: string;
  nivel_educativo?: string;

  // Context fields
  cct?: string;
  implementacion?: string;
  ciclo_escolar?: string;
  periodo_de_implementacion?: string;
};

type ParticipationCsvExtras = {
  puesto?: string;
  puesto_detalle?: string;
  antiguedad?: string;
  estudiantes_a_cargo?: string;
  turno?: string;
  participa_director_a?: string;
  centro_de_trabajo_verificado?: string;
  constancia?: string;
  involucramiento?: string;
  promedio_modulos?: string;
  minutos_app?: string;
  descarga_app?: string;

  // dynamic assessment/attendance/work fields; keep index signature
  [key: string]: Primitive;
};

type EmailField = {
  email?: string | null | undefined;
};

type ParticipantCsvRow = BaseParticipantCsv &
  ParticipationCsvExtras &
  EmailField;

const streamToString = async (stream: Readable) =>
  await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c) => chunks.push(Buffer.from(c)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });

const api = axios.create({
  baseURL: STRAPI_BASE_URL,
  headers: {
    Authorization: `Bearer ${STRAPI_TOKEN}`,
    "Content-Type": "application/json",
  },
  timeout: 30000,
});

// --- CACHÉ GLOBAL ---
const cache: CacheMaps = {
  programas: new Map(),
  ccts: new Map(),
  participantes: new Map(),
  implementaciones: new Map(),
  modulos: new Map(),
  encuestas: new Map(),
  asistencias: new Map(),
  trabajos: new Map(),
};

// --- FUNCIONES UTILITARIAS ---
const toBoolean = (value: unknown): boolean => {
  if (typeof value !== "string") return !!value;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1";
};

const normalizeHeaders = ({ header }: { header: string }): string =>
  header
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_|_$/g, "");

// --- FUNCIONES DE MIGRACIÓN ---
async function precacheSimpleEntities(
  endpoint: string,
  fieldName: string,
  localCache: { set: (key: unknown, value: unknown) => void },
): Promise<void> {
  console.log(
    `[CACHE] descargando todas las entidades ${endpoint} por páginas…`,
  );
  let page = 1;
  const pageSize = 1000;
  while (true) {
    const { data: res } = await api.get<{
      data: Array<{ id: number; [k: string]: unknown }>;
    }>(
      `/${endpoint}?pagination[page]=${page}&pagination[pageSize]=${pageSize}&fields=id,${fieldName}`,
    );
    if (!res.data.length) break;
    for (const ent of res.data) {
      const key = ent[fieldName];
      if (key !== undefined) {
        localCache.set(key, ent.id);
      }
    }
    page++;
  }
}

async function getOrCreate(
  endpoint: string,
  filters: Dict<unknown>,
  createData: unknown,
  localCache: {
    has: (key: unknown) => boolean;
    get: (key: unknown) => unknown;
    set: (key: unknown, value: unknown) => void;
  },
  cacheKey: unknown,
): Promise<number | null> {
  if (cacheKey && localCache.has(cacheKey)) {
    return localCache.get(cacheKey) as number;
  }
  let qs = "";
  if ((OMMIT_GET && endpoint !== "participantes") || !OMMIT_GET) {
    qs = Object.entries(filters)
      .map(([k, v]) => `filters[${k}][$eq]=${encodeURIComponent(String(v))}`)
      .join("&");
    const { data: getRes } = await api.get<{ data: Array<{ id: number }> }>(
      `/${endpoint}?${qs}&pagination[limit]=1`,
    );

    if (getRes.data.length > 0) {
      const id = getRes.data[0].id;
      if (cacheKey) localCache.set(cacheKey, id);
      return id;
    }
  }

  if (!createData) return null;

  try {
    const { data: postRes } = await api.post<{ data: { id: number } }>(
      `/${endpoint}`,
      {
        data: createData,
      },
    );
    const newId = postRes.data.id;
    if (cacheKey) localCache.set(cacheKey, newId);
    return newId;
  } catch (error: unknown) {
    const err = error as {
      response?: {
        data?: { error?: { message?: string } };
      };
    };
    if (
      err.response?.data?.error?.message &&
      err.response.data.error.message.includes("unique constraint")
    ) {
      console.warn(
        `[WARN] Condición de carrera para ${endpoint}. Re-intentando búsqueda...`,
      );
      const { data: refetchRes } = await api.get<{
        data: Array<{ id: number }>;
      }>(`/${endpoint}?${qs}&pagination[limit]=1`);
      if (refetchRes.data.length > 0) {
        const id = refetchRes.data[0].id;
        if (cacheKey) localCache.set(cacheKey, id);
        return id;
      }
    }
    throw error;
  }
}

async function handleParticipantEmail(
  row: ParticipantCsvRow,
  participantId: number,
) {
  const email = row.email?.trim();
  if (email && OMMIT_GET) {
    await api.post("/correo-participantes", {
      data: { participante: participantId, correo: email, principal: true },
    });
    // console.log(`   → Correo asignado: ${email} (principal=${true})`);
  } else if (email && email.toUpperCase() !== "NA") {
    // ¿Tiene ya algún correo registrado?
    const { data: existingAll } = await api.get(
      `/correo-participantes?filters[participante][id][$eq]=${participantId}&pagination[limit]=1`,
    );

    const shouldBePrincipal = existingAll.data.length === 0;

    // ¿Ya existe este mismo email?
    const { data: existingByEmail } = await api.get(
      `/correo-participantes?filters[participante][id][$eq]=${participantId}&filters[correo][$eq]=${encodeURIComponent(
        email,
      )}&pagination[limit]=1`,
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
        `   → Correo asignado: ${email} (principal=${shouldBePrincipal})`,
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
  const implementacionKey = `${row.implementacion}|${row.ciclo_escolar}|${row.periodo_de_implementacion}`;
  const implementacionId: unknown =
    cache.implementaciones.get(implementacionKey);
  const cctId = row.cct ? cache.ccts.get(row.cct) : null;

  // PASO 2: Manejar participantes "on the run"
  const participantId = await getOrCreate(
    "participantes",
    { id_externo: row.id },
    {
      id_externo: row.id,
      edad: Number(row.edad) || null,
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
    cache.participantes,
    row.id,
  );

  if (!participantId || !implementacionId) {
    throw new Error(
      `Faltan IDs críticos para la fila con id_externo ${row.id}. ParticipanteID: ${participantId}, ImplementacionID: ${implementacionId}`,
    );
  }

  // PASO 3: Crear la Participación
  if (!OMMIT_GET) {
    const existingPartRes = await api.get(
      `/participaciones?filters[participante][id][$eq]=${participantId}&filters[implementacion][id][$eq]=${implementacionId}&pagination[limit]=1`,
    );
    if (existingPartRes.data.data.length > 0) {
      console.log(
        "Participante en esta implementacion ya existe. Ignorando fila...",
      );
      return;
    }
  }

  const { data: partRes } = await api.post("/participaciones", {
    data: {
      participante: participantId,
      implementacion: implementacionId,
      puesto: row.puesto,
      puesto_detalle: row.puesto_detalle,
      antiguedad: row.antiguedad,
      estudiantes_a_cargo: Number(row.estudiantes_a_cargo) || null,
      turno: row.turno,
      participa_director: toBoolean(row.participa_director_a),
      cct_verificado: toBoolean(row.centro_de_trabajo_verificado),
      obtuvo_constancia: toBoolean(row.constancia),
      involucramiento: row.involucramiento,
      promedio_modulos: row.promedio_modulos,
    },
  });
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
            minutos_uso_app: Number(row.minutos_app) || 0,
            descargo_app: toBoolean(row.descarga_app),
          },
        })
        .catch(() => {}),
    );
  }

  for (const mod of ["mod1", "mod2", "mod3"]) {
    if (
      row[mod] &&
      typeof row[mod] === "string" &&
      row[mod].toUpperCase() !== "NA"
    ) {
      const cacheKey = `${mod}|${implementacionId}`;
      const moduleId = cache.modulos.get(cacheKey);
      if (moduleId) {
        creationPromises.push(
          api.post("/modulo-progreso-registros", {
            data: {
              participacion: participationId,
              modulo: moduleId,
              calificacion: Number(row[mod]),
            },
          }),
        );
      }
    }
  }

  for (const key of ["encuesta_inicial", "encuesta_final"] as const) {
    const val = row[key];
    if (typeof val === "string" && val.toUpperCase() !== "NA") {
      const encId = cache.encuestas.get(key);
      if (encId) {
        creationPromises.push(
          api.post("/encuesta-completada-registros", {
            data: {
              participacion: participationId,
              encuesta: encId,
              estado: "Completada",
            },
          }),
        );
      }
    }
  }

  const attendanceFields = Object.keys(row).filter(
    (k) =>
      k.startsWith("asist_") || k.startsWith("trip") || k.startsWith("ses"),
  );
  for (const field of attendanceFields) {
    const val = row[field];
    if (typeof val === "string" && val.toUpperCase() !== "NA") {
      const cacheKey = `${field}|${implementacionId}`;
      const asisId = cache.asistencias.get(cacheKey);
      if (asisId) {
        creationPromises.push(
          api.post("/participante-asistencia-registros", {
            data: {
              participacion: participationId,
              asistencia: asisId,
              presente: true,
            },
          }),
        );
      }
    }
  }

  const workFields = Object.keys(row).filter(
    (k) => k.startsWith("trabajo") || k.startsWith("evidencia"),
  );
  for (const field of workFields) {
    const val = row[field];
    if (typeof val === "string" && val.toUpperCase() !== "NA") {
      const cacheKey = `${field}|${implementacionId}`;
      const jobId = cache.trabajos.get(cacheKey);
      if (jobId) {
        creationPromises.push(
          api.post("/trabajo-realizado-registros", {
            data: {
              participacion: participationId,
              trabajo: jobId,
              completado: true,
            },
          }),
        );
      }
    }
  }

  await Promise.allSettled(creationPromises);
  await handleParticipantEmail(row, participantId);
}

export const handler: S3Handler = async (event: S3Event) => {
  for (const r of event.Records) {
    const bucket = r.s3.bucket.name;
    const key = decodeURIComponent(r.s3.object.key);

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
      new GetObjectCommand({ Bucket: bucket, Key: key }),
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
  }
};
