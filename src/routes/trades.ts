import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { logger } from '../utils/logger';

const router = Router();

// GET /api/trades - list all trades (for filter dropdowns)
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await db.query(
      `SELECT t.id, t.name, t.slug, t.description, c.code as cpv_code
       FROM trades t
       LEFT JOIN cpv_codes c ON t.cpv_code_id = c.id
       ORDER BY t.name ASC`
    );
    res.json(result.rows);
  } catch (err: any) {
    logger.error('Trades list error:', err);
    res.status(500).json({ error: 'Failed to fetch trades' });
  }
});

// GET /api/trades/:slug - single trade by slug (for SEO pages, Milestone 11)
router.get('/:slug', async (req: Request, res: Response) => {
  try {
    const result = await db.query('SELECT * FROM trades WHERE slug = $1', [req.params.slug]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Trade not found' });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    logger.error('Trade detail error:', err);
    res.status(500).json({ error: 'Failed to fetch trade' });
  }
});

export default router;
