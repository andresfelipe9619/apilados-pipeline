/**
 * Database dump module with PostgreSQL support
 * Provides database backup capabilities with connection validation and error handling
 */

import { spawn } from "child_process";
import { existsSync, mkdirSync, statSync, accessSync, constants } from "fs";
import { resolve, dirname } from "path";
import { DatabaseConfig, DumpOptions, DumpResult, DatabaseConnectionTest } from "./types";
import { 
  getRequiredDatabaseEnvironmentVariables, 
  getOptionalDatabaseEnvironmentVariables,
  loadDatabaseConfig,
  validateDatabaseEnvironmentVariables
} from "./database-config";

/**
 * PostgreSQL database dumper with connection validation and error handling
 */
export class DatabaseDumper {
  private config: DatabaseConfig;

  constructor(config?: DatabaseConfig) {
    this.config = config || this.loadDatabaseConfigFromEnv();
  }

  /**
   * Load database configuration from environment variables
   */
  private loadDatabaseConfigFromEnv(): DatabaseConfig {
    const config = loadDatabaseConfig();
    if (!config) {
      const requiredVars = getRequiredDatabaseEnvironmentVariables();
      throw new Error(`Missing required database environment variables: ${requiredVars.join(', ')}`);
    }
    return config;
  }

  /**
   * Validate database connection
   */
  async validateConnection(config?: DatabaseConfig): Promise<DatabaseConnectionTest> {
    const dbConfig = config || this.config;
    const startTime = Date.now();

    return new Promise((resolve) => {
      // Use pg_isready for connection validation
      const args = [
        '-h', dbConfig.host,
        '-p', dbConfig.port.toString(),
        '-d', dbConfig.database,
        '-U', dbConfig.username
      ];

      const pgIsReady = spawn('pg_isready', args, {
        env: {
          ...process.env,
          PGPASSWORD: dbConfig.password
        }
      });

      let output = '';
      let errorOutput = '';

      pgIsReady.stdout.on('data', (data) => {
        output += data.toString();
      });

      pgIsReady.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      pgIsReady.on('close', (code) => {
        const connectionTime = Date.now() - startTime;
        
        if (code === 0) {
          resolve({
            success: true,
            connectionTime
          });
        } else {
          resolve({
            success: false,
            error: errorOutput || output || `Connection failed with exit code ${code}`,
            connectionTime
          });
        }
      });

      pgIsReady.on('error', (error) => {
        resolve({
          success: false,
          error: `Failed to execute pg_isready: ${error.message}. Make sure PostgreSQL client tools are installed.`
        });
      });
    });
  }

  /**
   * Create database dump with comprehensive error handling and progress feedback
   */
  async createDump(options: DumpOptions = {}, progressCallback?: (message: string) => void): Promise<DumpResult> {
    const startTime = Date.now();
    const progress = progressCallback || (() => {});

    try {
      progress("🔍 Validating database connection...");
      
      // Validate connection first
      const connectionTest = await this.validateConnection();
      if (!connectionTest.success) {
        return {
          success: false,
          filePath: '',
          fileSize: 0,
          duration: Date.now() - startTime,
          error: this.formatConnectionError(connectionTest.error || 'Unknown connection error')
        };
      }

      progress(`✅ Database connection validated (${connectionTest.connectionTime}ms)`);

      // Generate dump file path
      const filePath = this.generateDumpFileName(options);
      progress(`📁 Dump file path: ${filePath}`);
      
      // Validate output directory and permissions
      const outputDir = dirname(filePath);
      const dirValidation = await this.validateOutputDirectory(outputDir);
      if (!dirValidation.success) {
        return {
          success: false,
          filePath: '',
          fileSize: 0,
          duration: Date.now() - startTime,
          error: dirValidation.error
        };
      }

      progress(`📂 Output directory validated: ${outputDir}`);

      // Check available disk space
      const spaceValidation = await this.validateDiskSpace(outputDir);
      if (!spaceValidation.success) {
        return {
          success: false,
          filePath: '',
          fileSize: 0,
          duration: Date.now() - startTime,
          error: spaceValidation.error
        };
      }

      progress(`💾 Disk space validated: ${spaceValidation.availableGB?.toFixed(2)} GB available`);

      // Check if file already exists and handle accordingly
      if (existsSync(filePath)) {
        const backupPath = this.createBackupFileName(filePath);
        progress(`⚠️  File exists, creating backup: ${backupPath}`);
      }

      progress("🚀 Starting database dump...");
      
      // Execute pg_dump with progress monitoring
      await this.executePgDump(filePath, options, progress);

      // Get file size and validate dump was created
      if (!existsSync(filePath)) {
        return {
          success: false,
          filePath: '',
          fileSize: 0,
          duration: Date.now() - startTime,
          error: "Dump file was not created. Check pg_dump output for errors."
        };
      }

      const fileSize = statSync(filePath).size;
      const duration = Date.now() - startTime;

      progress(`✅ Dump completed successfully!`);
      progress(`📊 File size: ${this.formatFileSize(fileSize)}`);
      progress(`⏱️  Duration: ${this.formatDuration(duration)}`);

      return {
        success: true,
        filePath,
        fileSize,
        duration
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        filePath: '',
        fileSize: 0,
        duration: Date.now() - startTime,
        error: this.formatDumpError(errorMessage)
      };
    }
  }

  /**
   * Generate dump file name with optional timestamp
   */
  private generateDumpFileName(options: DumpOptions): string {
    const baseDir = options.outputPath || './dumps';
    const timestamp = options.timestamp !== false ? new Date().toISOString().replace(/[:.]/g, '-') : '';
    const extension = options.compress ? '.sql.gz' : '.sql';
    
    let fileName = `${this.config.database}_dump`;
    if (timestamp) {
      fileName += `_${timestamp}`;
    }
    fileName += extension;

    return resolve(baseDir, fileName);
  }

  /**
   * Execute pg_dump command with progress monitoring
   */
  private async executePgDump(outputPath: string, options: DumpOptions, progressCallback?: (message: string) => void): Promise<void> {
    const progress = progressCallback || (() => {});
    
    return new Promise((resolve, reject) => {
      const args = [
        '--host', this.config.host,
        '--port', this.config.port.toString(),
        '--username', this.config.username,
        '--dbname', this.config.database,
        '--verbose',
        '--clean',
        '--if-exists',
        '--create',
        '--format=custom',
        '--no-password'
      ];

      // Add compression if requested
      if (options.compress) {
        args.push('--compress=9');
        progress("🗜️  Compression enabled (level 9)");
      }

      // Add output file
      args.push('--file', outputPath);

      progress(`🔧 Executing: pg_dump ${args.filter(arg => !this.config.password || arg !== this.config.password).join(' ')}`);

      const pgDump = spawn('pg_dump', args, {
        env: {
          ...process.env,
          PGPASSWORD: this.config.password
        }
      });

      let errorOutput = '';
      let lastProgressTime = Date.now();

      pgDump.stderr.on('data', (data) => {
        const output = data.toString();
        
        // Show progress updates every 5 seconds
        const now = Date.now();
        if (now - lastProgressTime > 5000) {
          progress("⏳ Dump in progress...");
          lastProgressTime = now;
        }
        
        // Capture actual errors (not just verbose output)
        if (output.toLowerCase().includes('error') || output.toLowerCase().includes('fatal')) {
          errorOutput += output;
        }
      });

      pgDump.stdout.on('data', (data) => {
        // pg_dump in custom format doesn't write to stdout, but just in case
        const output = data.toString();
        if (output.trim()) {
          progress(`📝 ${output.trim()}`);
        }
      });

      pgDump.on('close', (code) => {
        if (code === 0) {
          progress("✅ pg_dump completed successfully");
          resolve();
        } else {
          const errorMsg = this.formatPgDumpError(code || -1, errorOutput);
          reject(new Error(errorMsg));
        }
      });

      pgDump.on('error', (error) => {
        const errorMsg = this.formatPgDumpExecutionError(error);
        reject(new Error(errorMsg));
      });
    });
  }

  /**
   * Get database configuration (without password for logging)
   */
  getConfigSummary(): Omit<DatabaseConfig, 'password'> {
    const { password, ...configWithoutPassword } = this.config;
    return configWithoutPassword;
  }

  /**
   * Validate output directory permissions and create if needed
   */
  private async validateOutputDirectory(outputDir: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Create directory if it doesn't exist
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      // Check write permissions
      accessSync(outputDir, constants.W_OK);
      
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('EACCES') || errorMessage.includes('EPERM')) {
        return {
          success: false,
          error: `Permission denied: Cannot write to directory '${outputDir}'. Please check directory permissions or choose a different output path.`
        };
      } else if (errorMessage.includes('ENOENT')) {
        return {
          success: false,
          error: `Cannot create directory '${outputDir}'. Please check the parent directory exists and you have write permissions.`
        };
      } else {
        return {
          success: false,
          error: `Directory validation failed: ${errorMessage}`
        };
      }
    }
  }

  /**
   * Validate available disk space
   */
  private async validateDiskSpace(outputDir: string): Promise<{ success: boolean; error?: string; availableGB?: number }> {
    try {
      const { execSync } = require('child_process');
      
      // Use df command to check disk space (cross-platform)
      const dfOutput = execSync(`df -h "${outputDir}"`, { encoding: 'utf8' });
      const lines = dfOutput.trim().split('\n');
      
      if (lines.length >= 2) {
        const spaceInfo = lines[1].split(/\s+/);
        const availableStr = spaceInfo[3] || spaceInfo[2]; // Different df formats
        
        // Parse available space (could be in various formats like 1.5G, 500M, etc.)
        const match = availableStr.match(/^(\d+(?:\.\d+)?)([KMGT]?)$/);
        if (match) {
          let availableGB = parseFloat(match[1]);
          const unit = match[2];
          
          // Convert to GB
          switch (unit) {
            case 'K': availableGB /= 1024 * 1024; break;
            case 'M': availableGB /= 1024; break;
            case 'T': availableGB *= 1024; break;
            // G or no unit is already in GB
          }
          
          // Warn if less than 1GB available
          if (availableGB < 1) {
            return {
              success: false,
              error: `Insufficient disk space: Only ${availableGB.toFixed(2)}GB available. Database dumps can be large - ensure you have adequate free space.`,
              availableGB
            };
          }
          
          return { success: true, availableGB };
        }
      }
      
      // If we can't parse df output, just continue (don't block the operation)
      return { success: true };
    } catch (error) {
      // If disk space check fails, log warning but don't block the operation
      console.warn(`Warning: Could not check disk space: ${error}`);
      return { success: true };
    }
  }

  /**
   * Create backup filename for existing files
   */
  private createBackupFileName(originalPath: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = originalPath.endsWith('.gz') ? '.sql.gz' : '.sql';
    const baseName = originalPath.replace(ext, '');
    return `${baseName}_backup_${timestamp}${ext}`;
  }

  /**
   * Format file size in human-readable format
   */
  private formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Format connection error with recovery suggestions
   */
  private formatConnectionError(error: string): string {
    let formattedError = `Database connection failed: ${error}\n\n`;
    formattedError += "Recovery suggestions:\n";
    formattedError += "1. Verify database server is running and accessible\n";
    formattedError += "2. Check DATABASE_HOST and DATABASE_PORT environment variables\n";
    formattedError += "3. Verify DATABASE_USERNAME and DATABASE_PASSWORD are correct\n";
    formattedError += "4. Ensure DATABASE_NAME exists on the server\n";
    formattedError += "5. Check network connectivity and firewall settings\n";
    formattedError += "6. For SSL connections, verify SSL configuration\n";
    
    if (error.includes('timeout')) {
      formattedError += "7. Connection timeout - check if database server is overloaded\n";
    }
    
    if (error.includes('authentication')) {
      formattedError += "7. Authentication failed - verify username and password\n";
    }
    
    return formattedError;
  }

  /**
   * Format pg_dump error with recovery suggestions
   */
  private formatPgDumpError(exitCode: number, errorOutput: string): string {
    let formattedError = `pg_dump failed with exit code ${exitCode}`;
    
    if (errorOutput) {
      formattedError += `:\n${errorOutput}\n`;
    } else {
      formattedError += "\n";
    }
    
    formattedError += "\nRecovery suggestions:\n";
    
    switch (exitCode) {
      case 1:
        formattedError += "1. Check database connection parameters\n";
        formattedError += "2. Verify user has sufficient privileges to read database\n";
        formattedError += "3. Ensure database exists and is accessible\n";
        break;
      case 2:
        formattedError += "1. Check command line arguments and options\n";
        formattedError += "2. Verify output file path is writable\n";
        break;
      default:
        formattedError += "1. Check PostgreSQL server logs for detailed error information\n";
        formattedError += "2. Verify database is not in use by other processes\n";
        formattedError += "3. Ensure sufficient disk space for the dump file\n";
    }
    
    formattedError += "4. Try running pg_dump manually to diagnose the issue\n";
    formattedError += "5. Check PostgreSQL client version compatibility\n";
    
    return formattedError;
  }

  /**
   * Format pg_dump execution error with recovery suggestions
   */
  private formatPgDumpExecutionError(error: Error): string {
    let formattedError = `Failed to execute pg_dump: ${error.message}\n\n`;
    formattedError += "Recovery suggestions:\n";
    formattedError += "1. Install PostgreSQL client tools:\n";
    formattedError += "   - macOS: brew install postgresql\n";
    formattedError += "   - Ubuntu/Debian: sudo apt-get install postgresql-client\n";
    formattedError += "   - CentOS/RHEL: sudo yum install postgresql\n";
    formattedError += "2. Ensure pg_dump is in your system PATH\n";
    formattedError += "3. Verify PostgreSQL client tools are properly installed\n";
    formattedError += "4. Try running 'pg_dump --version' to test installation\n";
    
    return formattedError;
  }

  /**
   * Format general dump error with recovery suggestions
   */
  private formatDumpError(error: string): string {
    let formattedError = `Database dump failed: ${error}\n\n`;
    formattedError += "Recovery suggestions:\n";
    formattedError += "1. Check database connection and credentials\n";
    formattedError += "2. Verify sufficient disk space in output directory\n";
    formattedError += "3. Ensure output directory has write permissions\n";
    formattedError += "4. Check PostgreSQL client tools are installed\n";
    formattedError += "5. Try with different dump options (e.g., without compression)\n";
    formattedError += "6. Check system resources (memory, CPU)\n";
    
    return formattedError;
  }

  /**
   * Check if PostgreSQL client tools are available
   */
  static async checkPgToolsAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const pgDump = spawn('pg_dump', ['--version']);
      
      pgDump.on('close', (code) => {
        resolve(code === 0);
      });

      pgDump.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Get required environment variables for database configuration
   */
  static getRequiredEnvironmentVariables(): string[] {
    return getRequiredDatabaseEnvironmentVariables();
  }

  /**
   * Get optional environment variables for database configuration
   */
  static getOptionalEnvironmentVariables(): Record<string, string> {
    return getOptionalDatabaseEnvironmentVariables();
  }

  /**
   * Validate environment variables for database configuration
   */
  static validateEnvironmentVariables(): { isValid: boolean; errors: string[]; warnings: string[] } {
    return validateDatabaseEnvironmentVariables();
  }
}

/**
 * Utility function to create a DatabaseDumper instance from environment
 */
export function createDatabaseDumperFromEnv(): DatabaseDumper {
  return new DatabaseDumper();
}

/**
 * Utility function to perform a quick database connection test
 */
export async function testDatabaseConnection(config?: DatabaseConfig): Promise<DatabaseConnectionTest> {
  const dumper = new DatabaseDumper(config);
  return dumper.validateConnection();
}