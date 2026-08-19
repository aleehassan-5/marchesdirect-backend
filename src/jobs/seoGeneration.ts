import cron from 'node-cron';
import { db } from '../config/database';
import { logger } from '../utils/logger';

// ============================================================================
// SEO PAGE GENERATION AT SCALE (Milestone 11)
// Structure inspired by France Marchés: one page per (trade x city/region/department),
// auto-generated from real, current opportunity data (not static templates).
// ============================================================================

const slugify = (text: string) =>
  text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const generatePagesForBrand = async (brandId: string) => {
  let created = 0;
  let updated = 0;

  // Trade x Region combinations with at least one active opportunity
  const combos = await db.query(
    `SELECT t.id as trade_id, t.name as trade_name, o.location_region,
            COUNT(o.id) as opp_count
     FROM opportunities o
     JOIN trades t ON o.trade_id = t.id
     WHERE o.status = 'active' AND o.deleted_at IS NULL
       AND o.location_region IS NOT NULL
     GROUP BY t.id, t.name, o.location_region
     HAVING COUNT(o.id) > 0`
  );

  for (const combo of combos.rows) {
    const slug = `${slugify(combo.trade_name)}-${slugify(combo.location_region)}`;
    const title = `${combo.trade_name} - Appels d'offres et marchés publics en ${combo.location_region}`;
    const metaDescription = `${combo.opp_count} opportunités actuelles en ${combo.trade_name} dans la région ${combo.location_region}. Mis à jour automatiquement.`;
    const content = `Découvrez les opportunités de marché en ${combo.trade_name} dans la région ${combo.location_region}. Actuellement ${combo.opp_count} opportunité(s) active(s) sur la plateforme.`;

    const existing = await db.query('SELECT id FROM seo_pages WHERE page_slug = $1', [slug]);

    if (existing.rows.length > 0) {
      await db.query(
        `UPDATE seo_pages SET page_title = $1, page_meta_description = $2, page_content = $3, updated_at = NOW()
         WHERE id = $4`,
        [title, metaDescription, content, existing.rows[0].id]
      );
      updated++;
    } else {
      await db.query(
        `INSERT INTO seo_pages
          (brand_id, page_type, page_slug, page_title, page_meta_description, page_content, filter_trade_id, filter_region, is_published)
         VALUES ($1, 'trade_region', $2, $3, $4, $5, $6, $7, true)`,
        [brandId, slug, title, metaDescription, content, combo.trade_id, combo.location_region]
      );
      created++;
    }
  }

  return { created, updated };
};

const runSEOGeneration = async () => {
  try {
    const brands = await db.query('SELECT id FROM brands');
    let totalCreated = 0;
    let totalUpdated = 0;

    for (const brand of brands.rows) {
      const { created, updated } = await generatePagesForBrand(brand.id);
      totalCreated += created;
      totalUpdated += updated;
    }

    logger.info(`[Job] SEO generation complete: ${totalCreated} created, ${totalUpdated} updated`);
    return { created: totalCreated, updated: totalUpdated };
  } catch (err) {
    logger.error('[Job] SEO generation failed:', err);
    return { created: 0, updated: 0 };
  }
};

export const startSEOGeneration = () => {
  // Run once daily at 04:00 (after data collection has settled)
  cron.schedule('0 4 * * *', () => {
    logger.info('[Job] Running daily SEO page generation...');
    runSEOGeneration();
  });

  logger.info('✅ SEO generation job scheduled (daily at 04:00)');
};

export const runSEOGenerationOnce = runSEOGeneration;
