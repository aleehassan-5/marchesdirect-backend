import { Router, Response } from 'express';
import { db } from '../config/database';
import { logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/alerts - list alerts for the logged-in company
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { unread_only } = req.query;
    const conditions = ['company_id = $1'];
    const params: any[] = [req.user!.companyId];

    if (unread_only === 'true') {
      conditions.push('is_read = false');
    }

    const result = await db.query(
      `SELECT * FROM company_alerts WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT 100`,
      params
    );

    res.json(result.rows);
  } catch (err: any) {
    logger.error('Alerts list error:', err);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// PUT /api/alerts/:id/read - mark an alert as read
router.put('/:id/read', async (req: AuthRequest, res: Response) => {
  try {
    const result = await db.query(
      `UPDATE company_alerts SET is_read = true, read_at = NOW()
       WHERE id = $1 AND company_id = $2 RETURNING *`,
      [req.params.id, req.user!.companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    res.json(result.rows[0]);
  } catch (err: any) {
    logger.error('Alert mark-read error:', err);
    res.status(500).json({ error: 'Failed to update alert' });
  }
});

// PUT /api/alerts/read-all - mark all as read
router.put('/read-all', async (req: AuthRequest, res: Response) => {
  try {
    await db.query(
      'UPDATE company_alerts SET is_read = true, read_at = NOW() WHERE company_id = $1 AND is_read = false',
      [req.user!.companyId]
    );
    res.json({ success: true });
  } catch (err: any) {
    logger.error('Alerts mark-all-read error:', err);
    res.status(500).json({ error: 'Failed to update alerts' });
  }
});

export default router;
