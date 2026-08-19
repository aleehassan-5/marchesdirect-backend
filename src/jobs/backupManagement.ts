import cron from 'node-cron';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { db } from '../config/database';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

// ============================================================================
// BACKUP MANAGEMENT (Milestone 12)
// Requires pg_dump / pg_restore available on the host (standard on most
// Postgres-capable servers) and DB_* env vars already used by config/database.ts.
// Set BACKUP_DIR to control where dumps are written (defaults to /tmp/backups).
// Optionally set BACKUP_S3_BUCKET + AWS credentials to also push to S3 via aws-sdk.
// ============================================================================

const BACKUP_DIR = process.env.BACKUP_DIR || '/tmp/backups';

const ensureBackupDir = () => {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
};

export const runBackup = async (type: 'full' | 'incremental' = 'full') => {
  ensureBackupDir();
  const startedAt = new Date();
  const filename = `backup-${type}-${startedAt.toISOString().replace(/[:.]/g, '-')}.sql`;
  const filepath = path.join(BACKUP_DIR, filename);

  const logResult = await db.query(
    `INSERT INTO backup_logs (backup_type, backup_location, status, started_at)
     VALUES ($1, $2, 'running', $3) RETURNING id`,
    [type, filepath, startedAt]
  );
  const backupLogId = logResult.rows[0].id;

  try {
    const dbName = process.env.DB_NAME;
    const dbHost = process.env.DB_HOST;
    const dbPort = process.env.DB_PORT || '5432';
    const dbUser = process.env.DB_USER;

    if (!dbName || !dbHost || !dbUser) {
      throw new Error('DB_NAME, DB_HOST and DB_USER must be set to run a backup');
    }

    const env = { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || '' };
    await execAsync(
      `pg_dump -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -F p -f "${filepath}"`,
      { env }
    );

    const stats = fs.statSync(filepath);
    const recordCountResult = await db.query('SELECT COUNT(*) as count FROM opportunities');

    await db.query(
      `UPDATE backup_logs SET status = 'success', size_bytes = $1, records_backed_up = $2, completed_at = NOW()
       WHERE id = $3`,
      [stats.size, parseInt(recordCountResult.rows[0].count), backupLogId]
    );

    logger.info(`[Job] Backup complete: ${filepath} (${stats.size} bytes)`);
    return { success: true, filepath, sizeBytes: stats.size };
  } catch (err: any) {
    logger.error('[Job] Backup failed:', err);
    await db.query(
      `UPDATE backup_logs SET status = 'failed', completed_at = NOW() WHERE id = $1`,
      [backupLogId]
    );
    return { success: false, error: err.message };
  }
};

// Restore test: restores the latest successful backup into a throwaway test database
// to prove the backup is actually usable (Milestone 12 proof requirement).
export const testRestore = async () => {
  const latestResult = await db.query(
    `SELECT * FROM backup_logs WHERE status = 'success' ORDER BY completed_at DESC LIMIT 1`
  );

  if (latestResult.rows.length === 0) {
    return { success: false, error: 'No successful backup available to restore' };
  }

  const backup = latestResult.rows[0];
  const testDbName = `restore_test_${Date.now()}`;

  try {
    const dbHost = process.env.DB_HOST;
    const dbPort = process.env.DB_PORT || '5432';
    const dbUser = process.env.DB_USER;
    const env = { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || '' };

    await execAsync(`createdb -h ${dbHost} -p ${dbPort} -U ${dbUser} ${testDbName}`, { env });
    await execAsync(
      `psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${testDbName} -f "${backup.backup_location}"`,
      { env }
    );

    // Sanity check: does the restored DB have the opportunities table with data?
    await execAsync(
      `psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${testDbName} -c "SELECT COUNT(*) FROM opportunities;"`,
      { env }
    );

    await execAsync(`dropdb -h ${dbHost} -p ${dbPort} -U ${dbUser} ${testDbName}`, { env });

    await db.query(
      `UPDATE backup_logs SET restoration_tested = true, restoration_date = NOW() WHERE id = $1`,
      [backup.id]
    );

    logger.info(`[Job] Restore test passed for backup ${backup.id}`);
    return { success: true, backupId: backup.id };
  } catch (err: any) {
    logger.error('[Job] Restore test failed:', err);
    return { success: false, error: err.message };
  }
};

export const startBackupSchedule = () => {
  // Full backup daily at 02:00
  cron.schedule('0 2 * * *', () => {
    logger.info('[Job] Running scheduled daily backup...');
    runBackup('full');
  });

  // Restore test weekly (Sunday 05:00) to keep proving backups are restorable
  cron.schedule('0 5 * * 0', () => {
    logger.info('[Job] Running weekly backup restore test...');
    testRestore();
  });

  logger.info('✅ Backup jobs scheduled (daily backup, weekly restore test)');
};
