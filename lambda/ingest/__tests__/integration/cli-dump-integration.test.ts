/**
 * Integration tests for CLI dump command
 */

import { spawn } from 'child_process';
import { resolve } from 'path';

describe('CLI Dump Command Integration', () => {
  const cliPath = resolve(__dirname, '../../cli.ts');
  
  test('should show dump command help', (done) => {
    const child = spawn('npx', ['ts-node', cliPath, 'dump', '--help'], {
      stdio: 'pipe'
    });

    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      expect(code).toBe(0);
      expect(output).toContain('Create database backup');
      expect(output).toContain('--compress');
      expect(output).toContain('--output');
      expect(output).not.toContain('--dump-only');
      expect(output).not.toContain('--csv-file');
      done();
    });
  });

  test('should validate database configuration requirements', () => {
    // Test the validation logic directly instead of spawning process
    const { DatabaseDumper } = require('../../database-dump');
    
    // Clear environment variables for this test
    const originalEnv = process.env;
    process.env = {};
    
    try {
      const validation = DatabaseDumper.validateEnvironmentVariables();
      expect(validation.isValid).toBe(false);
      expect(validation.errors[0]).toContain('Missing required database environment variables');
    } finally {
      // Restore original environment
      process.env = originalEnv;
    }
  });

  test('should show updated help examples with dump commands', (done) => {
    const child = spawn('npx', ['ts-node', cliPath, 'help-examples'], {
      stdio: 'pipe'
    });

    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      expect(code).toBe(0);
      expect(output).toContain('Create database backup');
      expect(output).toContain('migration-cli dump');
      expect(output).toContain('Create compressed database backup');
      expect(output).toContain('DATABASE_HOST, DATABASE_PORT, DATABASE_NAME');
      expect(output).not.toContain('Dump database and run migration');
      done();
    });
  });

  test('should include dump command in main help', (done) => {
    const child = spawn('npx', ['ts-node', cliPath, '--help'], {
      stdio: 'pipe'
    });

    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      expect(code).toBe(0);
      expect(output).toContain('dump [options]');
      expect(output).toContain('Create database backup');
      done();
    });
  });
});