import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { logger } from '../utils/logger';

const router = Router();

// GET /api/brands/current - public, no auth. The CRM lead-capture endpoint
// (POST /api/crm/leads) requires a brandId, but nothing on the frontend had any
// way to get one - there was no public brand lookup at all, so the contact/
// callback forms could never actually submit successfully.
//
// Resolves by matching the request's Host header against brands.domain (for
// when the second-brand duplication in Milestone 10 is live and each brand has
// its own real domain); falls back to the first configured brand otherwise,
// which is correct for local dev and for the single-brand site today.
router.get('/current', async (req: Request, res: Response) => {
  try {
    const host = (req.hostname || '').replace(/^www\./, '');

    let result = await db.query(
      'SELECT id, code, name, language FROM brands WHERE domain = $1 LIMIT 1',
      [host]
    );

    if (result.rows.length === 0) {
      result = await db.query('SELECT id, code, name, language FROM brands ORDER BY created_at ASC LIMIT 1');
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No brand configured' });
    }

    res.json(result.rows[0]);
  } catch (err: any) {
    logger.error('Brand resolution error:', err);
    res.status(500).json({ error: 'Failed to resolve brand' });
  }
});

export default router;
