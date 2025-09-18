/**
 * Unit tests for database dump functionality
 * Tests DatabaseDumper class methods, connection validation, dump file creation, and error handling
 */

import { DatabaseDumper, testDatabaseConnection, createDatabaseDumperFromEnv } from '../../database-dump';
import { DatabaseConfig, DumpOptions, DumpResult, DatabaseConnectionTest } from '../../types';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, statSync, accessSync, constants } from 'fs';
import { resolve, dirname } from 'path';

// Mock all external dependencies
jest.mock('child_process', () => ({
  spawn: jest.fn(),
  execSync: jest.fn()
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  statSync: jest.fn(),
  accessSync: jest.fn(),
  constants: {
    W_OK: 2
  }
}));

jest.mock('path', () => ({
  resolve: jest.fn(),
  dirname: jest.fn()
}));

// Mock database-config module
jest.mock('../../database-config', () => ({
  getRequiredDatabaseEnvironmentVariables: jest.fn(() => [
    'DATABASE_HOST',
    'DATABASE_PORT', 
    'DATABASE_NAME',
    'DATABASE_USERNAME',
    'DATABASE_PASSWORD'
  ]),
  getOptionalDatabaseEnvironmentVariables: jest.fn(() => ({
    'DATABASE_SSL': 'false'
  })),
  loadDatabaseConfig: jest.fn(),
  validateDatabaseEnvironmentVariables: jest.fn()
}));

describe('DatabaseDumper', () => {
  const mockConfig: DatabaseConfig = {
    host: 'localhost',
    port: 5432,
    database: 'test_db',
    username: 'test_user',
    password: 'test_password',
    ssl: false
  };

  const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
  const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
  const mockMkdirSync = mkdirSync as jest.MockedFunction<typeof mkdirSync>;
  const mockStatSync = statSync as jest.MockedFunction<typeof statSync>;
  const mockAccessSync = accessSync as jest.MockedFunction<typeof accessSync>;
  const mockResolve = resolve as jest.MockedFunction<typeof resolve>;
  const mockDirname = dirname as jest.MockedFunction<typeof dirname>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Clear environment variables
    delete process.env.DATABASE_HOST;
    delete process.env.DATABASE_PORT;
    delete process.env.DATABASE_NAME;
    delete process.env.DATABASE_USERNAME;
    delete process.env.DATABASE_PASSWORD;
    delete process.env.DATABASE_SSL;

    // Setup default mocks
    const { loadDatabaseConfig, validateDatabaseEnvironmentVariables } = require('../../database-config');
    loadDatabaseConfig.mockReturnValue(mockConfig);
    validateDatabaseEnvironmentVariables.mockReturnValue({
      isValid: true,
      errors: [],
      warnings: []
    });
    
    mockResolve.mockImplementation((dir, file) => `${dir}/${file}`);
    mockDirname.mockImplementation((path) => path.split('/').slice(0, -1).join('/'));
  });

  describe('constructor', () => {
    it('should create instance with provided config', () => {
      const dumper = new DatabaseDumper(mockConfig);
      expect(dumper.getConfigSummary()).toEqual({
        host: 'localhost',
        port: 5432,
        database: 'test_db',
        username: 'test_user',
        ssl: false
      });
    });

    it('should load config from environment variables when no config provided', () => {
      const envConfig = {
        host: 'env_host',
        port: 3306,
        database: 'env_db',
        username: 'env_user',
        password: 'env_password',
        ssl: true
      };
      
      const { loadDatabaseConfig } = require('../../database-config');
      loadDatabaseConfig.mockReturnValue(envConfig);

      const dumper = new DatabaseDumper();
      expect(dumper.getConfigSummary()).toEqual({
        host: 'env_host',
        port: 3306,
        database: 'env_db',
        username: 'env_user',
        ssl: true
      });
    });

    it('should throw error when required environment variables are missing', () => {
      const { loadDatabaseConfig } = require('../../database-config');
      loadDatabaseConfig.mockReturnValue(null);
      
      expect(() => new DatabaseDumper()).toThrow('Missing required database environment variables');
    });
  });

  describe('validateConnection', () => {
    it('should return success when pg_isready succeeds', async () => {
      const { spawn } = require('child_process');
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            callback(0); // Success exit code
          }
        })
      };
      spawn.mockReturnValue(mockProcess);

      const dumper = new DatabaseDumper(mockConfig);
      const result = await dumper.validateConnection();

      expect(result.success).toBe(true);
      expect(result.connectionTime).toBeGreaterThanOrEqual(0);
      expect(spawn).toHaveBeenCalledWith('pg_isready', [
        '-h', 'localhost',
        '-p', '5432',
        '-d', 'test_db',
        '-U', 'test_user'
      ], {
        env: expect.objectContaining({
          PGPASSWORD: 'test_password'
        })
      });
    });

    it('should return failure when pg_isready fails', async () => {
      const { spawn } = require('child_process');
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn((event, callback) => {
          if (event === 'data') {
            callback(Buffer.from('connection failed'));
          }
        }) },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            callback(1); // Error exit code
          }
        })
      };
      spawn.mockReturnValue(mockProcess);

      const dumper = new DatabaseDumper(mockConfig);
      const result = await dumper.validateConnection();

      expect(result.success).toBe(false);
      expect(result.error).toContain('connection failed');
    });

    it('should handle spawn error', async () => {
      const { spawn } = require('child_process');
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === 'error') {
            callback(new Error('Command not found'));
          }
        })
      };
      spawn.mockReturnValue(mockProcess);

      const dumper = new DatabaseDumper(mockConfig);
      const result = await dumper.validateConnection();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to execute pg_isready');
      expect(result.error).toContain('Command not found');
    });
  });

  describe('static methods', () => {
    describe('validateEnvironmentVariables', () => {
      it('should return valid when all required variables are present', () => {
        const { validateDatabaseEnvironmentVariables } = require('../../database-config');
        validateDatabaseEnvironmentVariables.mockReturnValue({
          isValid: true,
          errors: [],
          warnings: []
        });

        const result = DatabaseDumper.validateEnvironmentVariables();
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should return invalid when required variables are missing', () => {
        const { validateDatabaseEnvironmentVariables } = require('../../database-config');
        validateDatabaseEnvironmentVariables.mockReturnValue({
          isValid: false,
          errors: ['Missing required database environment variables: DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_USERNAME, DATABASE_PASSWORD'],
          warnings: []
        });

        const result = DatabaseDumper.validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Missing required database environment variables: DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_USERNAME, DATABASE_PASSWORD');
      });

      it('should validate port number', () => {
        const { validateDatabaseEnvironmentVariables } = require('../../database-config');
        validateDatabaseEnvironmentVariables.mockReturnValue({
          isValid: false,
          errors: ['DATABASE_PORT must be a valid port number (1-65535)'],
          warnings: []
        });

        const result = DatabaseDumper.validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('DATABASE_PORT must be a valid port number (1-65535)');
      });

      it('should warn about invalid SSL setting', () => {
        const { validateDatabaseEnvironmentVariables } = require('../../database-config');
        validateDatabaseEnvironmentVariables.mockReturnValue({
          isValid: true,
          errors: [],
          warnings: ['DATABASE_SSL should be either "true" or "false"']
        });

        const result = DatabaseDumper.validateEnvironmentVariables();
        expect(result.isValid).toBe(true);
        expect(result.warnings).toContain('DATABASE_SSL should be either "true" or "false"');
      });
    });

    describe('getRequiredEnvironmentVariables', () => {
      it('should return correct required variables', () => {
        const required = DatabaseDumper.getRequiredEnvironmentVariables();
        expect(required).toEqual([
          'DATABASE_HOST',
          'DATABASE_PORT',
          'DATABASE_NAME',
          'DATABASE_USERNAME',
          'DATABASE_PASSWORD'
        ]);
      });
    });

    describe('getOptionalEnvironmentVariables', () => {
      it('should return correct optional variables with defaults', () => {
        const optional = DatabaseDumper.getOptionalEnvironmentVariables();
        expect(optional).toEqual({
          'DATABASE_SSL': 'false'
        });
      });
    });
  });

  const createMockProcess = (exitCode: number = 0, errorOutput: string = '', stdoutOutput: string = '') => ({
    stdout: { 
      on: jest.fn((event, callback) => {
        if (event === 'data' && stdoutOutput) {
          callback(Buffer.from(stdoutOutput));
        }
      })
    },
    stderr: { 
      on: jest.fn((event, callback) => {
        if (event === 'data' && errorOutput) {
          callback(Buffer.from(errorOutput));
        }
      })
    },
    on: jest.fn((event, callback) => {
      if (event === 'close') {
        setTimeout(() => callback(exitCode), 10);
      } else if (event === 'error' && exitCode === -1) {
        setTimeout(() => callback(new Error('Command not found')), 10);
      }
    })
  } as any);

  describe('createDump', () => {

    beforeEach(() => {
      // Mock successful connection validation by default
      mockSpawn.mockImplementation(((command: any) => {
        if (command === 'pg_isready') {
          return createMockProcess(0);
        }
        if (command === 'pg_dump') {
          return createMockProcess(0);
        }
        return createMockProcess(1);
      }) as any);

      // Mock file system operations
      mockExistsSync.mockImplementation((path) => {
        // Return true for dump file after creation, false for initial checks
        if (typeof path === 'string' && path.includes('test_db_dump')) {
          return true; // Simulate file was created
        }
        return false; // Directory doesn't exist initially
      });
      mockAccessSync.mockImplementation(() => {}); // Directory is writable
      mockStatSync.mockReturnValue({ size: 1024 * 1024 } as any); // 1MB file
      mockMkdirSync.mockImplementation(() => undefined); // Directory creation succeeds

      // Mock execSync for disk space check
      const { execSync } = require('child_process');
      execSync.mockReturnValue('Filesystem     Size  Used Avail Use% Mounted on\n/dev/disk1    100G   50G   45G  53% /');
    });

    it('should create dump successfully with default options', async () => {
      const dumper = new DatabaseDumper(mockConfig);
      const result = await dumper.createDump();

      expect(result.success).toBe(true);
      expect(result.filePath).toContain('test_db_dump');
      expect(result.fileSize).toBe(1024 * 1024);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it('should create dump with custom options', async () => {
      const options: DumpOptions = {
        outputPath: '/custom/path',
        timestamp: true,
        compress: true
      };

      const dumper = new DatabaseDumper(mockConfig);
      const result = await dumper.createDump(options);

      expect(result.success).toBe(true);
      expect(result.filePath).toContain('/custom/path');
      expect(result.filePath).toContain('test_db_dump');
      expect(mockSpawn).toHaveBeenCalledWith('pg_dump', 
        expect.arrayContaining(['--compress=9']),
        expect.any(Object)
      );
    });

    it('should fail when connection validation fails', async () => {
      mockSpawn.mockImplementation(((command: any) => {
        if (command === 'pg_isready') {
          return createMockProcess(1, 'connection refused');
        }
        return createMockProcess(0);
      }) as any);

      const dumper = new DatabaseDumper(mockConfig);
      const result = await dumper.createDump();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database connection failed');
      expect(result.error).toContain('connection refused');
    });

    it('should fail when output directory is not writable', async () => {
      mockAccessSync.mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      const dumper = new DatabaseDumper(mockConfig);
      const result = await dumper.createDump();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Permission denied');
    });

    it('should fail when insufficient disk space', async () => {
      const { execSync } = require('child_process');
      execSync.mockReturnValue('Filesystem     Size  Used Avail Use% Mounted on\n/dev/disk1    100G   99G   500M  99% /');

      const dumper = new DatabaseDumper(mockConfig);
      const result = await dumper.createDump();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Insufficient disk space');
    });

    it('should fail when pg_dump command fails', async () => {
      mockSpawn.mockImplementation(((command: any) => {
        if (command === 'pg_isready') {
          return createMockProcess(0);
        }
        if (command === 'pg_dump') {
          return createMockProcess(1, 'pg_dump: error: connection failed');
        }
        return createMockProcess(1);
      }) as any);

      const dumper = new DatabaseDumper(mockConfig);
      const result = await dumper.createDump();

      expect(result.success).toBe(false);
      expect(result.error).toContain('pg_dump failed with exit code 1');
    });

    it('should fail when pg_dump command cannot be executed', async () => {
      mockSpawn.mockImplementation(((command: any) => {
        if (command === 'pg_isready') {
          return createMockProcess(0);
        }
        if (command === 'pg_dump') {
          return createMockProcess(-1); // Triggers error event
        }
        return createMockProcess(1);
      }) as any);

      const dumper = new DatabaseDumper(mockConfig);
      const result = await dumper.createDump();

      expect(result.success).toBe(false);
      expect(result.error).toContain('pg_dump failed with exit code -1');
    });

    it('should create backup when file already exists', async () => {
      mockExistsSync.mockReturnValue(true); // File exists

      const dumper = new DatabaseDumper(mockConfig);
      const progressMessages: string[] = [];
      const result = await dumper.createDump({}, (msg) => progressMessages.push(msg));

      expect(result.success).toBe(true);
      expect(progressMessages.some(msg => msg.includes('File exists, creating backup'))).toBe(true);
    });

    it('should provide progress updates during dump', async () => {
      const dumper = new DatabaseDumper(mockConfig);
      const progressMessages: string[] = [];
      
      await dumper.createDump({}, (msg) => progressMessages.push(msg));

      expect(progressMessages).toContain('🔍 Validating database connection...');
      expect(progressMessages.some(msg => msg.includes('✅ Database connection validated'))).toBe(true);
      expect(progressMessages).toContain('🚀 Starting database dump...');
      expect(progressMessages).toContain('✅ Dump completed successfully!');
    });

    it('should handle dump file not created error', async () => {
      mockExistsSync.mockImplementation((path) => {
        // Return false when checking if dump file was created
        if (typeof path === 'string' && path.includes('test_db_dump')) {
          return false;
        }
        return false;
      });

      const dumper = new DatabaseDumper(mockConfig);
      const result = await dumper.createDump();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Dump file was not created');
    });
  });

  describe('dump file naming logic', () => {
    it('should generate correct filename with timestamp', () => {
      const dumper = new DatabaseDumper(mockConfig);
      const options: DumpOptions = { timestamp: true };
      
      // Access private method through any cast for testing
      const fileName = (dumper as any).generateDumpFileName(options);
      
      expect(fileName).toContain('test_db_dump');
      expect(fileName).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/); // ISO timestamp format
      expect(fileName).toMatch(/\.sql$/);
    });

    it('should generate correct filename without timestamp', () => {
      const dumper = new DatabaseDumper(mockConfig);
      const options: DumpOptions = { timestamp: false };
      
      const fileName = (dumper as any).generateDumpFileName(options);
      
      expect(fileName).toContain('test_db_dump');
      expect(fileName).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/);
      expect(fileName).toMatch(/\.sql$/);
    });

    it('should generate compressed filename when compress option is true', () => {
      const dumper = new DatabaseDumper(mockConfig);
      const options: DumpOptions = { compress: true };
      
      const fileName = (dumper as any).generateDumpFileName(options);
      
      expect(fileName).toMatch(/\.sql\.gz$/);
    });

    it('should use custom output path', () => {
      const dumper = new DatabaseDumper(mockConfig);
      const options: DumpOptions = { outputPath: '/custom/output' };
      
      const fileName = (dumper as any).generateDumpFileName(options);
      
      expect(fileName).toContain('/custom/output');
    });

    it('should use default output path when not specified', () => {
      const dumper = new DatabaseDumper(mockConfig);
      const options: DumpOptions = {};
      
      const fileName = (dumper as any).generateDumpFileName(options);
      
      expect(fileName).toContain('./dumps');
    });
  });

  describe('error handling scenarios', () => {
    it('should format connection errors with recovery suggestions', async () => {
      mockSpawn.mockImplementation(((command: any) => {
        if (command === 'pg_isready') {
          return createMockProcess(1, 'timeout');
        }
        return createMockProcess(0);
      }) as any);

      const dumper = new DatabaseDumper(mockConfig);
      const result = await dumper.createDump();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database connection failed');
      expect(result.error).toContain('Recovery suggestions');
      expect(result.error).toContain('Connection timeout - check if database server is overloaded');
    });

    it('should format authentication errors with specific suggestions', async () => {
      mockSpawn.mockImplementation(((command: any) => {
        if (command === 'pg_isready') {
          return createMockProcess(1, 'authentication failed');
        }
        return createMockProcess(0);
      }) as any);

      const dumper = new DatabaseDumper(mockConfig);
      const result = await dumper.createDump();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Authentication failed - verify username and password');
    });

    it('should handle directory creation errors', async () => {
      // Mock connection validation to succeed first
      mockSpawn.mockImplementation(((command: any) => {
        if (command === 'pg_isready') {
          return createMockProcess(0);
        }
        return createMockProcess(1);
      }) as any);

      mockExistsSync.mockReturnValue(false);
      mockMkdirSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      const dumper = new DatabaseDumper(mockConfig);
      const result = await dumper.createDump();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot create directory');
    });

    it('should handle pg_dump exit code 1 with specific suggestions', async () => {
      // Reset file system mocks for this test
      mockExistsSync.mockReturnValue(false);
      mockAccessSync.mockImplementation(() => {}); // Directory is writable
      mockMkdirSync.mockImplementation(() => undefined); // Directory creation succeeds

      mockSpawn.mockImplementation(((command: any) => {
        if (command === 'pg_isready') {
          return createMockProcess(0);
        }
        if (command === 'pg_dump') {
          return createMockProcess(1, 'permission denied');
        }
        return createMockProcess(1);
      }) as any);

      const dumper = new DatabaseDumper(mockConfig);
      const result = await dumper.createDump();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Check database connection parameters');
      expect(result.error).toContain('Verify user has sufficient privileges');
    });

    it('should handle pg_dump exit code 2 with specific suggestions', async () => {
      // Reset file system mocks for this test
      mockExistsSync.mockReturnValue(false);
      mockAccessSync.mockImplementation(() => {}); // Directory is writable
      mockMkdirSync.mockImplementation(() => undefined); // Directory creation succeeds

      mockSpawn.mockImplementation(((command: any) => {
        if (command === 'pg_isready') {
          return createMockProcess(0);
        }
        if (command === 'pg_dump') {
          return createMockProcess(2, 'invalid option');
        }
        return createMockProcess(1);
      }) as any);

      const dumper = new DatabaseDumper(mockConfig);
      const result = await dumper.createDump();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Check command line arguments and options');
      expect(result.error).toContain('Verify output file path is writable');
    });

    it('should handle disk space check failures gracefully', async () => {
      // Reset spawn mock to ensure pg_isready and pg_dump succeed
      mockSpawn.mockImplementation(((command: any) => {
        if (command === 'pg_isready') {
          return createMockProcess(0);
        }
        if (command === 'pg_dump') {
          return createMockProcess(0);
        }
        return createMockProcess(1);
      }) as any);

      // Reset file system mocks for this test
      mockExistsSync.mockImplementation((path) => {
        if (typeof path === 'string' && path.includes('test_db_dump')) {
          return true; // Simulate file was created
        }
        return false;
      });
      mockAccessSync.mockImplementation(() => {}); // Directory is writable
      mockMkdirSync.mockImplementation(() => undefined); // Directory creation succeeds

      const { execSync } = require('child_process');
      execSync.mockImplementation(() => {
        throw new Error('df command failed');
      });

      // Mock console.warn to verify warning is logged
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const dumper = new DatabaseDumper(mockConfig);
      const result = await dumper.createDump();

      expect(result.success).toBe(true); // Should continue despite disk space check failure
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Could not check disk space'));
      
      consoleSpy.mockRestore();
    });
  });

  describe('connection validation with various configurations', () => {
    it('should validate connection with SSL enabled', async () => {
      const sslConfig: DatabaseConfig = { ...mockConfig, ssl: true };
      mockSpawn.mockReturnValue(createMockProcess(0));

      const dumper = new DatabaseDumper(sslConfig);
      const result = await dumper.validateConnection();

      expect(result.success).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith('pg_isready', 
        expect.arrayContaining(['-h', 'localhost', '-p', '5432']),
        expect.objectContaining({
          env: expect.objectContaining({ PGPASSWORD: 'test_password' })
        })
      );
    });

    it('should validate connection with different port', async () => {
      const customPortConfig: DatabaseConfig = { ...mockConfig, port: 3306 };
      mockSpawn.mockReturnValue(createMockProcess(0));

      const dumper = new DatabaseDumper(customPortConfig);
      const result = await dumper.validateConnection();

      expect(result.success).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith('pg_isready',
        expect.arrayContaining(['-p', '3306']),
        expect.any(Object)
      );
    });

    it('should validate connection with custom host', async () => {
      const customHostConfig: DatabaseConfig = { ...mockConfig, host: 'db.example.com' };
      mockSpawn.mockReturnValue(createMockProcess(0));

      const dumper = new DatabaseDumper(customHostConfig);
      const result = await dumper.validateConnection();

      expect(result.success).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith('pg_isready',
        expect.arrayContaining(['-h', 'db.example.com']),
        expect.any(Object)
      );
    });

    it('should measure connection time', async () => {
      mockSpawn.mockImplementation((() => {
        const process = createMockProcess(0);
        // Simulate delay
        process.on = jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 100);
          }
        });
        return process;
      }) as any);

      const dumper = new DatabaseDumper(mockConfig);
      const result = await dumper.validateConnection();

      expect(result.success).toBe(true);
      expect(result.connectionTime).toBeGreaterThanOrEqual(100);
    });

    it('should handle connection with alternative config parameter', async () => {
      const altConfig: DatabaseConfig = {
        host: 'alt-host',
        port: 5433,
        database: 'alt_db',
        username: 'alt_user',
        password: 'alt_pass',
        ssl: true
      };

      mockSpawn.mockReturnValue(createMockProcess(0));

      const dumper = new DatabaseDumper(mockConfig);
      const result = await dumper.validateConnection(altConfig);

      expect(result.success).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith('pg_isready',
        expect.arrayContaining([
          '-h', 'alt-host',
          '-p', '5433',
          '-d', 'alt_db',
          '-U', 'alt_user'
        ]),
        expect.objectContaining({
          env: expect.objectContaining({ PGPASSWORD: 'alt_pass' })
        })
      );
    });
  });

  describe('utility functions', () => {
    describe('checkPgToolsAvailable', () => {
      it('should return true when pg_dump is available', async () => {
        mockSpawn.mockReturnValue(createMockProcess(0));

        const result = await DatabaseDumper.checkPgToolsAvailable();

        expect(result).toBe(true);
        expect(mockSpawn).toHaveBeenCalledWith('pg_dump', ['--version']);
      });

      it('should return false when pg_dump is not available', async () => {
        mockSpawn.mockReturnValue(createMockProcess(-1));

        const result = await DatabaseDumper.checkPgToolsAvailable();

        expect(result).toBe(false);
      });
    });

    describe('createDatabaseDumperFromEnv', () => {
      it('should create dumper from environment variables', () => {
        const dumper = createDatabaseDumperFromEnv();
        expect(dumper).toBeInstanceOf(DatabaseDumper);
      });
    });

    describe('testDatabaseConnection utility', () => {
      it('should create dumper and test connection', async () => {
        mockSpawn.mockReturnValue(createMockProcess(0));

        const result = await testDatabaseConnection(mockConfig);
        expect(result.success).toBe(true);
      });

      it('should use environment config when no config provided', async () => {
        mockSpawn.mockReturnValue(createMockProcess(0));

        const result = await testDatabaseConnection();
        expect(result.success).toBe(true);
      });
    });

    describe('getConfigSummary', () => {
      it('should return config without password', () => {
        const dumper = new DatabaseDumper(mockConfig);
        const summary = dumper.getConfigSummary();

        expect(summary).toEqual({
          host: 'localhost',
          port: 5432,
          database: 'test_db',
          username: 'test_user',
          ssl: false
        });
        expect(summary).not.toHaveProperty('password');
      });
    });
  });

  describe('file formatting utilities', () => {
    it('should format file size correctly', () => {
      const dumper = new DatabaseDumper(mockConfig);
      
      // Access private method for testing
      expect((dumper as any).formatFileSize(1024)).toBe('1.00 KB');
      expect((dumper as any).formatFileSize(1024 * 1024)).toBe('1.00 MB');
      expect((dumper as any).formatFileSize(1024 * 1024 * 1024)).toBe('1.00 GB');
      expect((dumper as any).formatFileSize(500)).toBe('500.00 B');
    });

    it('should format duration correctly', () => {
      const dumper = new DatabaseDumper(mockConfig);
      
      expect((dumper as any).formatDuration(1000)).toBe('1s');
      expect((dumper as any).formatDuration(61000)).toBe('1m 1s');
      expect((dumper as any).formatDuration(3661000)).toBe('1h 1m 1s');
      expect((dumper as any).formatDuration(500)).toBe('0s');
    });

    it('should create backup filename correctly', () => {
      const dumper = new DatabaseDumper(mockConfig);
      
      const backupName = (dumper as any).createBackupFileName('/path/to/dump.sql');
      expect(backupName).toContain('/path/to/dump_backup_');
      expect(backupName).toMatch(/\.sql$/);
      
      const compressedBackupName = (dumper as any).createBackupFileName('/path/to/dump.sql.gz');
      expect(compressedBackupName).toContain('/path/to/dump_backup_');
      expect(compressedBackupName).toMatch(/\.sql\.gz$/);
    });
  });
});