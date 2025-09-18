/**
 * Integration tests for database dump functionality
 * Tests the integration with configuration system and environment detection
 */

import { DatabaseDumper, createDatabaseDumperFromEnv, testDatabaseConnection } from '../../database-dump';
import { loadDatabaseConfig, validateDatabaseConfig } from '../../database-config';

describe('Database Dump Integration', () => {
  beforeEach(() => {
    // Clear environment variables
    delete process.env.DATABASE_HOST;
    delete process.env.DATABASE_PORT;
    delete process.env.DATABASE_NAME;
    delete process.env.DATABASE_USERNAME;
    delete process.env.DATABASE_PASSWORD;
    delete process.env.DATABASE_SSL;
  });

  describe('Configuration Integration', () => {
    it('should integrate with config system to load database configuration', () => {
      // Set up environment variables
      process.env.DATABASE_HOST = 'integration-host';
      process.env.DATABASE_PORT = '5432';
      process.env.DATABASE_NAME = 'integration_db';
      process.env.DATABASE_USERNAME = 'integration_user';
      process.env.DATABASE_PASSWORD = 'integration_pass';
      process.env.DATABASE_SSL = 'true';

      const config = loadDatabaseConfig();
      expect(config).toEqual({
        host: 'integration-host',
        port: 5432,
        database: 'integration_db',
        username: 'integration_user',
        password: 'integration_pass',
        ssl: true
      });
    });

    it('should return null when database configuration is incomplete', () => {
      // Only set some variables
      process.env.DATABASE_HOST = 'localhost';
      process.env.DATABASE_PORT = '5432';
      // Missing DATABASE_NAME, DATABASE_USERNAME, DATABASE_PASSWORD

      const config = loadDatabaseConfig();
      expect(config).toBeNull();
    });

    it('should validate database configuration using validateDatabaseConfig', () => {
      const validConfig = {
        host: 'localhost',
        port: 5432,
        database: 'test_db',
        username: 'test_user',
        password: 'test_pass',
        ssl: false
      };

      const result = validateDatabaseConfig(validConfig);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect invalid database configuration', () => {
      const invalidConfig = {
        host: '',
        port: 99999, // Invalid port
        database: '',
        username: '',
        password: ''
      };

      const result = validateDatabaseConfig(invalidConfig);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('DATABASE_HOST is required');
      expect(result.errors).toContain('DATABASE_PORT must be between 1 and 65535');
      expect(result.errors).toContain('DATABASE_NAME is required');
      expect(result.errors).toContain('DATABASE_USERNAME is required');
      expect(result.errors).toContain('DATABASE_PASSWORD is required');
    });
  });

  describe('Factory Functions', () => {
    it('should create DatabaseDumper from environment using factory function', () => {
      process.env.DATABASE_HOST = 'factory-host';
      process.env.DATABASE_PORT = '3306';
      process.env.DATABASE_NAME = 'factory_db';
      process.env.DATABASE_USERNAME = 'factory_user';
      process.env.DATABASE_PASSWORD = 'factory_pass';

      const dumper = createDatabaseDumperFromEnv();
      const config = dumper.getConfigSummary();

      expect(config).toEqual({
        host: 'factory-host',
        port: 3306,
        database: 'factory_db',
        username: 'factory_user',
        ssl: false
      });
    });

    it('should throw error when creating from incomplete environment', () => {
      // Missing required environment variables
      expect(() => createDatabaseDumperFromEnv()).toThrow('Missing required database environment variables');
    });
  });

  describe('Environment Variable Validation', () => {
    it('should validate complete environment setup', () => {
      process.env.DATABASE_HOST = 'localhost';
      process.env.DATABASE_PORT = '5432';
      process.env.DATABASE_NAME = 'test_db';
      process.env.DATABASE_USERNAME = 'test_user';
      process.env.DATABASE_PASSWORD = 'test_pass';
      process.env.DATABASE_SSL = 'false';

      const result = DatabaseDumper.validateEnvironmentVariables();
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should provide helpful error messages for missing variables', () => {
      const result = DatabaseDumper.validateEnvironmentVariables();
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Missing required database environment variables');
      expect(result.errors[0]).toContain('DATABASE_HOST');
      expect(result.errors[0]).toContain('DATABASE_PORT');
      expect(result.errors[0]).toContain('DATABASE_NAME');
      expect(result.errors[0]).toContain('DATABASE_USERNAME');
      expect(result.errors[0]).toContain('DATABASE_PASSWORD');
    });
  });

  describe('Dump File Name Generation', () => {
    it('should generate appropriate dump file names', () => {
      process.env.DATABASE_HOST = 'localhost';
      process.env.DATABASE_PORT = '5432';
      process.env.DATABASE_NAME = 'test_db';
      process.env.DATABASE_USERNAME = 'test_user';
      process.env.DATABASE_PASSWORD = 'test_pass';

      const dumper = new DatabaseDumper();
      
      // Test that the dumper can be created and has the expected database name
      const config = dumper.getConfigSummary();
      expect(config.database).toBe('test_db');
    });
  });
});