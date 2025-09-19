# CLI Migration Guide

## Overview

The Apilados Pipeline CLI has been refactored to better reflect the production architecture and separate concerns between database operations and S3 event simulation. This guide helps existing users migrate from the old command patterns to the new, clearer structure.

## What Changed and Why

### The Problem with the Old CLI

The previous CLI mixed two completely different operations:
- **Database dumps**: Creating backups of production data
- **CSV event processing**: Simulating S3 bucket events that trigger Lambda processing

This created confusion because:
- CSV files were incorrectly associated with database dumps
- The "dump-and-run" workflow combined unrelated operations
- Terminology didn't match the actual production architecture
- Interactive prompts mixed database and event concerns

### The New Architecture

The refactored CLI properly separates these concerns:

```
Production Architecture:
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Database      │    │   S3 Bucket     │    │     Lambda      │
│   (PostgreSQL)  │    │   (CSV Files)   │    │   (Processing)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
        │                        │                        │
        │                        │                        │
        ▼                        ▼                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ CLI: dump       │    │ CLI: simulate   │    │ (Simulated by   │
│ (Database       │    │ (S3 Event       │    │  simulate cmd)  │
│  Backup)        │    │  Simulation)    │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Command Migration Reference

### 1. Test Command → Simulate Command

**❌ Old Command (Deprecated):**
```bash
migration-cli test data.csv
migration-cli test data.csv --mode sequential
```

**✅ New Command:**
```bash
migration-cli simulate data.csv
migration-cli simulate data.csv --mode sequential
```

**Migration Steps:**
1. Replace `test` with `simulate` in all commands
2. All options and functionality remain identical
3. Update any scripts or documentation

### 2. Dump Command with CSV Options

**❌ Old Command (Deprecated):**
```bash
migration-cli dump --csv-file data.csv
migration-cli dump --csv-file data.csv --dump-only
```

**✅ New Commands (Separate Operations):**
```bash
# Step 1: Create database backup
migration-cli dump

# Step 2: Simulate S3 events with CSV
migration-cli simulate data.csv
```

**Migration Steps:**
1. Remove `--csv-file` option from dump commands
2. Run dump and simulate as separate commands
3. Update workflows to reflect the separation

### 3. Dump-Only Option

**❌ Old Command (Deprecated):**
```bash
migration-cli dump --dump-only
migration-cli dump --dump-only --output ./backups
```

**✅ New Command:**
```bash
migration-cli dump
migration-cli dump --output ./backups
```

**Migration Steps:**
1. Remove `--dump-only` flag (it's now the default behavior)
2. All other options remain the same

### 4. Interactive "Dump-and-Run" Workflow

**❌ Old Workflow (No Longer Supported):**
```bash
migration-cli dump
# → Interactive prompt: "Do you want to run CSV processing?"
# → If yes, prompts for CSV file selection
# → Runs both dump and CSV processing
```

**✅ New Workflow:**
```bash
# Explicit, separate commands
migration-cli dump                    # Create database backup
migration-cli simulate data.csv       # Simulate S3 events
```

**Migration Steps:**
1. Replace interactive workflows with explicit commands
2. Update scripts to run commands separately
3. Remove any automation that relied on interactive prompts

## Complete Migration Examples

### Example 1: Basic Testing Workflow

**❌ Old Workflow:**
```bash
# Old way - mixed concerns
migration-cli test sample.csv
```

**✅ New Workflow:**
```bash
# New way - clear separation
migration-cli simulate sample.csv
```

### Example 2: Full Development Setup

**❌ Old Workflow:**
```bash
# Old way - confusing mixed operations
migration-cli dump --csv-file data.csv --dump-only
# Then interactive prompts...
```

**✅ New Workflow:**
```bash
# New way - explicit, separate operations
migration-cli dump --output ./backups          # Get production data
migration-cli simulate data.csv                # Test event processing
```

### Example 3: Automated Scripts

**❌ Old Script:**
```bash
#!/bin/bash
# Old automated script
migration-cli dump --dump-only --output ./backups
migration-cli test data.csv --mode sequential
```

**✅ New Script:**
```bash
#!/bin/bash
# New automated script - clearer intent
migration-cli dump --output ./backups          # Database backup
migration-cli simulate data.csv --mode sequential  # Event simulation
```

## Terminology Updates

### Database Operations
- ✅ "Database dump" or "Database backup"
- ✅ "Backup and restore operations"
- ✅ "PostgreSQL dump file"
- ❌ ~~"Migration dump"~~
- ❌ ~~"Migration file"~~

### Event Simulation
- ✅ "S3 event simulation"
- ✅ "Lambda processing simulation"
- ✅ "CSV event file"
- ✅ "Event processing"
- ❌ ~~"Migration test"~~
- ❌ ~~"Run migration"~~
- ❌ ~~"CSV migration"~~

## Troubleshooting Common Migration Issues

### Issue 1: "Command 'test' not found"

**Problem:** Using the old `test` command name.

**Solution:**
```bash
# Replace this:
migration-cli test data.csv

# With this:
migration-cli simulate data.csv
```

### Issue 2: "--csv-file option not recognized"

**Problem:** Using `--csv-file` with the dump command.

**Solution:**
```bash
# Replace this:
migration-cli dump --csv-file data.csv

# With this (two separate commands):
migration-cli dump                    # Database backup
migration-cli simulate data.csv       # Event simulation
```

### Issue 3: "No interactive prompts appearing"

**Problem:** Expecting interactive "dump-and-run" prompts.

**Solution:**
Interactive prompts have been removed. Use explicit commands:
```bash
migration-cli dump                    # For database operations
migration-cli simulate data.csv       # For event simulation
```

### Issue 4: "--dump-only option not recognized"

**Problem:** Using the deprecated `--dump-only` flag.

**Solution:**
```bash
# Replace this:
migration-cli dump --dump-only

# With this (--dump-only is now default):
migration-cli dump
```

### Issue 5: Scripts failing with new CLI

**Problem:** Automated scripts using old command patterns.

**Solution:**
1. Update command names (`test` → `simulate`)
2. Remove deprecated options (`--csv-file`, `--dump-only`)
3. Separate mixed operations into distinct commands
4. Update any parsing logic that expected old output formats

## Environment Configuration

### Database Operations (dump command)
Required environment variables:
```bash
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=your_db
DATABASE_USERNAME=your_user
DATABASE_PASSWORD=your_password
```

### Event Simulation (simulate command)
Required environment variables:
```bash
STRAPI_BASE_URL=http://localhost:1337
STRAPI_TOKEN=your_strapi_token
```

Optional performance tuning:
```bash
PROCESS_MODE=parallel
OMIT_GET=false
BATCH_SIZE=100
CHUNK_SIZE=150
```

## Validation and Testing

### Validate Your Migration

1. **Test environment validation:**
   ```bash
   migration-cli validate
   ```

2. **Test database dump workflow:**
   ```bash
   migration-cli validate-dump
   ```

3. **Test event simulation:**
   ```bash
   migration-cli simulate test-data/sample.csv
   ```

### Common Validation Errors

**Database Connection Issues:**
- Ensure PostgreSQL client tools are installed
- Verify database environment variables
- Check database connectivity

**Event Simulation Issues:**
- Ensure Strapi is running and accessible
- Verify STRAPI_BASE_URL and STRAPI_TOKEN
- Check CSV file format and accessibility

## Getting Help

### Command-Specific Help
```bash
migration-cli dump --help
migration-cli simulate --help
migration-cli validate --help
```

### Usage Examples
```bash
migration-cli help-examples
```

### Environment Information
```bash
migration-cli env
```

## Benefits of the New Structure

### 1. **Clearer Mental Model**
- Database operations are separate from event processing
- Commands match production architecture
- No confusion about CSV file purposes

### 2. **Better Error Messages**
- Context-specific error messages
- Clear separation of database vs. event errors
- More actionable troubleshooting guidance

### 3. **Improved Flexibility**
- Run database dumps independently
- Test events without database operations
- Mix and match operations as needed

### 4. **Production Alignment**
- Local development mirrors production architecture
- S3 events are clearly simulated
- Database operations are clearly separated

## Support and Feedback

If you encounter issues during migration:

1. **Check the warnings:** The CLI provides detailed migration guidance when deprecated patterns are detected
2. **Use validation commands:** `migration-cli validate` and `migration-cli validate-dump`
3. **Review examples:** `migration-cli help-examples` shows current usage patterns
4. **Check environment:** `migration-cli env` displays current configuration

The CLI includes backward compatibility warnings that will guide you through the migration process when deprecated patterns are detected.