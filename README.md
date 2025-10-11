# MySQL Database Backup & Migration Tool

A Python tool for backing up and migrating 200+ MySQL databases from one server to another using XLSX credentials file.

## Features

- Bulk export of multiple MySQL databases using mysqldump
- Bulk import to new server with automatic database/user creation
- XLSX-based credential management
- Detailed logging for troubleshooting
- Progress tracking with success/failure counts
- Automatic backup file matching
- Timeout handling for large databases
- Preserves stored procedures, triggers, and events

## Requirements

- Python 3.6+
- MySQL client tools (`mysql`, `mysqldump`)
- MySQL server with appropriate permissions

## Installation

### 1. Clone or download this repository

```bash
git clone <your-repo-url>
cd database-backup
```

### 2. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 3. Generate sample credentials file

```bash
python3 create_sample_xlsx.py
```

This creates `database_credentials_SAMPLE.xlsx` showing the structure you need.

### 4. Create your credentials file

Copy `database_credentials_SAMPLE.xlsx` to `database_credentials.xlsx` and fill it with your actual database credentials:

| Column | Description | Example |
|--------|-------------|---------|
| database_name | Name of the database | `myapp_db` |
| username | MySQL username | `myapp_user` |
| password | MySQL password | `SecurePass123!` |
| host | MySQL host | `localhost` or IP address |

**IMPORTANT**: The credentials file should contain all 200+ databases you want to backup/migrate.

## Usage

### Step 1: Export Databases (Old Server)

1. SSH into your old server
2. Clone this repository
3. Create and fill `database_credentials.xlsx` with all database credentials
4. Run the export script:

```bash
python3 export.py
```

The script will:
- Read all databases from the XLSX file
- Create mysqldump backups for each database
- Save SQL files to `backups/` directory
- Generate detailed logs in `logs/` directory

**Output**: `backups/` folder containing all SQL dump files (e.g., `myapp_db_20241011_150430.sql`)

### Step 2: Transfer Files to New Server

1. Copy the following to your new server:
   - `backups/` folder (contains all SQL dumps)
   - `database_credentials.xlsx` (same credentials file)
   - All Python scripts

```bash
# Example using scp
scp -r backups/ database_credentials.xlsx *.py requirements.txt user@newserver:/path/to/database-backup/
```

2. Or commit the code to git (backups/ is gitignored), then manually copy the backups folder

### Step 3: Import Databases (New Server)

1. SSH into your new server
2. Navigate to the project directory
3. Ensure `backups/` and `database_credentials.xlsx` are present
4. Run the import script:

```bash
python3 import.py
```

The script will:
- Prompt for MySQL root credentials
- Create databases and users based on credentials file
- Import SQL dumps into respective databases
- Preserve original usernames and passwords
- Generate detailed logs

## File Structure

```
database-backup/
├── export.py                           # Export script (old server)
├── import.py                           # Import script (new server)
├── create_sample_xlsx.py               # Helper to generate sample XLSX
├── requirements.txt                     # Python dependencies
├── database_credentials.xlsx            # Your credentials (gitignored)
├── database_credentials_SAMPLE.xlsx     # Sample template
├── backups/                            # SQL dumps (gitignored)
│   ├── myapp_db_20241011_150430.sql
│   ├── analytics_db_20241011_150445.sql
│   └── ...
└── logs/                               # Execution logs (gitignored)
    ├── export_20241011_150430.log
    └── import_20241011_160530.log
```

## Security Notes

- `database_credentials.xlsx` contains sensitive credentials - keep it secure
- `backups/` folder contains your database data - keep it secure
- Both are automatically gitignored
- Use secure methods (SCP, SFTP) to transfer files between servers
- Delete backup files after successful migration
- Consider encrypting the backups folder during transfer

## Logging

Both scripts generate detailed logs in the `logs/` directory:

- **export_YYYYMMDD_HHMMSS.log**: Export operation details
- **import_YYYYMMDD_HHMMSS.log**: Import operation details

Logs include:
- Progress for each database
- Success/failure status
- Error messages
- File sizes
- Timing information

## Troubleshooting

### Export Issues

**Error: "mysqldump: command not found"**
- Install MySQL client tools: `sudo apt-get install mysql-client` (Ubuntu/Debian)

**Error: "Access denied for user"**
- Verify credentials in `database_credentials.xlsx`
- Ensure the user has SELECT privileges on the database

**Timeout errors**
- Increase timeout in export.py (default: 300 seconds)
- Large databases may need more time

### Import Issues

**Error: "Can't connect to MySQL server"**
- Verify MySQL is running on new server
- Check host/port settings
- Verify firewall rules

**Error: "Access denied" during import**
- Verify root credentials provided during import
- Root user needs CREATE DATABASE and CREATE USER privileges

**Error: "No backup file found"**
- Ensure `backups/` folder was copied correctly
- Check that SQL files exist in backups directory

### Permission Issues

Export requires:
- SELECT privilege on all databases
- LOCK TABLES privilege (for --single-transaction)

Import requires:
- Root or admin privileges to create databases and users
- Or pre-existing databases with proper user permissions

## Advanced Options

### Modify Backup Settings

Edit `export.py` to customize mysqldump options:

```python
cmd = [
    'mysqldump',
    f'--host={host}',
    f'--user={username}',
    f'--password={password}',
    '--single-transaction',  # InnoDB safe
    '--routines',            # Include stored procedures
    '--triggers',            # Include triggers
    '--events',              # Include events
    '--add-drop-database',   # Add DROP DATABASE statements
    '--databases',
    db_name
]
```

### Modify Timeout Values

- Export timeout: edit `timeout=300` in export.py (line with subprocess.run)
- Import timeout: edit `timeout=600` in import.py (line with subprocess.run)

### Selective Import

To import only specific databases, edit `database_credentials.xlsx` and remove rows for databases you don't want to import.

## Best Practices

1. **Test First**: Test with a few databases before running on all 200+
2. **Backup Verification**: Verify a few backups manually after export
3. **Incremental Migration**: Consider migrating in batches if needed
4. **Monitor Disk Space**: Ensure sufficient space for all backups
5. **Keep Logs**: Save logs for troubleshooting and audit purposes
6. **Database Downtime**: Plan for downtime during migration
7. **Verify After Import**: Check a few databases after import to ensure data integrity

## Example Workflow

### Complete Migration Process

```bash
# OLD SERVER
# ----------
cd /path/to/database-backup
pip3 install -r requirements.txt

# Create sample and fill with your data
python3 create_sample_xlsx.py
# Edit database_credentials.xlsx with all 200+ databases

# Export all databases
python3 export.py
# Wait for completion, check logs/export_*.log

# Transfer to new server
scp -r backups/ database_credentials.xlsx *.py requirements.txt user@newserver:/path/

# NEW SERVER
# ----------
cd /path/to/database-backup
pip3 install -r requirements.txt

# Import all databases
python3 import.py
# Enter root credentials when prompted
# Wait for completion, check logs/import_*.log

# Verify databases
mysql -u root -p -e "SHOW DATABASES;"

# Test a few databases for data integrity
mysql -u myapp_user -p myapp_db -e "SELECT COUNT(*) FROM users;"
```

## License

MIT License - feel free to modify and use as needed.

## Support

If you encounter issues:
1. Check the log files in `logs/` directory
2. Verify credentials in XLSX file
3. Ensure MySQL client tools are installed
4. Check MySQL server status and permissions

## Credits

Created for bulk MySQL database migration. Handles 200+ databases efficiently with detailed logging and error handling.
