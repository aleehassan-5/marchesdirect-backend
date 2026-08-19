import axios from 'axios';
import xml2js from 'xml2js';
import Parser from 'rss-parser';
import { db } from '../config/database';
import { logger } from '../utils/logger';
import { deduplicateOpportunities } from './deduplicationService';
import { v4 as uuid } from 'uuid';

const parser = new Parser();

// ============================================================================
// BOAMP CONNECTOR (French Public Procurement)
// ============================================================================

export const collectBoampData = async (sourceId: number) => {
  const logId = uuid();
  
  try {
    logger.info(`[BOAMP] Starting collection (log: ${logId})`);

    const endpoint = process.env.BOAMP_API_ENDPOINT || 'https://api.boamp.fr/v1/notices';
    const apiKey = process.env.BOAMP_API_KEY;

    if (!apiKey) {
      throw new Error('BOAMP_API_KEY not configured');
    }

    // Fetch data from BOAMP (last 24 hours)
    const response = await axios.get(`${endpoint}/search`, {
      params: {
        api_key: apiKey,
        published_from: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        limit: 1000,
      },
      timeout: 30000,
    });

    const notices = response.data.results || [];
    logger.info(`[BOAMP] Fetched ${notices.length} notices`);

    // Process each notice
    let inserted = 0;
    let updated = 0;
    let duplicates = 0;
    let errors = 0;

    for (const notice of notices) {
      try {
        const existing = await db.query(
          'SELECT id FROM opportunities WHERE source_id = $1 AND source_reference = $2',
          [sourceId, notice.boamp_ref]
        );

        if (existing.rows.length > 0) {
          // Update existing
          await updateOpportunity(existing.rows[0].id, notice);
          updated++;
        } else {
          // Insert new
          await insertOpportunity(sourceId, notice);
          inserted++;
        }

        duplicates += await deduplicateOpportunities();
      } catch (err) {
        logger.error(`[BOAMP] Error processing notice ${notice.boamp_ref}:`, err);
        errors++;
      }
    }

    // Log collection
    await db.query(
      `INSERT INTO connector_logs 
        (source_id, status, records_fetched, records_processed, records_failed, started_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [sourceId, 'success', notices.length, inserted + updated, errors, new Date(), new Date()]
    );

    // Update next run time
    await db.query(
      'UPDATE data_sources SET last_run = NOW(), next_run = NOW() + INTERVAL \'6 hours\' WHERE id = $1',
      [sourceId]
    );

    logger.info(`[BOAMP] Collection complete: ${inserted} inserted, ${updated} updated, ${duplicates} duplicates merged`);

    return { inserted, updated, duplicates, errors };
  } catch (err) {
    logger.error(`[BOAMP] Collection failed:`, err);

    await db.query(
      `INSERT INTO connector_logs 
        (source_id, status, error_message, started_at, completed_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [sourceId, 'failed', String(err), new Date(), new Date()]
    );

    throw err;
  }
};

// ============================================================================
// PLACE CONNECTOR (French Government Platform)
// ============================================================================

export const collectPlaceData = async (sourceId: number) => {
  const logId = uuid();

  try {
    logger.info(`[PLACE] Starting collection (log: ${logId})`);

    const endpoint = process.env.PLACE_API_ENDPOINT || 'https://api.place.gouv.fr/v1/notices';
    const apiKey = process.env.PLACE_API_KEY;

    if (!apiKey) {
      throw new Error('PLACE_API_KEY not configured');
    }

    // Fetch from PLACE API
    const response = await axios.get(`${endpoint}/search`, {
      params: {
        api_key: apiKey,
        status: 'open',
        published_after: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      },
      timeout: 30000,
    });

    const notices = response.data.notices || [];
    logger.info(`[PLACE] Fetched ${notices.length} notices`);

    let inserted = 0;
    let updated = 0;
    let duplicates = 0;

    for (const notice of notices) {
      try {
        const existing = await db.query(
          'SELECT id FROM opportunities WHERE source_id = $1 AND source_reference = $2',
          [sourceId, notice.id]
        );

        if (existing.rows.length > 0) {
          await updateOpportunity(existing.rows[0].id, notice);
          updated++;
        } else {
          await insertOpportunity(sourceId, notice);
          inserted++;
        }

        duplicates += await deduplicateOpportunities();
      } catch (err) {
        logger.error(`[PLACE] Error processing notice ${notice.id}:`, err);
      }
    }

    logger.info(`[PLACE] Collection complete: ${inserted} inserted, ${updated} updated`);

    return { inserted, updated, duplicates };
  } catch (err) {
    logger.error(`[PLACE] Collection failed:`, err);
    throw err;
  }
};

// ============================================================================
// TED CONNECTOR (EU Tenders)
// ============================================================================

export const collectTedData = async (sourceId: number) => {
  try {
    logger.info(`[TED] Starting collection`);

    const xmlFeed = 'https://ted.europa.eu/TedRss.do?search=&templateId=0';

    const feed = await parser.parseURL(xmlFeed);
    logger.info(`[TED] Fetched ${feed.items?.length || 0} tenders`);

    let inserted = 0;
    let updated = 0;

    for (const item of feed.items || []) {
      try {
        const tedId = item.guid || item.link;

        const existing = await db.query(
          'SELECT id FROM opportunities WHERE source_id = $1 AND source_reference = $2',
          [sourceId, tedId]
        );

        const opportunity = {
          title: item.title || '',
          description: item.content || item.summary || '',
          deadline: item.isoDate ? new Date(item.isoDate) : null,
          source_reference: tedId,
          opportunity_type: 'public_procurement',
          location_region: 'EU',
        };

        if (existing.rows.length > 0) {
          await updateOpportunity(existing.rows[0].id, opportunity);
          updated++;
        } else {
          await insertOpportunity(sourceId, opportunity);
          inserted++;
        }
      } catch (err) {
        logger.error(`[TED] Error processing item:`, err);
      }
    }

    logger.info(`[TED] Collection complete: ${inserted} inserted, ${updated} updated`);

    return { inserted, updated };
  } catch (err) {
    logger.error(`[TED] Collection failed:`, err);
    throw err;
  }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const insertOpportunity = async (sourceId: number, data: any) => {
  const result = await db.query(
    `INSERT INTO opportunities 
      (source_id, source_reference, title, description, publication_date, deadline, 
       estimated_value, location_city, location_region, opportunity_type_id, 
       raw_data, ai_classification_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 
       (SELECT id FROM opportunity_types WHERE code = 'public_procurement'),
       $10, 'not_analyzed')
     RETURNING id`,
    [
      sourceId,
      data.source_reference || data.boamp_ref || data.id,
      data.title,
      data.description,
      data.publication_date || new Date(),
      data.deadline,
      data.estimated_value,
      data.location_city,
      data.location_region || data.region,
      JSON.stringify(data), // raw_data
    ]
  );

  return result.rows[0];
};

const updateOpportunity = async (opportunityId: string, data: any) => {
  // Only update if status changed (active -> expired, etc.)
  await db.query(
    `UPDATE opportunities 
     SET description = $1, deadline = $2, estimated_value = $3, raw_data = $4, updated_at = NOW()
     WHERE id = $5`,
    [
      data.description,
      data.deadline,
      data.estimated_value,
      JSON.stringify(data),
      opportunityId,
    ]
  );
};

// ============================================================================
// SCHEDULE COLLECTION JOBS
// ============================================================================

export const scheduleDataCollection = async () => {
  logger.info('Scheduling data collection jobs...');

  // Get all active sources
  const sources = await db.query('SELECT * FROM data_sources WHERE active = true');

  for (const source of sources.rows) {
    try {
      switch (source.code) {
        case 'boamp':
          await collectBoampData(source.id);
          break;
        case 'place':
          await collectPlaceData(source.id);
          break;
        case 'ted':
          await collectTedData(source.id);
          break;
        default:
          logger.warn(`Unknown source type: ${source.code}`);
      }
    } catch (err) {
      logger.error(`Failed to collect from ${source.code}:`, err);
    }
  }
};

export const startScheduledCollection = () => {
  const cron = require('node-cron');

  // Run every 6 hours
  cron.schedule('0 */6 * * *', () => {
    logger.info('Running scheduled data collection...');
    scheduleDataCollection().catch(err => logger.error('Collection job error:', err));
  });

  logger.info('✅ Data collection scheduler started (runs every 6 hours)');
};
