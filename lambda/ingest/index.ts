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
const cache = {
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
const toBoolean = (value) => {
  if (typeof value !== "string") return !!value;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1";
};

const normalizeHeaders = ({ header }: { header: string }) =>
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
  localCache: { set: (arg0: any, arg1: any) => void },
) {
  console.log(
    `[CACHE] descargando todas las entidades ${endpoint} por páginas…`,
  );
  let page = 1;
  const pageSize = 1000;
  while (true) {
    const { data: res } = await api.get(
      `/${endpoint}?pagination[page]=${page}&pagination[pageSize]=${pageSize}&fields=id,${fieldName}`,
    );
    if (!res.data.length) break;
    for (const ent of res.data) {
      localCache.set(ent[fieldName], ent.id);
    }
    page++;
  }
}

async function getOrCreate(
  endpoint: string,
  filters: { [s: string]: unknown } | ArrayLike<unknown>,
  createData: any,
  localCache: {
    has: (arg0: any) => any;
    get: (arg0: any) => any;
    set: (arg0: any, arg1: any) => void;
  },
  cacheKey: any,
) {
  if (cacheKey && localCache.has(cacheKey)) {
    return localCache.get(cacheKey);
  }
  let qs = "";
  if ((OMMIT_GET && endpoint !== "participantes") || !OMMIT_GET) {
    qs = Object.entries(filters)
      .map(([k, v]) => `filters[${k}][$eq]=${encodeURIComponent(v)}`)
      .join("&");
    const { data: getRes } = await api.get(
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
    const { data: postRes } = await api.post(`/${endpoint}`, {
      data: createData,
    });
    const newId = postRes.data.id;
    if (cacheKey) localCache.set(cacheKey, newId);
    return newId;
  } catch (error) {
    if (error.response?.data?.error?.message.includes("unique constraint")) {
      console.warn(
        `[WARN] Condición de carrera para ${endpoint}. Re-intentando búsqueda...`,
      );
      const { data: refetchRes } = await api.get(
        `/${endpoint}?${qs}&pagination[limit]=1`,
      );
      if (refetchRes.data.length > 0) {
        const id = refetchRes.data[0].id;
        if (cacheKey) localCache.set(cacheKey, id);
        return id;
      }
    }
    throw error;
  }
}

export const handler: S3Handler = async (event: S3Event) => {
  for (const r of event.Records) {
    const bucket = r.s3.bucket.name;
    const key = decodeURIComponent(r.s3.object.key);

    const records = [];
    const unique = {
      ccts: new Set(),
      programas: new Set(),
      implementaciones: new Map(),
      asistenciaFields: new Set(),
      asistenciaModalities: new Map(),
      trabajoFields: new Set(),
    };

    // fetch object
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );

    await new Promise((resolve, reject) => {
      (obj.Body as Readable)
        .pipe(csvParser({ mapHeaders: normalizeHeaders }))
        .on("data", (row) => {
          records.push(row);
          // CCTS y programas
          if (row.cct) unique.ccts.add(row.cct);
          if (row.programa) unique.programas.add(row.programa);
          // Implementaciones
          if (
            row.implementacion &&
            row.ciclo_escolar &&
            row.periodo_de_implementacion
          ) {
            const key = `${row.implementacion}|${row.ciclo_escolar}|${row.periodo_de_implementacion}`;
            if (!unique.implementaciones.has(key)) {
              unique.implementaciones.set(key, {
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
              const modVal = row[modKey]?.trim();
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
        .on("end", resolve)
        .on("error", reject);
    });
  }
};
