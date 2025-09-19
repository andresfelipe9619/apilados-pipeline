# Troubleshooting Guide

This guide helps you resolve common issues when using the Apilados Pipeline data migration system.

## Quick Diagnostics

### 1. Environment Validation
Always start by validating your environment:

```bash
cd lambda/ingest
npm run cli validate
```

This command checks:
- Strapi configuration (URL and token)
- Database configuration (for dump operations)
- Required environment variables
- Network connectivity

### 2. Check System Requirements
Ensure you have the required tools installed:

```bash
# Check Node.js version (requires 16+)
node --version

# Check PostgreSQL client tools (for database dumps)
which pg_dump pg_isready

# Check npm dependencies
npm list --depth=0
```

## Database Dump Issues

### PostgreSQL Tools Not Found

**Error Message:**
```
❌ PostgreSQL client tools not found.
Please install PostgreSQL client tools (pg_dump, pg_isready)
```

**Solutions:**

**macOS:**
```bash
# Using Homebrew
brew install postgresql

# Using MacPorts
sudo port install postgresql16

# Verify installation
which pg_dump pg_isready
```

**Ubuntu/Debian:**
```bash
# Install PostgreSQL client
sudo apt-get update
sudo apt-get install postgresql-client

# For specific version
sudo apt-get install postgresql-client-15
```

**CentOS/RHEL:**
```bash
# Install PostgreSQL client
sudo yum install postgresql
# or for newer versions
sudo dnf install postgresql
```

**Windows:**
- Download PostgreSQL from https://www.postgresql.org/download/windows/
- Install with client tools option selected
- Add PostgreSQL bin directory to PATH

### Database Connection Issues

**Error Message:**
```
❌ Database connection failed: connection refused
```

**Diagnostic Steps:**

1. **Test connection manually:**
```bash
pg_isready -h $DATABASE_HOST -p $DATABASE_PORT -U $DATABASE_USERNAME -d $DATABASE_NAME
```

2. **Check environment variables:**
```bash
echo $DATABASE_HOST
echo $DATABASE_PORT
echo $DATABASE_NAME
echo $DATABASE_USERNAME
# Don't echo DATABASE_PASSWORD for security
```

3. **Test with psql:**
```bash
psql -h $DATABASE_HOST -p $DATABASE_PORT -U $DATABASE_USERNAME -d $DATABASE_NAME -c "SELECT version();"
```

**Common Solutions:**

- **Wrong host/port:** Verify `DATABASE_HOST` and `DATABASE_PORT` values
- **Database not running:** Start your PostgreSQL service
- **Authentication failed:** Check `DATABASE_USERNAME` and `DATABASE_PASSWORD`
- **Database doesn't exist:** Verify `DATABASE_NAME` exists
- **SSL required:** Set `DATABASE_SSL=true` for remote connections
- **Firewall issues:** Ensure port 5432 (or your custom port) is accessible

### Dump File Creation Issues

**Error Message:**
```
❌ Permission denied writing dump file
```

**Solutions:**

1. **Check output directory permissions:**
```bash
mkdir -p ./dumps
chmod 755 ./dumps
ls -la ./dumps
```

2. **Use different output directory:**
```bash
npm run cli dump --output /tmp/dumps
```

3. **Check disk space:**
```bash
df -h .
# Ensure sufficient space for dump file
```

**Error Message:**
```
❌ Dump file already exists
```

**Solutions:**

1. **Use timestamp option:**
```bash
npm run cli dump --timestamp
```

2. **Specify different output path:**
```bash
npm run cli dump --output ./backups/$(date +%Y%m%d)
```

3. **Remove existing file:**
```bash
rm existing-dump.sql
npm run cli dump
```

## Migration Issues

### Environment Configuration Problems

**Error Message:**
```
❌ Environment validation failed
```

**Diagnostic Steps:**

1. **Check .env file exists:**
```bash
ls -la .env
cat .env  # Review configuration
```

2. **Validate required variables:**
```bash
# Required for migration
echo $STRAPI_BASE_URL
echo $STRAPI_TOKEN

# Required for database dumps
echo $DATABASE_HOST
echo $DATABASE_PORT
echo $DATABASE_NAME
echo $DATABASE_USERNAME
```

3. **Test Strapi connectivity:**
```bash
curl "$STRAPI_BASE_URL/users/me" \
  -H "Authorization: Bearer $STRAPI_TOKEN"
```

**Common Solutions:**

- **Missing .env file:** Copy from `.env.example` and configure
- **Wrong STRAPI_BASE_URL format:** Should end with `/api`
- **Invalid token:** Generate new token in Strapi admin panel
- **Strapi not running:** Start your Strapi server

### Strapi Connection Issues

**Error Message:**
```
❌ Cannot connect to Strapi - check STRAPI_BASE_URL
```

**Diagnostic Steps:**

1. **Check Strapi server status:**
```bash
curl -I $STRAPI_BASE_URL
# Should return HTTP 200 or 404, not connection refused
```

2. **Verify URL format:**
```bash
# Correct format
export STRAPI_BASE_URL=http://localhost:1337/api

# Incorrect formats
export STRAPI_BASE_URL=http://localhost:1337      # Missing /api
export STRAPI_BASE_URL=http://localhost:1337/api/ # Extra trailing slash
```

3. **Test authentication:**
```bash
curl "$STRAPI_BASE_URL/users/me" \
  -H "Authorization: Bearer $STRAPI_TOKEN" \
  -v
```

**Common Solutions:**

- **Strapi not running:** Start with `npm run develop` or `npm start`
- **Wrong port:** Check Strapi is running on expected port
- **Network issues:** Test with `ping localhost` or your Strapi host
- **SSL/TLS issues:** Use `http://` for local, `https://` for production

### Event CSV File Issues

**Error Message:**
```
❌ Event CSV file not found: /path/to/file.csv
```

**Solutions:**

1. **Check file exists:**
```bash
ls -la ./data/participations.csv
```

2. **Use absolute path:**
```bash
npm run cli test $(pwd)/data/participations.csv
```

3. **Check file permissions:**
```bash
chmod 644 ./data/participations.csv
```

**Error Message:**
```
❌ Invalid CSV format
```

**Diagnostic Steps:**

1. **Check CSV structure:**
```bash
head -5 ./data/participations.csv
# Should show proper headers and data
```

2. **Validate CSV format:**
```bash
# Check for proper delimiters, quotes, etc.
file ./data/participations.csv
wc -l ./data/participations.csv
```

3. **Test with small sample:**
```bash
head -10 ./data/participations.csv > sample.csv
npm run cli test sample.csv
```

### CCTs Data Issues

**Error Message:**
```
⚠️ CCTs file not found, continuing without CCTs data
```

**Solutions:**

1. **Place CCTs file in project root:**
```bash
cp ./data/ccts.csv ./ccts_export.csv
```

2. **Specify CCTs file explicitly:**
```bash
npm run cli test data.csv --ccts ./data/ccts.csv
```

3. **Disable CCTs if not needed:**
```bash
npm run cli test data.csv --no-auto-ccts
```

**Error Message:**
```
❌ Invalid CCTs format
```

**Diagnostic Steps:**

1. **Check CCTs file structure:**
```bash
head -5 ./ccts_export.csv
# Should have proper CCT data format with headers
```

2. **Validate data format:**
```bash
# Check for required columns
grep -i "clave\|id" ./ccts_export.csv | head -1
```

## Performance Issues

### Slow Processing

**Symptoms:**
- Migration takes very long time
- Low records per second rate
- High memory usage

**Solutions:**

1. **Use parallel processing:**
```bash
npm run cli test data.csv --mode parallel
```

2. **Optimize batch size:**
```bash
# Start with larger batches
npm run cli test data.csv --batch-size 200

# If memory issues, reduce batch size
npm run cli test data.csv --batch-size 25
```

3. **Skip GET requests for performance:**
```bash
npm run cli test data.csv --omit-get
```

4. **Combined optimization:**
```bash
npm run cli test data.csv \
  --mode parallel \
  --batch-size 200 \
  --omit-get
```

### Memory Issues

**Error Message:**
```
❌ JavaScript heap out of memory
```

**Solutions:**

1. **Use sequential processing:**
```bash
npm run cli test data.csv --mode sequential
```

2. **Reduce batch size:**
```bash
npm run cli test data.csv --batch-size 25
```

3. **Process in chunks:**
```bash
# Split large file into smaller chunks
split -l 1000 large-file.csv chunk_

# Process each chunk separately
for chunk in chunk_*; do
  npm run cli test $chunk --mode sequential --batch-size 50
done
```

4. **Increase Node.js memory limit:**
```bash
export NODE_OPTIONS="--max-old-space-size=4096"
npm run cli test data.csv
```

### Rate Limiting Issues

**Error Message:**
```
❌ Rate limit exceeded (429)
```

**Solutions:**

1. **Use sequential processing:**
```bash
npm run cli test data.csv --mode sequential
```

2. **Reduce batch size:**
```bash
npm run cli test data.csv --batch-size 10
```

3. **Check Strapi rate limiting configuration:**
```javascript
// config/middlewares.js in Strapi
module.exports = [
  // ... other middlewares
  {
    name: 'strapi::rate-limit',
    config: {
      max: 1000,  // Increase limit
      duration: 60000,  // Per minute
    },
  },
];
```

## Data Quality Issues

### Validation Errors

**Error Message:**
```
❌ Validation error: required field missing
```

**Solutions:**

1. **Check error report:**
```bash
# Review generated error CSV
cat error-report-*.csv
```

2. **Validate data format:**
```bash
# Check for required fields
head -1 data.csv  # Check headers
grep -v "^$" data.csv | wc -l  # Count non-empty rows
```

3. **Clean data before migration:**
```bash
# Remove empty rows
grep -v "^$" data.csv > clean-data.csv
npm run cli test clean-data.csv
```

### Duplicate Data Issues

**Error Message:**
```
❌ Unique constraint violation
```

**Solutions:**

1. **Remove duplicates from CSV:**
```bash
# Sort and remove duplicates (keep header)
head -1 data.csv > unique-data.csv
tail -n +2 data.csv | sort -u >> unique-data.csv
```

2. **Handle duplicates in Strapi:**
- Configure unique fields properly in content types
- Use upsert operations if supported

3. **Check for existing data:**
```bash
# Test with omit-get disabled to check existing records
npm run cli test data.csv --no-omit-get
```

## Debug and Logging

### Enable Debug Mode

```bash
# Enable detailed logging
DEBUG=true npm run cli test data.csv

# Enable debug for database operations
DEBUG=true npm run cli dump

# Enable debug for validation
DEBUG=true npm run cli validate
```

### Check Log Files

```bash
# Check for log files
ls -la *.log

# Check error reports
ls -la error-report-*.csv

# Review recent errors
tail -50 error-report-*.csv
```

### Network Debugging

```bash
# Test network connectivity
ping localhost  # or your Strapi host
telnet localhost 1337  # or your Strapi port

# Test DNS resolution
nslookup your-strapi-host.com

# Check firewall/proxy issues
curl -v $STRAPI_BASE_URL
```

## Getting Additional Help

### Information to Gather

When seeking help, please provide:

1. **Environment information:**
```bash
node --version
npm --version
which pg_dump
npm run cli validate
```

2. **Error messages:**
- Complete error output
- Error report CSV content (if generated)
- Debug logs (with `DEBUG=true`)

3. **Configuration:**
- Environment variables (without sensitive values)
- CSV file structure (first few rows)
- Strapi version and configuration

4. **Steps to reproduce:**
- Exact commands used
- Data samples that cause issues
- Expected vs actual behavior

### Common Commands for Troubleshooting

```bash
# Complete diagnostic sequence
cd lambda/ingest

# 1. Validate environment
npm run cli validate

# 2. Test with minimal data
npm run cli generate --count 5
npm run cli test test-data/sample.csv --batch-size 1

# 3. Check database connectivity (if using dumps)
npm run cli dump --output /tmp

# 4. Enable debug mode for detailed logs
DEBUG=true npm run cli simulate small-sample.csv

# 5. Check system resources
df -h .  # Disk space
free -h  # Memory (Linux)
top      # CPU and memory usage
```

This troubleshooting guide should help you resolve most common issues. If problems persist, consider reviewing the error reports generated by the system and checking the Strapi server logs for additional context.