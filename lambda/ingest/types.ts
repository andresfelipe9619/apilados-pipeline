/**
 * Enhanced TypeScript types and interfaces for migrator-lambda integration
 * Supports both local testing and AWS S3 event processing modes
 */

import { Readable } from "node:stream";
import { S3Event } from "aws-lambda";

// --- PRIMITIVE AND UTILITY TYPES ---

export type Primitive = string | number | boolean | null | undefined;
export type Dict<T = unknown> = Record<string, T>;

// --- EXECUTION MODE TYPES ---

export type ExecutionMode = "aws" | "local";
export type EnvironmentType = "local" | "production";

export interface LocalConfig {
  participationsCsvPath: string;
  cctsCsvPath?: string;
  outputPath?: string;
}

export interface ProcessingConfig {
  processMode: "parallel" | "sequential";
  omitGet: boolean;
  batchSize: number;
  chunkSize: number;
}

export interface EnvironmentConfig {
  strapiBaseUrl: string;
  strapiToken: string;
  processMode: "parallel" | "sequential";
  omitGet: boolean;
  batchSize: number;
  chunkSize: number;
}

export interface CCTsConfig {
  localPath?: string;
  s3Bucket?: string;
  s3Key?: string;
  environment: EnvironmentType;
}

export interface EnhancedEnvironmentConfig {
  type: EnvironmentType;
  strapi: EnvironmentConfig;
  database?: DatabaseConfig;
  ccts: CCTsConfig;
  aws?: {
    region: string;
    bucket: string;
  };
}

// --- CSV DATA TYPES ---

export interface CsvRow {
  cct?: string;
  programa?: string;
  implementacion?: string;
  ciclo_escolar?: string;
  periodo_de_implementacion?: string;
  [key: string]: Primitive;
}

export interface BaseParticipantCsv {
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
  cct?: string;
  implementacion?: string;
  ciclo_escolar?: string;
  periodo_de_implementacion?: string;
}

export interface ParticipationCsvExtras {
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
  [key: string]: Primitive;
}

export interface EmailField {
  email?: string | null | undefined;
}

export type ParticipantCsvRow = BaseParticipantCsv & ParticipationCsvExtras & EmailField;

// --- CACHE STRUCTURE TYPES ---

export interface CacheMaps {
  programas: Map<string, number>;
  ccts: Map<string, number>;
  participantes: Map<string, number>;
  implementaciones: Map<string, number>;
  modulos: Map<string, number>;
  encuestas: Map<string, number>;
  asistencias: Map<string, number>;
  trabajos: Map<string, number>;
}

export interface UniqueSets {
  ccts: Set<string>;
  programas: Set<string>;
  implementaciones: Map<string, {
    nombre: string | undefined;
    ciclo_escolar: string | undefined;
    periodo: string | undefined;
    programa: string | undefined;
  }>;
  asistenciaFields: Set<string>;
  asistenciaModalities: Map<string, string>;
  trabajoFields: Set<string>;
}

// --- PROCESSING RESULT TYPES ---

export interface MigrationResult {
  successCount: number;
  errorCount: number;
  processingTime: number;
  errorCsvPath?: string;
  totalRecords: number;
}

export interface ProcessingStats {
  recordsProcessed: number;
  successCount: number;
  errorCount: number;
  startTime: number;
  endTime?: number;
}

export interface ErrorRecord {
  participantId: string;
  email: string;
  error: string;
  rowNumber?: number;
}

// --- COMPONENT INTERFACES ---

/**
 * Abstraction layer for file input handling
 * Supports both S3 and local file system sources
 */
export interface FileInputHandler {
  /**
   * Get the participations CSV file as a readable stream
   */
  getParticipationsCsv(): Promise<Readable>;
  
  /**
   * Get the CCTs CSV file as a readable stream (optional)
   */
  getCctsCsv(): Promise<Readable | null>;
  
  /**
   * Get execution mode for this handler
   */
  getExecutionMode(): ExecutionMode;
}

/**
 * Error handling and reporting interface
 */
export interface ErrorReporter {
  /**
   * Log an error for a specific participant
   */
  logError(participantId: string, email: string, error: string, rowNumber?: number): void;
  
  /**
   * Get all logged errors
   */
  getErrors(): ErrorRecord[];
  
  /**
   * Generate CSV content for error report
   */
  generateErrorCsv(): string;
  
  /**
   * Save error report to file or S3
   */
  saveErrorReport(outputPath?: string): Promise<string>;
  
  /**
   * Get error count
   */
  getErrorCount(): number;
}

/**
 * Core migration engine interface
 */
export interface MigrationEngine {
  /**
   * Process CSV data through the three-phase pipeline
   */
  processData(
    participationsCsv: Readable,
    cctsCsv?: Readable,
    config?: ProcessingConfig
  ): Promise<MigrationResult>;
  
  /**
   * Initialize cache and pre-load entities
   */
  initializeCache(): Promise<void>;
  
  /**
   * Get current cache state
   */
  getCache(): CacheMaps;
  
  /**
   * Get processing statistics
   */
  getStats(): ProcessingStats;
}

// --- STRAPI API TYPES ---

export interface StrapiResponse<T = unknown> {
  data: T;
  meta?: {
    pagination?: {
      page: number;
      pageSize: number;
      pageCount: number;
      total: number;
    };
  };
}

export interface StrapiEntity {
  id: number;
  [key: string]: unknown;
}

export interface StrapiCreateResponse<T = unknown> {
  data: T & StrapiEntity;
}

export interface StrapiListResponse<T = unknown> {
  data: Array<T & StrapiEntity>;
  meta: {
    pagination: {
      page: number;
      pageSize: number;
      pageCount: number;
      total: number;
    };
  };
}

// --- ENTITY CREATION DATA TYPES ---

export interface ProgramaCreateData {
  nombre: string;
}

export interface ImplementacionCreateData {
  nombre: string;
  ciclo_escolar: string;
  periodo: string;
  programa: number;
  encuestas: number[];
}

export interface ParticipanteCreateData {
  id_externo: string;
  edad?: number | null;
  sexo?: string;
  telefono?: string;
  curp?: string;
  rfc?: string;
  nombre?: string;
  primer_apellido?: string;
  segundo_apellido?: string;
  nombre_completo?: string;
  entidad?: string;
  estado_civil?: string | null;
  lengua_indigena?: boolean;
  hablante_maya?: boolean;
  nivel_educativo?: string | null;
  cct?: number | null;
}

export interface ParticipacionCreateData {
  participante: number;
  implementacion: number;
  puesto?: string;
  puesto_detalle?: string;
  antiguedad?: string;
  estudiantes_a_cargo?: number | null;
  turno?: string;
  participa_director?: boolean;
  cct_verificado?: boolean;
  obtuvo_constancia?: boolean;
  involucramiento?: string;
  promedio_modulos?: string;
}

export interface ModuloCreateData {
  nombre: string;
  implementacion: number;
}

export interface AsistenciaCreateData {
  clave_sesion: string;
  modalidad?: string | null;
  implementacion: number;
}

export interface TrabajoCreateData {
  nombre: string;
  implementacion: number;
}

export interface UsoAppCreateData {
  participante: number;
  minutos_uso_app: number;
  descargo_app: boolean;
}

export interface CorreoParticipanteCreateData {
  participante: number;
  correo: string;
  principal: boolean;
}

// --- FACTORY AND UTILITY TYPES ---

export interface FileInputHandlerFactory {
  create(event?: S3Event, localConfig?: LocalConfig): FileInputHandler;
}

export interface ExecutionModeDetector {
  detect(event?: S3Event, localConfig?: LocalConfig): ExecutionMode;
}

// --- LOCAL TESTING TYPES ---

export interface LocalTestRunner {
  runWithCsv(csvPath: string, config?: ProcessingConfig, cctsCsvPath?: string): Promise<MigrationResult>;
  validateEnvironment(): boolean;
  generateTestReport(): TestReport;
}

export interface TestReport {
  environment: EnvironmentConfig;
  processingConfig: ProcessingConfig;
  result: MigrationResult;
  errors: ErrorRecord[];
  timestamp: string;
}

// --- AWS LAMBDA TYPES ---

export interface LambdaContext {
  executionMode: ExecutionMode;
  config: EnvironmentConfig;
  fileHandler: FileInputHandler;
  errorReporter: ErrorReporter;
  migrationEngine: MigrationEngine;
}

// --- DATABASE DUMP TYPES ---

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl?: boolean;
}

export interface DumpOptions {
  outputPath?: string;
  timestamp?: boolean;
  compress?: boolean;
  dumpOnly?: boolean;
}

export interface DumpResult {
  success: boolean;
  filePath: string;
  fileSize: number;
  duration: number;
  error?: string;
}

export interface DatabaseConnectionTest {
  success: boolean;
  error?: string;
  connectionTime?: number;
}

// --- VALIDATION TYPES ---

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ConfigValidator {
  validateEnvironmentConfig(config: Partial<EnvironmentConfig>): ValidationResult;
  validateLocalConfig(config: Partial<LocalConfig>): ValidationResult;
  validateProcessingConfig(config: Partial<ProcessingConfig>): ValidationResult;
  validateDatabaseConfig(config: Partial<DatabaseConfig>): ValidationResult;
  validateCCTsConfig(config: Partial<CCTsConfig>): ValidationResult;
  validateEnhancedEnvironmentConfig(config: Partial<EnhancedEnvironmentConfig>): ValidationResult;
}