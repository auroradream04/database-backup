# MySQL Database Backup & Migration Tool

A TypeScript/Node.js tool for backing up and migrating 200+ MySQL databases from one server to another using XLSX credentials file.

## Features

- Bulk export of multiple MySQL databases using mysqldump
- Bulk import to new server with automatic database/user creation
- XLSX-based credential management
- Beautiful colored console output
- Detailed logging for troubleshooting
- Progress tracking with success/failure counts
- Automatic backup file matching
- Timeout handling for large databases
- Preserves stored procedures, triggers, and events

## Requirements

- Node.js 18+
- MySQL client tools (`mysql`, `mysqldump`)
- MySQL server with appropriate permissions

## Installation

### 1. Clone this repository

```bash
git clone https://github.com/auroradream04/database-backup.git
cd database-backup
```

### 2. Install dependencies

```bash
npm install
```

### 3. Generate sample credentials file

```bash
npm run create-sample
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
2. Clone this repository and install dependencies
3. Create and fill `database_credentials.xlsx` with all database credentials
4. Run the export script:

```bash
npm run export
```

The script will:
- Read all databases from the XLSX file
- Create mysqldump backups for each database
- Save SQL files to `backups/` directory
- Generate detailed logs in `logs/` directory

**Output**: `backups/` folder containing all SQL dump files (e.g., `myapp_db_2024-10-11_150430.sql`)

### Step 2: Transfer Files to New Server

1. Copy the following to your new server:
   - `backups/` folder (contains all SQL dumps)
   - `database_credentials.xlsx` (same credentials file)
   - The entire project

```bash
# Example using scp
scp -r backups/ database_credentials.xlsx user@newserver:/path/to/database-backup/
```

2. Or commit the code to git (backups/ is gitignored), then manually copy the backups folder

### Step 3: Import Databases (New Server)

1. SSH into your new server
2. Navigate to the project directory
3. Ensure `backups/` and `database_credentials.xlsx` are present
4. Run the import script:

```bash
npm run import
```

The script will:
- Prompt for MySQL root credentials
- Create databases and users based on credentials file
- Import SQL dumps into respective databases
- Preserve original usernames and passwords
- Generate detailed logs

## Available Scripts

```bash
npm run export         # Export databases (create backups)
npm run import         # Import databases (restore backups)
npm run create-sample  # Create sample XLSX template
npm run build          # Compile TypeScript to JavaScript
```

## File Structure

```
database-backup/
├── src/
│   ├── export.ts                       # Export script (old server)
│   ├── import.ts                       # Import script (new server)
│   └── create-sample.ts                # Helper to generate sample XLSX
├── package.json                        # Node.js dependencies
├── tsconfig.json                       # TypeScript configuration
├── database_credentials.xlsx           # Your credentials (gitignored)
├── database_credentials_SAMPLE.xlsx    # Sample template
├── backups/                           # SQL dumps (gitignored)
│   ├── myapp_db_2024-10-11_150430.sql
│   ├── analytics_db_2024-10-11_150445.sql
│   └── ...
└── logs/                              # Execution logs (gitignored)
    ├── export_2024-10-11_150430.log
    └── import_2024-10-11_160530.log
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

- **export_YYYY-MM-DD_HHMMSS.log**: Export operation details
- **import_YYYY-MM-DD_HHMMSS.log**: Import operation details

Logs include:
- Progress for each database
- Success/failure status
- Error messages
- File sizes
- Timing information

## Troubleshooting

### Export Issues

**Error: "mysqldump: command not found"**
- Install MySQL client tools:
  - Ubuntu/Debian: `sudo apt-get install mysql-client`
  - macOS: `brew install mysql-client`

**Error: "Access denied for user"**
- Verify credentials in `database_credentials.xlsx`
- Ensure the user has SELECT privileges on the database

**Timeout errors**
- Increase timeout in src/export.ts (default: 5 minutes)
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

### Modify Timeout Values

Edit the timeout values in the source files:
- **Export timeout**: `src/export.ts` - line with `5 * 60 * 1000` (5 minutes)
- **Import timeout**: `src/import.ts` - line with `10 * 60 * 1000` (10 minutes)

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
npm install

# Create sample and fill with your data
npm run create-sample
# Edit database_credentials.xlsx with all 200+ databases

# Export all databases
npm run export
# Wait for completion, check logs/export_*.log

# Transfer to new server
scp -r backups/ database_credentials.xlsx user@newserver:/path/to/database-backup/

# NEW SERVER
# ----------
cd /path/to/database-backup
npm install

# Import all databases
npm run import
# Enter root credentials when prompted
# Wait for completion, check logs/import_*.log

# Verify databases
mysql -u root -p -e "SHOW DATABASES;"

# Test a few databases for data integrity
mysql -u myapp_user -p myapp_db -e "SELECT COUNT(*) FROM users;"
```

## Why TypeScript?

This tool is built with TypeScript/Node.js for:
- **Zero Python dependency issues** - No pip, no virtual environments
- **Native async/await** - Better handling of concurrent operations
- **Type safety** - Catch errors before runtime
- **Modern tooling** - Fast execution with tsx
- **Cross-platform** - Works on macOS, Linux, and Windows

## License

MIT License - feel free to modify and use as needed.

## Support

If you encounter issues:
1. Check the log files in `logs/` directory
2. Verify credentials in XLSX file
3. Ensure MySQL client tools are installed
4. Check MySQL server status and permissions

## Credits

Created for bulk MySQL database migration. Handles 200+ databases efficiently with detailed logging, colored output, and error handling.
