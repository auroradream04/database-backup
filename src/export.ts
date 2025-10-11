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

const CREDENTIALS_FILE = 'database_credentials.xlsx';
const BACKUP_DIR = 'backups';
const LOG_DIR = 'logs';

class Logger {
  private logFile: string;
  private logStream: string[] = [];

  constructor() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T');
    const dateTime = `${timestamp[0]}_${timestamp[1].split('-')[0]}`;
    this.logFile = join(LOG_DIR, `export_${dateTime}.log`);

    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
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

async function readCredentials(logger: Logger): Promise<DatabaseCredentials[]> {
  if (!existsSync(CREDENTIALS_FILE)) {
    logger.log(`Credentials file not found: ${CREDENTIALS_FILE}`, 'error');
    logger.log('Please create database_credentials.xlsx with your database information.', 'error');
    process.exit(1);
  }

  logger.log(`Reading credentials from ${CREDENTIALS_FILE}`, 'info');

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(CREDENTIALS_FILE);
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

function createBackupDirectory(logger: Logger): string {
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
    logger.log(`Created backup directory: ${BACKUP_DIR}`, 'info');
  }
  return BACKUP_DIR;
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
  const logger = new Logger();

  console.log(chalk.bold.cyan('\n' + '='.repeat(60)));
  console.log(chalk.bold.cyan('🚀 MySQL Database Export Tool'));
  console.log(chalk.bold.cyan('='.repeat(60) + '\n'));

  // Read credentials
  const databases = await readCredentials(logger);

  // Create backup directory
  const backupPath = createBackupDirectory(logger);

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
