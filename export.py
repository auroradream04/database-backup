#!/usr/bin/env python3
"""
Database Export Tool
Reads database credentials from XLSX file and creates mysqldump backups for each database.
"""

import os
import sys
import subprocess
import logging
from datetime import datetime
from pathlib import Path
import openpyxl

# Configuration
CREDENTIALS_FILE = "database_credentials.xlsx"
BACKUP_DIR = "backups"
LOG_DIR = "logs"

# Setup logging
log_file = Path(LOG_DIR) / f"export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
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

        logger.info(f"✅ Found {len(databases)} databases to backup")
        return databases

    except Exception as e:
        logger.error(f"❌ Error reading credentials file: {str(e)}")
        sys.exit(1)


def create_backup_directory():
    """Create backup directory if it doesn't exist."""
    backup_path = Path(BACKUP_DIR)
    if not backup_path.exists():
        backup_path.mkdir(parents=True)
        logger.info(f"📁 Created backup directory: {BACKUP_DIR}")
    return backup_path


def dump_database(db_info, backup_path):
    """
    Create a mysqldump backup for a single database.

    Args:
        db_info: Dictionary with database credentials
        backup_path: Path object for backup directory

    Returns:
        bool: True if successful, False otherwise
    """
    db_name = db_info['database_name']
    username = db_info['username']
    password = db_info['password']
    host = db_info['host']

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_file = backup_path / f"{db_name}_{timestamp}.sql"

    logger.info(f"🔄 Starting backup: {db_name}")

    # Build mysqldump command
    # Using --single-transaction for InnoDB tables (safer for production)
    # --routines to include stored procedures
    # --triggers to include triggers
    # --events to include events
    cmd = [
        'mysqldump',
        f'--host={host}',
        f'--user={username}',
        f'--password={password}',
        '--single-transaction',
        '--routines',
        '--triggers',
        '--events',
        '--add-drop-database',
        '--databases',
        db_name
    ]

    try:
        # Run mysqldump and redirect output to file
        with open(backup_file, 'w') as f:
            result = subprocess.run(
                cmd,
                stdout=f,
                stderr=subprocess.PIPE,
                text=True,
                timeout=300  # 5 minutes timeout per database
            )

        if result.returncode == 0:
            file_size = backup_file.stat().st_size
            size_mb = file_size / (1024 * 1024)
            logger.info(f"✅ Backup successful: {db_name} ({size_mb:.2f} MB)")
            return True
        else:
            logger.error(f"❌ Backup failed for {db_name}: {result.stderr}")
            # Remove failed backup file
            if backup_file.exists():
                backup_file.unlink()
            return False

    except subprocess.TimeoutExpired:
        logger.error(f"❌ Backup timeout for {db_name} (exceeded 5 minutes)")
        if backup_file.exists():
            backup_file.unlink()
        return False

    except Exception as e:
        logger.error(f"❌ Error backing up {db_name}: {str(e)}")
        if backup_file.exists():
            backup_file.unlink()
        return False


def main():
    """Main execution function."""
    logger.info("=" * 60)
    logger.info("🚀 MySQL Database Export Tool")
    logger.info("=" * 60)

    # Read credentials
    databases = read_credentials()

    # Create backup directory
    backup_path = create_backup_directory()

    # Backup each database
    total = len(databases)
    successful = 0
    failed = 0

    for idx, db_info in enumerate(databases, 1):
        logger.info(f"\n[{idx}/{total}] Processing {db_info['database_name']}")
        if dump_database(db_info, backup_path):
            successful += 1
        else:
            failed += 1

    # Summary
    logger.info("\n" + "=" * 60)
    logger.info("📊 Backup Summary")
    logger.info("=" * 60)
    logger.info(f"Total databases: {total}")
    logger.info(f"✅ Successful: {successful}")
    logger.info(f"❌ Failed: {failed}")
    logger.info(f"📁 Backup location: {backup_path.absolute()}")
    logger.info(f"📋 Log file: {log_file}")
    logger.info("=" * 60)

    if failed > 0:
        logger.warning("\n⚠️  Some backups failed. Please check the log file for details.")
        sys.exit(1)
    else:
        logger.info("\n🎉 All backups completed successfully!")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logger.warning("\n⚠️  Backup interrupted by user")
        sys.exit(1)
    except Exception as e:
        logger.error(f"\n❌ Unexpected error: {str(e)}")
        sys.exit(1)
