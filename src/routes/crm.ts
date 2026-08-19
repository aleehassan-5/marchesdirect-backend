import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { logger } from '../utils/logger';

const router = Router();

// NOTE: this router is mounted behind `authenticate` in server.ts, which fits
// admin/staff reviewing captured leads. If public marketing pages need to submit
// leads without login, add a separate public route in server.ts before this one.

// GET /api/crm/leads - list captured leads (admin/staff)
router.get('/leads', async (req: Request, res: Response) => {
  try {
    const { status, brand_id, page = '1', limit = '50' } = req.query as Record<string, string>;

    const conditions: string[] = ['1=1'];
    const params: any[] = [];
    let idx = 1;

    if (status) {
      conditions.push(`status = $${idx++}`);
      params.push(status);
    }
    if (brand_id) {
      conditions.push(`brand_id = $${idx++}`);
      params.push(brand_id);
    }

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const offset = (pageNum - 1) * limitNum;

    const result = await db.query(
      `SELECT * FROM crm_leads WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limitNum, offset]
    );

    res.json(result.rows);
  } catch (err: any) {
    logger.error('CRM leads list error:', err);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

// POST /api/crm/leads - capture a new lead
router.post('/leads', async (req: Request, res: Response) => {
  try {
    const {
      brandId, firstName, lastName, email, phone, companyName,
      industryTrade, locationCity, locationRegion, leadSource,
    } = req.body;

    if (!brandId || !email) {
      return res.status(400).json({ error: 'brandId and email are required' });
    }

    const result = await db.query(
      `INSERT INTO crm_leads
        (brand_id, first_name, last_name, email, phone, company_name, industry_trade,
         location_city, location_region, lead_source, crm_sync_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
       RETURNING *`,
      [
        brandId, firstName, lastName, email, phone, companyName,
        industryTrade, locationCity, locationRegion, leadSource || 'signup',
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    logger.error('CRM lead capture error:', err);
    res.status(500).json({ error: 'Failed to capture lead' });
  }
});

// PUT /api/crm/leads/:id/status
router.put('/leads/:id/status', async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    const result = await db.query(
      'UPDATE crm_leads SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    logger.error('CRM lead status update error:', err);
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

export default router;
