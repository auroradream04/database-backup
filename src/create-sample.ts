#!/usr/bin/env node

import ExcelJS from 'exceljs';
import chalk from 'chalk';

async function createSampleXlsx() {
  console.log(chalk.bold.cyan('\n🚀 Creating Sample XLSX File\n'));

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Database Credentials');

  // Add headers with styling
  const headerRow = worksheet.addRow(['database_name', 'username', 'password', 'host']);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' },
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' };

  // Add sample data
  const sampleData = [
    ['myapp_db', 'myapp_user', 'secure_password_123', 'localhost'],
    ['analytics_db', 'analytics_user', 'another_password_456', 'localhost'],
    ['staging_db', 'staging_user', 'staging_pass_789', 'localhost'],
  ];

  sampleData.forEach((row) => {
    worksheet.addRow(row);
  });

  // Adjust column widths
  worksheet.getColumn(1).width = 20; // database_name
  worksheet.getColumn(2).width = 20; // username
  worksheet.getColumn(3).width = 25; // password
  worksheet.getColumn(4).width = 15; // host

  // Save the file
  const filename = 'database_credentials_SAMPLE.xlsx';
  await workbook.xlsx.writeFile(filename);

  console.log(chalk.green(`✅ Sample XLSX file created: ${filename}\n`));
  console.log(chalk.bold('Structure:'));
  console.log(chalk.cyan('  Column A: database_name') + ' (name of the database)');
  console.log(chalk.cyan('  Column B: username') + ' (MySQL username for this database)');
  console.log(chalk.cyan('  Column C: password') + ' (MySQL password for this user)');
  console.log(chalk.cyan('  Column D: host') + ' (usually \'localhost\' or IP address)');
  console.log(
    chalk.yellow(
      '\nFill this file with your actual database credentials and save as \'database_credentials.xlsx\'\n'
    )
  );
}

createSampleXlsx().catch((error) => {
  console.error(chalk.red(`\n❌ Error creating sample file: ${error.message}\n`));
  process.exit(1);
});
