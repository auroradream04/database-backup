#!/usr/bin/env node

import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import ExcelJS from 'exceljs';
import chalk from 'chalk';

interface DatabaseCredentials {
  database_name: string;
  username: string;
  password: string;
  host: string;
}

interface ExportStats {
  total: number;
  successful: number;
  failed: number;
}

const DEFAULT_CREDENTIALS_FILE = 'database_credentials.xlsx';
const DEFAULT_BACKUP_DIR = 'backups';
const DEFAULT_LOG_DIR = 'logs';

function parseArgs() {
  const args = process.argv.slice(2);
  const credentialsIndex = args.findIndex((arg) => arg === '--credentials' || arg === '-c');
  const backupDirIndex = args.findIndex((arg) => arg === '--output' || arg === '-o');

  const credentialsFile = credentialsIndex !== -1 ? args[credentialsIndex + 1] : DEFAULT_CREDENTIALS_FILE;
  const backupDir = backupDirIndex !== -1 ? args[backupDirIndex + 1] : DEFAULT_BACKUP_DIR;

  // Show help if requested
  if (args.includes('--help') || args.includes('-h')) {
    console.log(chalk.bold.cyan('\n📚 MySQL Database Export Tool - Usage\n'));
    console.log('Usage: npm run export [options]\n');
    console.log('Options:');
    console.log('  -c, --credentials <file>   Path to credentials XLSX file (default: database_credentials.xlsx)');
    console.log('  -o, --output <dir>         Output directory for backups (default: backups)');
    console.log('  -h, --help                 Show this help message\n');
    console.log('Examples:');
    console.log('  npm run export');
    console.log('  npm run export -- --credentials my_dbs.xlsx');
    console.log('  npm run export -- -c prod_databases.xlsx -o prod_backups\n');
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
    this.logFile = join(logDir, `export_${dateTime}.log`);

    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
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

    logger.log(`Found ${databases.length} databases to backup`, 'success');
    return databases;
  } catch (error) {
    logger.log(`Error reading credentials file: ${error}`, 'error');
    process.exit(1);
  }
}

function createBackupDirectory(backupDir: string, logger: Logger): string {
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
    logger.log(`Created backup directory: ${backupDir}`, 'info');
  }
  return backupDir;
}

async function dumpDatabase(
  dbInfo: DatabaseCredentials,
  backupPath: string,
  logger: Logger
): Promise<boolean> {
  const { database_name, username, password, host } = dbInfo;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T');
  const dateTime = `${timestamp[0]}_${timestamp[1].split('-')[0]}`;
  const backupFile = join(backupPath, `${database_name}_${dateTime}.sql`);

  logger.log(`Starting backup: ${database_name}`, 'info');

  return new Promise((resolve) => {
    const args = [
      `--host=${host}`,
      `--user=${username}`,
      `--password=${password}`,
      '--single-transaction',
      '--routines',
      '--triggers',
      '--events',
      '--add-drop-database',
      '--databases',
      database_name,
    ];

    const mysqldump = spawn('mysqldump', args);
    const chunks: Buffer[] = [];
    const errors: string[] = [];

    mysqldump.stdout.on('data', (data) => {
      chunks.push(data);
    });

    mysqldump.stderr.on('data', (data) => {
      errors.push(data.toString());
    });

    mysqldump.on('close', (code) => {
      if (code === 0) {
        const buffer = Buffer.concat(chunks);
        writeFileSync(backupFile, buffer);
        const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
        logger.log(`Backup successful: ${database_name} (${sizeMB} MB)`, 'success');
        resolve(true);
      } else {
        logger.log(`Backup failed for ${database_name}: ${errors.join('')}`, 'error');
        resolve(false);
      }
    });

    mysqldump.on('error', (error) => {
      logger.log(`Error backing up ${database_name}: ${error.message}`, 'error');
      resolve(false);
    });

    // 5 minute timeout
    setTimeout(() => {
      mysqldump.kill();
      logger.log(`Backup timeout for ${database_name} (exceeded 5 minutes)`, 'error');
      resolve(false);
    }, 5 * 60 * 1000);
  });
}

async function main() {
  const config = parseArgs();
  const logger = new Logger(config.logDir);

  console.log(chalk.bold.cyan('\n' + '='.repeat(60)));
  console.log(chalk.bold.cyan('🚀 MySQL Database Export Tool'));
  console.log(chalk.bold.cyan('='.repeat(60) + '\n'));

  // Read credentials
  const databases = await readCredentials(config.credentialsFile, logger);

  // Create backup directory
  const backupPath = createBackupDirectory(config.backupDir, logger);

  // Backup each database
  const stats: ExportStats = {
    total: databases.length,
    successful: 0,
    failed: 0,
  };

  for (let i = 0; i < databases.length; i++) {
    const dbInfo = databases[i];
    console.log(chalk.bold(`\n[${i + 1}/${stats.total}] Processing ${dbInfo.database_name}`));

    const success = await dumpDatabase(dbInfo, backupPath, logger);
    if (success) {
      stats.successful++;
    } else {
      stats.failed++;
    }
  }

  // Flush remaining logs
  logger.flush();

  // Summary
  console.log(chalk.bold.cyan('\n' + '='.repeat(60)));
  console.log(chalk.bold.cyan('📊 Backup Summary'));
  console.log(chalk.bold.cyan('='.repeat(60)));
  console.log(`Total databases: ${stats.total}`);
  console.log(chalk.green(`✅ Successful: ${stats.successful}`));
  console.log(chalk.red(`❌ Failed: ${stats.failed}`));
  console.log(`📁 Backup location: ${join(process.cwd(), backupPath)}`);
  console.log(`📋 Log file: ${logger.getLogFile()}`);
  console.log(chalk.bold.cyan('='.repeat(60) + '\n'));

  if (stats.failed > 0) {
    console.log(chalk.yellow('⚠️  Some backups failed. Please check the log file for details.\n'));
    process.exit(1);
  } else {
    console.log(chalk.green.bold('🎉 All backups completed successfully!\n'));
  }
}

main().catch((error) => {
  console.error(chalk.red(`\n❌ Unexpected error: ${error.message}\n`));
  process.exit(1);
});
