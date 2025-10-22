#!/usr/bin/env node

import { spawn } from 'child_process';
import { existsSync, readdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import * as readline from 'readline';
import ExcelJS from 'exceljs';
import chalk from 'chalk';

interface DatabaseCredentials {
  database_name: string;
  username: string;
  password: string;
  host: string;
}

interface RootCredentials {
  host: string;
  user: string;
  password: string;
}

interface ImportStats {
  total: number;
  successful: number;
  failed: number;
  skipped: number;
}

const DEFAULT_CREDENTIALS_FILE = 'database_credentials.xlsx';
const DEFAULT_BACKUP_DIR = 'backups';
const DEFAULT_LOG_DIR = 'logs';

function parseArgs() {
  const args = process.argv.slice(2);
  const credentialsIndex = args.findIndex((arg) => arg === '--credentials' || arg === '-c');
  const backupDirIndex = args.findIndex((arg) => arg === '--input' || arg === '-i');

  const credentialsFile = credentialsIndex !== -1 ? args[credentialsIndex + 1] : DEFAULT_CREDENTIALS_FILE;
  const backupDir = backupDirIndex !== -1 ? args[backupDirIndex + 1] : DEFAULT_BACKUP_DIR;

  // Show help if requested
  if (args.includes('--help') || args.includes('-h')) {
    console.log(chalk.bold.cyan('\n📚 MySQL Database Import Tool - Usage\n'));
    console.log('Usage: npm run import [options]\n');
    console.log('Options:');
    console.log('  -c, --credentials <file>   Path to credentials XLSX file (default: database_credentials.xlsx)');
    console.log('  -i, --input <dir>          Input directory containing backups (default: backups)');
    console.log('  -h, --help                 Show this help message\n');
    console.log('Examples:');
    console.log('  npm run import');
    console.log('  npm run import -- --credentials my_dbs.xlsx');
    console.log('  npm run import -- -c prod_databases.xlsx -i prod_backups\n');
    process.exit(0);
  }

  return { credentialsFile, backupDir, logDir: DEFAULT_LOG_DIR };
}

class Logger {
  private logFile: string;
  private logStream: string[] = [];

  constructor(logDir: string) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T');
    const dateTime = `${timestamp[0]}_${timestamp[1].split('-')[0]}`;
    this.logFile = join(logDir, `import_${dateTime}.log`);
  }

  log(message: string, level: 'info' | 'error' | 'warning' | 'success' = 'info') {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} - ${level.toUpperCase()} - ${message}`;
    this.logStream.push(logMessage);

    // Console output with colors
    switch (level) {
      case 'error':
        console.log(chalk.red(`❌ ${message}`));
        break;
      case 'warning':
        console.log(chalk.yellow(`⚠️  ${message}`));
        break;
      case 'success':
        console.log(chalk.green(`✅ ${message}`));
        break;
      default:
        console.log(chalk.blue(`ℹ️  ${message}`));
    }

    // Write to file periodically
    if (this.logStream.length % 10 === 0) {
      this.flush();
    }
  }

  flush() {
    writeFileSync(this.logFile, this.logStream.join('\n') + '\n');
  }

  getLogFile() {
    return this.logFile;
  }
}

async function readCredentials(credentialsFile: string, logger: Logger): Promise<DatabaseCredentials[]> {
  if (!existsSync(credentialsFile)) {
    logger.log(`Credentials file not found: ${credentialsFile}`, 'error');
    logger.log('Please create the credentials XLSX file with your database information.', 'error');
    process.exit(1);
  }

  logger.log(`Reading credentials from ${credentialsFile}`, 'info');

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(credentialsFile);
    const worksheet = workbook.worksheets[0];

    const databases: DatabaseCredentials[] = [];

    // Skip header row (row 1)
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header

      const values = row.values as any[];
      const dbName = values[1]?.toString().trim();

      if (dbName) {
        databases.push({
          database_name: dbName,
          username: values[2]?.toString().trim() || '',
          password: values[3]?.toString().trim() || '',
          host: values[4]?.toString().trim() || 'localhost',
        });
      }
    });

    logger.log(`Found ${databases.length} databases to import`, 'success');
    return databases;
  } catch (error) {
    logger.log(`Error reading credentials file: ${error}`, 'error');
    process.exit(1);
  }
}

async function getRootCredentials(): Promise<RootCredentials> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (query: string): Promise<string> => {
    return new Promise((resolve) => rl.question(query, resolve));
  };

  console.log(chalk.bold.cyan('\n🔐 MySQL Root Credentials Required'));
  console.log(chalk.cyan('To create databases and users, we need root MySQL access.\n'));

  const host = (await question('MySQL Root Host [localhost]: ')) || 'localhost';
  const user = (await question('MySQL Root Username [root]: ')) || 'root';
  const password = await question('MySQL Root Password: ');

  rl.close();

  if (!password) {
    console.log(chalk.red('\n❌ Root password cannot be empty'));
    process.exit(1);
  }

  return { host, user, password };
}

function findBackupFile(dbName: string, backupPath: string): string | null {
  if (!existsSync(backupPath)) {
    return null;
  }

  const files = readdirSync(backupPath);
  const backupFiles = files
    .filter((file) => file.startsWith(`${dbName}_`) && file.endsWith('.sql'))
    .sort()
    .reverse(); // Most recent first

  return backupFiles.length > 0 ? join(backupPath, backupFiles[0]) : null;
}

async function createDatabaseAndUser(
  dbInfo: DatabaseCredentials,
  rootCreds: RootCredentials,
  logger: Logger
): Promise<boolean> {
  const { database_name, username, password, host } = dbInfo;

  logger.log(`Creating database and user for: ${database_name}`, 'info');

  const sqlCommands = `
    CREATE DATABASE IF NOT EXISTS \`${database_name}\`;
    CREATE USER IF NOT EXISTS '${username}'@'${host}' IDENTIFIED BY '${password}';
    GRANT ALL PRIVILEGES ON \`${database_name}\`.* TO '${username}'@'${host}';
    FLUSH PRIVILEGES;
  `;

  return new Promise((resolve) => {
    const args = [
      `--host=${rootCreds.host}`,
      `--user=${rootCreds.user}`,
      `--password=${rootCreds.password}`,
      '--skip-ssl',
      '-e',
      sqlCommands,
    ];

    const mysql = spawn('mysql', args);
    const errors: string[] = [];

    mysql.stderr.on('data', (data) => {
      errors.push(data.toString());
    });

    mysql.on('close', (code) => {
      if (code === 0) {
        logger.log(`Database and user created: ${database_name}`, 'success');
        resolve(true);
      } else {
        logger.log(`Failed to create database/user for ${database_name}: ${errors.join('')}`, 'error');
        resolve(false);
      }
    });

    mysql.on('error', (error) => {
      logger.log(`Error creating database/user for ${database_name}: ${error.message}`, 'error');
      resolve(false);
    });
  });
}

async function importDatabaseWithHost(
  dbInfo: DatabaseCredentials,
  backupFile: string,
  targetHost: string,
  logger: Logger
): Promise<boolean> {
  const { database_name, username, password } = dbInfo;

  return new Promise((resolve) => {
    const args = [
      `--host=${targetHost}`,
      `--user=${username}`,
      `--password=${password}`,
      '--skip-ssl',
      database_name,
    ];

    const mysql = spawn('mysql', args);
    const errors: string[] = [];
    let stdinClosed = false;

    // Read SQL file content
    const sqlContent = readFileSync(backupFile);

    mysql.stderr.on('data', (data) => {
      errors.push(data.toString());
    });

    mysql.on('close', (code) => {
      if (code === 0) {
        const sizeMB = (sqlContent.length / (1024 * 1024)).toFixed(2);
        logger.log(`Import successful: ${database_name} (${sizeMB} MB) using host: ${targetHost}`, 'success');
        resolve(true);
      } else {
        resolve(false);
      }
    });

    mysql.on('error', (error) => {
      stdinClosed = true;
      resolve(false);
    });

    mysql.stdin.on('error', (error) => {
      stdinClosed = true;
      resolve(false);
    });

    // Write data only if stdin is writable
    try {
      if (!stdinClosed) {
        mysql.stdin.write(sqlContent);
        mysql.stdin.end();
      }
    } catch (error) {
      resolve(false);
    }

    // 10 minute timeout
    setTimeout(() => {
      mysql.kill();
      resolve(false);
    }, 10 * 60 * 1000);
  });
}

async function importDatabase(
  dbInfo: DatabaseCredentials,
  backupFile: string,
  logger: Logger
): Promise<boolean> {
  const { database_name, host } = dbInfo;

  logger.log(`Importing backup: ${database_name}`, 'info');

  // Try with the specified host first
  let success = await importDatabaseWithHost(dbInfo, backupFile, host, logger);

  if (!success && host === 'localhost') {
    // If localhost failed, try 127.0.0.1
    logger.log(`Localhost failed, retrying with 127.0.0.1...`, 'warning');
    success = await importDatabaseWithHost(dbInfo, backupFile, '127.0.0.1', logger);
  } else if (!success && host === '127.0.0.1') {
    // If 127.0.0.1 failed, try localhost
    logger.log(`127.0.0.1 failed, retrying with localhost...`, 'warning');
    success = await importDatabaseWithHost(dbInfo, backupFile, 'localhost', logger);
  }

  if (!success) {
    logger.log(`Import failed for ${database_name} with both connection methods`, 'error');
  }

  return success;
}

async function main() {
  const config = parseArgs();
  const logger = new Logger(config.logDir);

  console.log(chalk.bold.cyan('\n' + '='.repeat(60)));
  console.log(chalk.bold.cyan('🚀 MySQL Database Import Tool'));
  console.log(chalk.bold.cyan('='.repeat(60) + '\n'));

  // Check if backup directory exists
  if (!existsSync(config.backupDir)) {
    logger.log(`Backup directory not found: ${config.backupDir}`, 'error');
    logger.log('Please ensure you have copied the backups folder from the old server.', 'error');
    process.exit(1);
  }

  // Read credentials
  const databases = await readCredentials(config.credentialsFile, logger);

  // Get root credentials
  const rootCreds = await getRootCredentials();

  // Process each database
  const stats: ImportStats = {
    total: databases.length,
    successful: 0,
    failed: 0,
    skipped: 0,
  };

  for (let i = 0; i < databases.length; i++) {
    const dbInfo = databases[i];

    console.log(chalk.bold.cyan('\n' + '='.repeat(60)));
    console.log(chalk.bold(`[${i + 1}/${stats.total}] Processing ${dbInfo.database_name}`));
    console.log(chalk.bold.cyan('='.repeat(60)));

    // Find backup file
    const backupFile = findBackupFile(dbInfo.database_name, config.backupDir);

    if (!backupFile) {
      logger.log(`No backup file found for ${dbInfo.database_name}, skipping...`, 'warning');
      stats.skipped++;
      continue;
    }

    logger.log(`Found backup: ${backupFile.split('/').pop()}`, 'info');

    // Create database and user
    const setupSuccess = await createDatabaseAndUser(dbInfo, rootCreds, logger);
    if (!setupSuccess) {
      logger.log(`Skipping import for ${dbInfo.database_name} due to setup failure`, 'error');
      stats.failed++;
      continue;
    }

    // Import database
    const importSuccess = await importDatabase(dbInfo, backupFile, logger);
    if (importSuccess) {
      stats.successful++;
    } else {
      stats.failed++;
    }
  }

  // Flush remaining logs
  logger.flush();

  // Summary
  console.log(chalk.bold.cyan('\n' + '='.repeat(60)));
  console.log(chalk.bold.cyan('📊 Import Summary'));
  console.log(chalk.bold.cyan('='.repeat(60)));
  console.log(`Total databases: ${stats.total}`);
  console.log(chalk.green(`✅ Successful: ${stats.successful}`));
  console.log(chalk.red(`❌ Failed: ${stats.failed}`));
  console.log(chalk.yellow(`⚠️  Skipped: ${stats.skipped}`));
  console.log(`📋 Log file: ${logger.getLogFile()}`);
  console.log(chalk.bold.cyan('='.repeat(60) + '\n'));

  if (stats.failed > 0 || stats.skipped > 0) {
    console.log(chalk.yellow('⚠️  Some imports failed or were skipped. Please check the log file for details.\n'));
    process.exit(1);
  } else {
    console.log(chalk.green.bold('🎉 All imports completed successfully!\n'));
  }
}

main().catch((error) => {
  console.error(chalk.red(`\n❌ Unexpected error: ${error.message}\n`));
  process.exit(1);
});
