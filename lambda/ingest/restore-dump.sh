#!/bin/bash

# Database restoration script with version compatibility handling
# This script attempts to restore the dump file using different methods

set -e

DUMP_FILE="./strapi_db_2025-06-28.dump"
DB_HOST="localhost"
DB_PORT="5432"
DB_NAME="strapi"
DB_USER="atentamente"

echo "🔍 Attempting to restore database dump..."
echo "File: $DUMP_FILE"
echo "Database: $DB_HOST:$DB_PORT/$DB_NAME"
echo "User: $DB_USER"
echo ""

# Check if dump file exists
if [ ! -f "$DUMP_FILE" ]; then
    echo "❌ Dump file not found: $DUMP_FILE"
    exit 1
fi

# Function to try different PostgreSQL versions
try_restore() {
    local pg_path=$1
    local version_name=$2
    
    echo "🔧 Trying with $version_name..."
    
    if [ -f "$pg_path/pg_restore" ]; then
        echo "   Version: $($pg_path/pg_restore --version)"
        
        # Try to restore
        if $pg_path/pg_restore -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME --clean --if-exists --verbose "$DUMP_FILE"; then
            echo "✅ Successfully restored with $version_name!"
            return 0
        else
            echo "❌ Failed with $version_name"
            return 1
        fi
    else
        echo "   $version_name not found at $pg_path"
        return 1
    fi
}

# Try different PostgreSQL installations
echo "🔍 Searching for compatible PostgreSQL versions..."

# Try PostgreSQL 16 (Homebrew)
if try_restore "/opt/homebrew/opt/postgresql@16/bin" "PostgreSQL 16 (Homebrew)"; then
    exit 0
fi

# Try PostgreSQL 15 (Homebrew)
if try_restore "/opt/homebrew/opt/postgresql@15/bin" "PostgreSQL 15 (Homebrew)"; then
    exit 0
fi

# Try PostgreSQL 14 (Homebrew)
if try_restore "/opt/homebrew/opt/postgresql@14/bin" "PostgreSQL 14 (Homebrew)"; then
    exit 0
fi

# Try system PostgreSQL
if try_restore "/usr/local/bin" "System PostgreSQL"; then
    exit 0
fi

# Try default PATH
if try_restore "/usr/bin" "Default PostgreSQL"; then
    exit 0
fi

echo ""
echo "❌ Could not restore dump with any available PostgreSQL version."
echo ""
echo "🛠️  Alternative solutions:"
echo "1. Install PostgreSQL 17+ (latest version):"
echo "   brew install postgresql"
echo ""
echo "2. Convert dump to SQL format (if you have access to the source database):"
echo "   pg_dump -h source_host -U source_user -d source_db -f strapi_db.sql"
echo ""
echo "3. Use Docker with PostgreSQL 17+:"
echo "   docker run --rm -v \$(pwd):/data postgres:17 pg_restore -h host.docker.internal -p 5432 -U atentamente -d strapi --clean --if-exists /data/strapi_db_2025-06-28.dump"
echo ""
echo "4. Skip restoration and run migration directly (if database already has base structure):"
echo "   npm run cli test \"./test-data/apilado-universal.csv\""

exit 1