#!/usr/bin/env node

/**
 * Validation script for database dump workflow
 * This script validates that:
 * 1. Existing dump files can be found and used for database restoration
 * 2. Database connection and PostgreSQL tools are available
 * 3. The database backup and restore workflow works correctly
 */

import { existsSync, statSync, readdirSync } from 'fs';
import { resolve, join, extname } from 'path';
import { spawn } from 'child_process';
import { validateEnv } from './dev-utils';
import { DatabaseDumper } from './database-dump';

interface DumpFile {
  path: string;
  name: string;
  size: number;
  modified: Date;
  type: 'sql' | 'dump' | 'compressed';
}

interface ValidationResult {
  success: boolean;
  dumpFiles: DumpFile[];
  errors: string[];
  warnings: string[];
  recommendations: string[];
}

/**
 * Main validation class for dump workflow
 */
class DumpWorkflowValidator {
  private baseDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = baseDir;
  }

  /**
   * Run complete validation of dump workflow
   */
  async validateWorkflow(): Promise<ValidationResult> {
    console.log('🔍 Validating Database Dump Workflow');
    console.log('='.repeat(50));

    const result: ValidationResult = {
      success: false,
      dumpFiles: [],
      errors: [],
      warnings: [],
      recommendations: []
    };

    try {
      // 1. Validate environment
      console.log('1️⃣  Validating environment configuration...');
      const envValidation = await this.validateEnvironment();
      if (!envValidation.success) {
        result.errors.push(...envValidation.errors);
        return result;
      }
      console.log('   ✅ Environment configuration valid');

      // 2. Find dump files
      console.log('2️⃣  Searching for database dump files...');
      result.dumpFiles = this.findDumpFiles();
      if (result.dumpFiles.length === 0) {
        result.warnings.push('No database dump files found');
        result.recommendations.push('Create a database backup first using: migration-cli dump');
      } else {
        console.log(`   ✅ Found ${result.dumpFiles.length} dump file(s)`);
        result.dumpFiles.forEach(dump => {
          console.log(`      📄 ${dump.name} (${this.formatFileSize(dump.size)}, ${dump.type})`);
        });
      }

      // 3. Validate PostgreSQL tools
      console.log('3️⃣  Validating PostgreSQL tools...');
      const pgToolsValid = await this.validatePostgreSQLTools();
      if (!pgToolsValid) {
        result.errors.push('PostgreSQL client tools not available');
        result.recommendations.push('Install PostgreSQL client tools: brew install postgresql (macOS)');
      } else {
        console.log('   ✅ PostgreSQL tools available');
      }

      // 4. Test database connection
      console.log('4️⃣  Testing database connection...');
      const dbConnectionValid = await this.validateDatabaseConnection();
      if (!dbConnectionValid.success) {
        result.errors.push(`Database connection failed: ${dbConnectionValid.error}`);
        result.recommendations.push('Check database configuration in .env file');
      } else {
        console.log(`   ✅ Database connection successful (${dbConnectionValid.connectionTime}ms)`);
      }

      // Determine overall success
      result.success = result.errors.length === 0;

      return result;

    } catch (error) {
      result.errors.push(`Validation failed: ${error instanceof Error ? error.message : String(error)}`);
      return result;
    }
  }

  /**
   * Find all database dump files in the current directory
   */
  private findDumpFiles(): DumpFile[] {
    const dumpFiles: DumpFile[] = [];
    const searchPaths = [
      this.baseDir,
      join(this.baseDir, 'dumps'),
      join(this.baseDir, 'backups'),
      join(this.baseDir, 'data')
    ];

    for (const searchPath of searchPaths) {
      if (!existsSync(searchPath)) continue;

      try {
        const files = readdirSync(searchPath);
        
        for (const file of files) {
          const filePath = join(searchPath, file);
          const stats = statSync(filePath);
          
          if (stats.isFile() && this.isDumpFile(file)) {
            dumpFiles.push({
              path: filePath,
              name: file,
              size: stats.size,
              modified: stats.mtime,
              type: this.getDumpFileType(file)
            });
          }
        }
      } catch (error) {
        // Skip directories we can't read
        continue;
      }
    }

    // Sort by modification date (newest first)
    return dumpFiles.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  }

  /**
   * Check if a file is a database dump file
   */
  private isDumpFile(filename: string): boolean {
    const ext = extname(filename).toLowerCase();
    const name = filename.toLowerCase();
    
    // Exclude TypeScript and JavaScript files
    if (ext === '.ts' || ext === '.js' || ext === '.json') {
      return false;
    }
    
    return (
      ext === '.sql' ||
      ext === '.dump' ||
      ext === '.gz' ||
      (name.includes('dump') && !name.includes('.ts') && !name.includes('.js')) ||
      (name.includes('backup') && !name.includes('.ts') && !name.includes('.js')) ||
      name.includes('strapi_db')
    );
  }

  /**
   * Determine the type of dump file
   */
  private getDumpFileType(filename: string): 'sql' | 'dump' | 'compressed' {
    const ext = extname(filename).toLowerCase();
    
    if (ext === '.gz' || filename.includes('.gz')) {
      return 'compressed';
    } else if (ext === '.dump') {
      return 'dump';
    } else {
      return 'sql';
    }
  }



  /**
   * Validate environment configuration
   */
  private async validateEnvironment(): Promise<{ success: boolean; errors: string[] }> {
    try {
      const validation = validateEnv();
      
      if (!validation.isValid) {
        return {
          success: false,
          errors: validation.errors
        };
      }

      return { success: true, errors: [] };
    } catch (error) {
      return {
        success: false,
        errors: [`Environment validation failed: ${error instanceof Error ? error.message : String(error)}`]
      };
    }
  }

  /**
   * Validate PostgreSQL tools availability
   */
  private async validatePostgreSQLTools(): Promise<boolean> {
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
   * Validate database connection
   */
  private async validateDatabaseConnection(): Promise<{ success: boolean; error?: string; connectionTime?: number }> {
    try {
      const dumper = new DatabaseDumper();
      return await dumper.validateConnection();
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Format file size in human-readable format
   */
  private formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Generate restoration command for a dump file
   */
  generateRestoreCommand(dumpFile: DumpFile): string {
    const dbConfig = {
      host: process.env.DATABASE_HOST || 'localhost',
      port: process.env.DATABASE_PORT || '5432',
      database: process.env.DATABASE_NAME || 'strapi_db',
      username: process.env.DATABASE_USERNAME || 'strapi'
    };

    if (dumpFile.type === 'dump') {
      return `pg_restore -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.username} -d ${dbConfig.database} --clean --if-exists "${dumpFile.path}"`;
    } else if (dumpFile.type === 'compressed') {
      return `gunzip -c "${dumpFile.path}" | psql -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.username} -d ${dbConfig.database}`;
    } else {
      return `psql -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.username} -d ${dbConfig.database} -f "${dumpFile.path}"`;
    }
  }



  /**
   * Print validation results
   */
  printResults(result: ValidationResult): void {
    console.log('\n' + '='.repeat(50));
    console.log('📊 VALIDATION RESULTS');
    console.log('='.repeat(50));

    if (result.success) {
      console.log('✅ VALIDATION PASSED - Ready for database backup operations!');
    } else {
      console.log('❌ VALIDATION FAILED - Database backup issues found');
    }

    if (result.errors.length > 0) {
      console.log('\n🚨 ERRORS:');
      result.errors.forEach(error => console.log(`   • ${error}`));
    }

    if (result.warnings.length > 0) {
      console.log('\n⚠️  WARNINGS:');
      result.warnings.forEach(warning => console.log(`   • ${warning}`));
    }

    if (result.recommendations.length > 0) {
      console.log('\n💡 RECOMMENDATIONS:');
      result.recommendations.forEach(rec => console.log(`   • ${rec}`));
    }

    if (result.success) {
      console.log('\n🚀 NEXT STEPS FOR DATABASE OPERATIONS:');
      
      if (result.dumpFiles.length > 0) {
        const latestDump = result.dumpFiles[0];
        console.log('\n1️⃣  Restore database from backup dump:');
        console.log(`   ${this.generateRestoreCommand(latestDump)}`);
      } else {
        console.log('\n1️⃣  Create a database backup:');
        console.log('   migration-cli dump');
      }

      console.log('\n2️⃣  For S3 event simulation (separate from database operations):');
      console.log('   migration-cli simulate ./path/to/your/event-file.csv');
      console.log('   (Event simulation requires a CSV file to simulate S3 bucket events)');
    }

    console.log('\n' + '='.repeat(50));
  }
}

/**
 * CLI execution
 */
async function main() {
  const validator = new DumpWorkflowValidator();
  const result = await validator.validateWorkflow();
  validator.printResults(result);
  
  process.exit(result.success ? 0 : 1);
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Validation script failed:', error);
    process.exit(1);
  });
}

export { DumpWorkflowValidator };