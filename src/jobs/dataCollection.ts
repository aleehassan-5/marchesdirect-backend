import cron from 'node-cron';
import { db } from '../config/database';
import { logger } from '../utils/logger';
import { scheduleDataCollection } from '../services/dataCollectionService';
import { classifyUnanalyzedOpportunities, generateSummariesForOpportunities } from '../services/aiService';
import { deduplicateOpportunities } from '../services/deduplicationService';

// ============================================================================
// AUTOMATED DATA COLLECTION (Milestone 2 & 3)
// Runs BOAMP + any other active source (e.g. PLACE) with NO manual trigger,
// every 2-6 hours (configurable per source via data_sources.frequency_hours).
// Each run also cross-checks for duplicates across sources.
// ============================================================================

export const startScheduledJobs = () => {
  // Run collection every 2 hours; each source internally respects its own
  // frequency_hours / next_run so this just checks "is anything due".
  cron.schedule('0 */2 * * *', async () => {
    logger.info('[Job] Running scheduled data collection (all active sources)...');
    try {
      await scheduleDataCollection();

      // Extra dedup sweep across all active sources after each collection run,
      // so a listing seen on two sources in the same run gets merged immediately.
      const merged = await deduplicateOpportunities();
      logger.info(`[Job] Post-collection dedup sweep merged ${merged} pairs`);
    } catch (err) {
      logger.error('[Job] Data collection run failed:', err);
    }
  });

  // Classify + summarize newly collected opportunities every hour (Milestone 6 & 7)
  cron.schedule('30 * * * *', async () => {
    logger.info('[Job] Running AI classification batch...');
    try {
      await classifyUnanalyzedOpportunities(200);
      await generateSummariesForOpportunities(100);
    } catch (err) {
      logger.error('[Job] AI batch job failed:', err);
    }
  });

  logger.info('✅ Data collection jobs scheduled (every 2h collection, hourly AI classification)');
};

// Manual trigger, useful for demonstrating "3 automatic runs" proof (Milestone 2)
export const runOnce = async () => {
  logger.info('[Job] Manual data collection run triggered');
  await scheduleDataCollection();
  const merged = await deduplicateOpportunities();
  return { merged };
};

export const getConnectorProof = async () => {
  const result = await db.query(
    `SELECT ds.code, ds.active, ds.last_run, ds.next_run, ds.frequency_hours,
            cl.status, cl.records_fetched, cl.records_processed, cl.started_at, cl.completed_at
     FROM data_sources ds
     LEFT JOIN LATERAL (
       SELECT * FROM connector_logs WHERE source_id = ds.id ORDER BY started_at DESC LIMIT 3
     ) cl ON true
     ORDER BY ds.code, cl.started_at DESC`
  );
  return result.rows;
};
