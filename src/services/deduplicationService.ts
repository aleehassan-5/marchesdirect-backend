import { db } from '../config/database';
import { logger } from '../utils/logger';

// ============================================================================
// DEDUPLICATION LOGIC (MILESTONE 3)
// ============================================================================

/**
 * Detect and merge duplicate opportunities across different data sources
 * Example: Same tender published on BOAMP and PLACE with slight formatting differences
 */

export const deduplicateOpportunities = async (): Promise<number> => {
  try {
    // Find potential duplicates by comparing similar titles and deadlines
    const potentialDuplicates = await db.query(`
      SELECT 
        o1.id as id1,
        o2.id as id2,
        o1.title,
        o2.title,
        similarity(o1.title, o2.title) as title_similarity,
        ABS(EXTRACT(EPOCH FROM (o1.deadline - o2.deadline))) as deadline_diff_seconds
      FROM opportunities o1
      JOIN opportunities o2 ON 
        o1.source_id < o2.source_id AND  -- Avoid duplicates
        o1.id < o2.id AND                 -- Ensure consistent ordering
        similarity(o1.title, o2.title) > 0.75 AND  -- Title similarity threshold
        ABS(EXTRACT(EPOCH FROM (o1.deadline - o2.deadline))) < 86400 AND  -- Within 24 hours
        o1.deleted_at IS NULL AND o2.deleted_at IS NULL AND
        o1.status NOT IN ('cancelled', 'expired') AND o2.status NOT IN ('cancelled', 'expired')
      WHERE NOT EXISTS (
        SELECT 1 FROM opportunity_duplicates 
        WHERE (primary_opportunity_id = o1.id AND duplicate_opportunity_id = o2.id)
           OR (primary_opportunity_id = o2.id AND duplicate_opportunity_id = o1.id)
      )
      ORDER BY title_similarity DESC
      LIMIT 100
    `);

    logger.info(`Found ${potentialDuplicates.rows.length} potential duplicates`);

    let mergedCount = 0;

    for (const dup of potentialDuplicates.rows) {
      const similarity = dup.title_similarity;
      const deadlineDiff = dup.deadline_diff_seconds;

      // More aggressive matching: if titles are 85%+ similar AND deadlines are within 24 hours
      if (similarity > 0.85 && deadlineDiff < 86400) {
        const merged = await mergeDuplicates(dup.id1, dup.id2, similarity);
        if (merged) mergedCount++;
      }
    }

    logger.info(`Merged ${mergedCount} duplicate opportunity pairs`);
    return mergedCount;
  } catch (err) {
    logger.error('Deduplication error:', err);
    return 0;
  }
};

/**
 * Merge two opportunities, keeping one as primary and marking the other as duplicate
 */
const mergeDuplicates = async (
  primaryId: string,
  secondaryId: string,
  similarity: number
): Promise<boolean> => {
  try {
    await db.transaction(async (client) => {
      // Record the duplicate relationship
      await client.query(
        `INSERT INTO opportunity_duplicates 
          (primary_opportunity_id, duplicate_opportunity_id, similarity_score, matching_fields)
         VALUES ($1, $2, $3, $4)`,
        [
          primaryId,
          secondaryId,
          Math.round(similarity * 100) / 100,
          JSON.stringify({ title: true, deadline: true }),
        ]
      );

      // Merge metadata (take non-null values from secondary)
      const secondary = await client.query(
        'SELECT * FROM opportunities WHERE id = $1',
        [secondaryId]
      );

      const sec = secondary.rows[0];

      await client.query(
        `UPDATE opportunities SET
          estimated_value = COALESCE(estimated_value, $1),
          location_latitude = COALESCE(location_latitude, $2),
          location_longitude = COALESCE(location_longitude, $3),
          updated_at = NOW()
         WHERE id = $4`,
        [sec.estimated_value, sec.location_latitude, sec.location_longitude, primaryId]
      );

      // Optionally mark secondary as merged (don't delete for audit trail)
      await client.query(
        'UPDATE opportunities SET status = $1, updated_at = NOW() WHERE id = $2',
        ['merged', secondaryId]
      );
    });

    logger.debug(`Merged opportunities: ${primaryId} (primary) + ${secondaryId} (duplicate)`);
    return true;
  } catch (err) {
    logger.error(`Failed to merge duplicates (${primaryId}, ${secondaryId}):`, err);
    return false;
  }
};

/**
 * Find best match for a given opportunity across other sources
 * Used for matching aggregated/scraped data to official sources
 */
export const findMatchingOpportunity = async (
  title: string,
  deadline: Date,
  sourceId: number
): Promise<string | null> => {
  try {
    const result = await db.query(`
      SELECT o.id,
             similarity($1, o.title) as title_sim,
             ABS(EXTRACT(EPOCH FROM ($2::timestamp - o.deadline))) as deadline_diff
      FROM opportunities o
      WHERE o.source_id != $3
        AND o.deleted_at IS NULL
        AND o.status NOT IN ('cancelled', 'expired')
        AND similarity($1, o.title) > 0.8
        AND ABS(EXTRACT(EPOCH FROM ($2::timestamp - o.deadline))) < 86400
      ORDER BY title_sim DESC, deadline_diff ASC
      LIMIT 1
    `, [title, deadline, sourceId]);

    return result.rows.length > 0 ? result.rows[0].id : null;
  } catch (err) {
    logger.error('Error finding matching opportunity:', err);
    return null;
  }
};

/**
 * Verify deduplication quality (proof for Milestone 3)
 * Import same data twice and verify zero duplicates are created
 */
export const verifyDeduplicationQuality = async () => {
  try {
    // Check for records with exact same source_reference from same source
    const result = await db.query(`
      SELECT source_id, source_reference, COUNT(*) as count
      FROM opportunities
      WHERE deleted_at IS NULL
      GROUP BY source_id, source_reference
      HAVING COUNT(*) > 1
    `);

    const duplicates = result.rows;

    if (duplicates.length > 0) {
      logger.warn(`⚠️  Found ${duplicates.length} duplicate source references!`);
      duplicates.forEach(dup => {
        logger.warn(`  Source ${dup.source_id}, Ref ${dup.source_reference}: ${dup.count} records`);
      });
      return false;
    }

    logger.info('✅ Deduplication verified: No exact duplicates found');

    // Also check for cross-source duplicates that were properly merged
    const mergedCount = await db.query(`
      SELECT COUNT(*) as count FROM opportunity_duplicates
    `);

    logger.info(`✅ Successfully merged ${mergedCount.rows[0].count} opportunity pairs across sources`);
    return true;
  } catch (err) {
    logger.error('Deduplication verification failed:', err);
    return false;
  }
};

/**
 * Generate report of deduplication activity (for audit/compliance)
 */
export const getDeduplicationReport = async () => {
  try {
    const report = {
      total_opportunities: 0,
      duplicates_detected: 0,
      duplicates_merged: 0,
      by_source: {},
      by_date: {},
    };

    // Total opportunities
    const totalResult = await db.query(
      'SELECT COUNT(*) as count FROM opportunities WHERE deleted_at IS NULL'
    );
    report.total_opportunities = parseInt(totalResult.rows[0].count);

    // Merged duplicates
    const mergedResult = await db.query(
      'SELECT COUNT(*) as count FROM opportunity_duplicates'
    );
    report.duplicates_merged = parseInt(mergedResult.rows[0].count);

    // By source
    const bySourceResult = await db.query(`
      SELECT ds.name, COUNT(o.id) as count
      FROM data_sources ds
      LEFT JOIN opportunities o ON ds.id = o.source_id
      WHERE o.deleted_at IS NULL
      GROUP BY ds.id, ds.name
    `);

    bySourceResult.rows.forEach(row => {
      report.by_source[row.name] = row.count;
    });

    return report;
  } catch (err) {
    logger.error('Failed to generate deduplication report:', err);
    throw err;
  }
};
