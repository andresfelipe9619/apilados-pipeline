import {S3Event, S3Handler} from "aws-lambda";
import {S3Client} from "@aws-sdk/client-s3";
import axios, {AxiosInstance} from "axios";
import {
    EnvironmentConfig,
    ErrorReporter,
    ExecutionMode,
    LocalConfig,
    ProcessingConfig,
    SimulationResult,
} from "./types";
import {
    createLocalConfigFromEnv,
    createProcessingConfig,
    detectExecutionMode,
    loadEnvironmentConfig,
    logValidationResults,
    shouldUseLocalMode,
    validateConfiguration,
} from "./config";
import {formatError} from "./utils";
import {CacheManager} from "./cache";
import {EntityManager} from "./entities";
import {createFileInputHandler} from "./file-input-handlers";
import {createErrorReporter, createS3ErrorReporter} from "./error-reporter";
import {MigrationEngine} from "./migration-engine";

const s3 = new S3Client({});

// Global configuration - will be initialized in handler
let globalConfig: EnvironmentConfig;
let processingConfig: ProcessingConfig;

// API client - will be initialized with configuration
let api: AxiosInstance;

// Cache manager - will be initialized with API client
let cacheManager: CacheManager;

// Entity manager - will be initialized with API client and cache manager
let entityManager: EntityManager;


/**
 * Initialize configuration and components for data processing
 */
function initializeConfiguration(
    executionMode: ExecutionMode,
    localConfig?: LocalConfig,
): {
    api: AxiosInstance;
    cacheManager: CacheManager;
    entityManager: EntityManager;
    errorReporter: ErrorReporter;
} {
    // Load environment configuration
    globalConfig = loadEnvironmentConfig();

    // Create processing configuration
    processingConfig = createProcessingConfig();

    // Validate configuration
    const validation = validateConfiguration(
        executionMode,
        globalConfig,
        localConfig,
        processingConfig,
    );
    logValidationResults(validation, `${executionMode.toUpperCase()} Mode`);

    if (!validation.isValid) {
        throw new Error(
            `Configuration validation failed: ${validation.errors.join(", ")}`,
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

    // Initialize error reporter based on execution mode
    let errorReporter: ErrorReporter;
    if (executionMode === "aws") {
        // For AWS mode, use S3 error reporter
        const bucketName = process.env.BUCKET_NAME;
        if (bucketName) {
            errorReporter = createS3ErrorReporter(s3, bucketName);
        } else {
            console.warn("BUCKET_NAME not configured, using local error reporter");
            errorReporter = createErrorReporter("aws");
        }
    } else {
        // For local mode, use local file error reporter
        const outputPath = localConfig?.outputPath || "migration-errors.csv";
        errorReporter = createErrorReporter("local", outputPath);
    }

    console.log(`✅ Configuration initialized for ${executionMode} mode`);
    console.log(`   - Process Mode: ${processingConfig.processMode}`);
    console.log(`   - Omit GET: ${processingConfig.omitGet}`);
    console.log(`   - Batch Size: ${processingConfig.batchSize}`);
    console.log(`   - Chunk Size: ${processingConfig.chunkSize}`);

    return {
        api,
        cacheManager,
        entityManager,
        errorReporter,
    };
}

/**
 * Enhanced S3 handler with execution mode detection and processing engine integration
 * Maintains backward compatibility while adding new functionality
 * Supports both AWS S3 events and local execution via environment variables
 */
export const handler: S3Handler = async (event: S3Event): Promise<void> => {
    console.log("🚀 Starting enhanced migrator lambda execution");
    const startTime = Date.now();

    try {
        // Check if we should use local mode based on environment variables (migrator.js compatibility)
        let localConfig: LocalConfig | undefined;
        let executionMode: ExecutionMode;

        if (!event || !event.Records || event.Records.length === 0) {
            // No S3 event provided, check for local mode environment variables
            if (shouldUseLocalMode()) {
                const tempConfig = createLocalConfigFromEnv();
                if (tempConfig) {
                    localConfig = tempConfig;
                } else {
                    throw new Error(
                        "Failed to create local configuration from environment variables",
                    );
                }
                executionMode = "local";
                console.log(
                    "📋 Using local mode based on environment variables (migrator.js compatibility)",
                );
            } else {
                throw new Error(
                    "No S3 event provided and no local configuration found in environment variables",
                );
            }
        } else {
            // S3 event provided, use AWS mode
            executionMode = detectExecutionMode(event);
            console.log(`📋 Detected execution mode: ${executionMode}`);
        }

        // Initialize all components
        const {api, cacheManager, entityManager, errorReporter} =
            initializeConfiguration(executionMode, localConfig);

        // Create file input handler
        const fileHandler = createFileInputHandler(event, localConfig);
        console.log(
            `📁 File input handler created for ${fileHandler.getExecutionMode()} mode`,
        );

        // Create processing engine
        const migrationEngine = new MigrationEngine(
            api,
            cacheManager,
            entityManager,
            processingConfig,
            errorReporter,
        );

        // Get CSV streams from file handler
        const participationsCsv = await fileHandler.getParticipationsCsv();
        const cctsCsv = await fileHandler.getCctsCsv(); // Optional performance optimization

        // Execute data processing
        const result = await migrationEngine.processData(
            participationsCsv,
            cctsCsv || undefined,
        );

        const totalTime = Date.now() - startTime;
        console.log(
            `🎉 Lambda execution completed successfully in ${Math.round(totalTime / 1000)}s`,
        );
        console.log(
            `   → Migration result: ${result.successCount}/${result.totalRecords} successful`,
        );

        // Log success for AWS Lambda
        console.log(
            `✅ Lambda execution completed successfully in ${Math.round(totalTime / 1000)}s`,
        );
        console.log(
            `📊 Results: ${result.successCount} successful, ${result.errorCount} errors`,
        );
    } catch (error) {
        const errorMessage = formatError(error);
        const totalTime = Date.now() - startTime;

        console.error(
            `❌ Lambda execution failed after ${Math.round(totalTime / 1000)}s:`,
            errorMessage,
        );

        // Throw error for AWS Lambda to handle
        throw new Error(`Lambda execution failed: ${errorMessage}`);
    }
};

/**
 * Local execution function for testing and development
 * Allows running the lambda locally with CSV file paths
 */
export async function runLocal(
    outputPath?: string,
    configOverrides?: Partial<ProcessingConfig>,
): Promise<SimulationResult> {
    console.log("🚀 Starting local S3 event simulation execution");
    const startTime = Date.now();

    try {
        const localConfig: LocalConfig = {
            outputPath,
        };

        // Detect execution mode (should be local)
        const executionMode = detectExecutionMode(undefined, localConfig);
        console.log(`📋 Detected execution mode: ${executionMode}`);

        // Initialize all components
        const {api, cacheManager, entityManager, errorReporter} =
            initializeConfiguration(executionMode, localConfig);

        // Override processing config if provided
        if (configOverrides) {
            Object.assign(processingConfig, configOverrides);
            console.log("⚙️  Processing configuration overridden:", configOverrides);
        }

        // Create file input handler
        const fileHandler = createFileInputHandler(undefined, localConfig);
        console.log(
            `📁 File input handler created for ${fileHandler.getExecutionMode()} mode`,
        );

        // Create simulation engine
        const migrationEngine = new MigrationEngine(
            api,
            cacheManager,
            entityManager,
            processingConfig,
            errorReporter,
        );

        // Get CSV streams from file handler
        const participationsCsv = await fileHandler.getParticipationsCsv();
        const cctsCsv = await fileHandler.getCctsCsv(); // Optional performance optimization

        // Execute data processing
        const result = await migrationEngine.processData(
            participationsCsv,
            cctsCsv || undefined,
        );

        const totalTime = Date.now() - startTime;
        console.log(
            `🎉 Local execution completed successfully in ${Math.round(totalTime / 1000)}s`,
        );
        console.log(
            `   → Migration result: ${result.successCount}/${result.totalRecords} successful`,
        );

        return result;
    } catch (error) {
        const errorMessage = formatError(error);
        const totalTime = Date.now() - startTime;

        console.error(
            `❌ Local execution failed after ${Math.round(totalTime / 1000)}s:`,
            errorMessage,
        );
        throw new Error(`Local execution failed: ${errorMessage}`);
    }
}
