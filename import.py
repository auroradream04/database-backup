#!/usr/bin/env python3
"""
Database Import Tool
Reads database credentials from XLSX file and imports SQL dumps to the new server.
Creates databases and users if they don't exist.
"""

import os
import sys
import subprocess
import logging
from datetime import datetime
from pathlib import Path
import openpyxl
import glob

# Configuration
CREDENTIALS_FILE = "database_credentials.xlsx"
BACKUP_DIR = "backups"
LOG_DIR = "logs"

# Setup logging
log_file = Path(LOG_DIR) / f"import_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(log_file),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)


def read_credentials():
    """Read database credentials from XLSX file."""
    if not os.path.exists(CREDENTIALS_FILE):
        logger.error(f"❌ Credentials file not found: {CREDENTIALS_FILE}")
        logger.error("Please create database_credentials.xlsx with your database information.")
        sys.exit(1)

    logger.info(f"📖 Reading credentials from {CREDENTIALS_FILE}")

    try:
        wb = openpyxl.load_workbook(CREDENTIALS_FILE)
        ws = wb.active

        databases = []
        # Skip header row (row 1)
        for row in ws.iter_rows(min_row=2, values_only=True):
            if row[0]:  # Check if database_name is not empty
                db_info = {
                    'database_name': str(row[0]).strip(),
                    'username': str(row[1]).strip() if row[1] else '',
                    'password': str(row[2]).strip() if row[2] else '',
                    'host': str(row[3]).strip() if row[3] else 'localhost'
                }
                databases.append(db_info)

        logger.info(f"✅ Found {len(databases)} databases to import")
        return databases

    except Exception as e:
        logger.error(f"❌ Error reading credentials file: {str(e)}")
        sys.exit(1)


def get_root_credentials():
    """Get root MySQL credentials for creating databases and users."""
    logger.info("\n🔐 MySQL Root Credentials Required")
    logger.info("To create databases and users, we need root MySQL access.")

    root_host = input("MySQL Root Host [localhost]: ").strip() or "localhost"
    root_user = input("MySQL Root Username [root]: ").strip() or "root"
    root_password = input("MySQL Root Password: ").strip()

    if not root_password:
        logger.error("❌ Root password cannot be empty")
        sys.exit(1)

    return {
        'host': root_host,
        'user': root_user,
        'password': root_password
    }


def find_backup_file(db_name, backup_path):
    """
    Find the most recent backup file for a database.

    Args:
        db_name: Name of the database
        backup_path: Path to backup directory

    Returns:
        Path to backup file or None
    """
    # Find all backup files for this database
    pattern = str(backup_path / f"{db_name}_*.sql")
    backup_files = glob.glob(pattern)

    if not backup_files:
        return None

    # Return the most recent one (they have timestamps)
    return max(backup_files, key=os.path.getctime)


def create_database_and_user(db_info, root_creds):
    """
    Create database and user on the new server.

    Args:
        db_info: Dictionary with database credentials
        root_creds: Dictionary with root MySQL credentials

    Returns:
        bool: True if successful, False otherwise
    """
    db_name = db_info['database_name']
    username = db_info['username']
    password = db_info['password']
    host = db_info['host']

    logger.info(f"🔧 Creating database and user for: {db_name}")

    # SQL commands to create database and user
    sql_commands = f"""
    CREATE DATABASE IF NOT EXISTS `{db_name}`;
    CREATE USER IF NOT EXISTS '{username}'@'{host}' IDENTIFIED BY '{password}';
    GRANT ALL PRIVILEGES ON `{db_name}`.* TO '{username}'@'{host}';
    FLUSH PRIVILEGES;
    """

    try:
        # Execute SQL commands using root credentials
        cmd = [
            'mysql',
            f'--host={root_creds["host"]}',
            f'--user={root_creds["user"]}',
            f'--password={root_creds["password"]}',
            '-e',
            sql_commands
        ]

        result = subprocess.run(
            cmd,
            stderr=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            timeout=30
        )

        if result.returncode == 0:
            logger.info(f"✅ Database and user created: {db_name}")
            return True
        else:
            logger.error(f"❌ Failed to create database/user for {db_name}: {result.stderr}")
            return False

    except Exception as e:
        logger.error(f"❌ Error creating database/user for {db_name}: {str(e)}")
        return False


def import_database(db_info, backup_file):
    """
    Import SQL backup file into database.

    Args:
        db_info: Dictionary with database credentials
        backup_file: Path to backup SQL file

    Returns:
        bool: True if successful, False otherwise
    """
    db_name = db_info['database_name']
    username = db_info['username']
    password = db_info['password']
    host = db_info['host']

    logger.info(f"📥 Importing backup: {db_name}")

    try:
        # Import SQL file
        cmd = [
            'mysql',
            f'--host={host}',
            f'--user={username}',
            f'--password={password}',
            db_name
        ]

        with open(backup_file, 'r') as f:
            result = subprocess.run(
                cmd,
                stdin=f,
                stderr=subprocess.PIPE,
                stdout=subprocess.PIPE,
                text=True,
                timeout=600  # 10 minutes timeout per database
            )

        if result.returncode == 0:
            file_size = os.path.getsize(backup_file)
            size_mb = file_size / (1024 * 1024)
            logger.info(f"✅ Import successful: {db_name} ({size_mb:.2f} MB)")
            return True
        else:
            logger.error(f"❌ Import failed for {db_name}: {result.stderr}")
            return False

    except subprocess.TimeoutExpired:
        logger.error(f"❌ Import timeout for {db_name} (exceeded 10 minutes)")
        return False

    except Exception as e:
        logger.error(f"❌ Error importing {db_name}: {str(e)}")
        return False


def main():
    """Main execution function."""
    logger.info("=" * 60)
    logger.info("🚀 MySQL Database Import Tool")
    logger.info("=" * 60)

    # Check if backup directory exists
    backup_path = Path(BACKUP_DIR)
    if not backup_path.exists():
        logger.error(f"❌ Backup directory not found: {BACKUP_DIR}")
        logger.error("Please ensure you have copied the backups folder from the old server.")
        sys.exit(1)

    # Read credentials
    databases = read_credentials()

    # Get root credentials
    root_creds = get_root_credentials()

    # Process each database
    total = len(databases)
    successful = 0
    failed = 0
    skipped = 0

    for idx, db_info in enumerate(databases, 1):
        logger.info(f"\n{'=' * 60}")
        logger.info(f"[{idx}/{total}] Processing {db_info['database_name']}")
        logger.info('=' * 60)

        # Find backup file
        backup_file = find_backup_file(db_info['database_name'], backup_path)

        if not backup_file:
            logger.warning(f"⚠️  No backup file found for {db_info['database_name']}, skipping...")
            skipped += 1
            continue

        logger.info(f"📁 Found backup: {os.path.basename(backup_file)}")

        # Create database and user
        if not create_database_and_user(db_info, root_creds):
            logger.error(f"❌ Skipping import for {db_info['database_name']} due to setup failure")
            failed += 1
            continue

        # Import database
        if import_database(db_info, backup_file):
            successful += 1
        else:
            failed += 1

    # Summary
    logger.info("\n" + "=" * 60)
    logger.info("📊 Import Summary")
    logger.info("=" * 60)
    logger.info(f"Total databases: {total}")
    logger.info(f"✅ Successful: {successful}")
    logger.info(f"❌ Failed: {failed}")
    logger.info(f"⚠️  Skipped: {skipped}")
    logger.info(f"📋 Log file: {log_file}")
    logger.info("=" * 60)

    if failed > 0 or skipped > 0:
        logger.warning("\n⚠️  Some imports failed or were skipped. Please check the log file for details.")
        sys.exit(1)
    else:
        logger.info("\n🎉 All imports completed successfully!")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logger.warning("\n⚠️  Import interrupted by user")
        sys.exit(1)
    except Exception as e:
        logger.error(f"\n❌ Unexpected error: {str(e)}")
        sys.exit(1)
