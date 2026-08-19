import { Router, Response } from 'express';
import { db } from '../config/database';
import { logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/tenders/bids/mine - list all bid responses for the logged-in company
router.get('/bids/mine', async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.query as Record<string, string>;
    const conditions = ['br.company_id = $1'];
    const params: any[] = [req.user!.companyId];

    if (status) {
      conditions.push('br.status = $2');
      params.push(status);
    }

    const result = await db.query(
      `SELECT br.id, br.status, br.submission_deadline, br.submitted_at, br.total_bid_amount,
              o.id as opportunity_id, o.title, o.deadline, o.location_city
       FROM bid_responses br
       JOIN tenders t ON br.tender_id = t.id
       JOIN opportunities o ON t.opportunity_id = o.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY br.updated_at DESC`,
      params
    );

    res.json(result.rows);
  } catch (err: any) {
    logger.error('My bids list error:', err);
    res.status(500).json({ error: 'Failed to fetch bid responses' });
  }
});

// GET /api/tenders/:opportunityId - fetch or lazily create tender record for an opportunity
router.get('/:opportunityId', async (req: AuthRequest, res: Response) => {
  try {
    let result = await db.query('SELECT * FROM tenders WHERE opportunity_id = $1', [
      req.params.opportunityId,
    ]);

    if (result.rows.length === 0) {
      result = await db.query(
        `INSERT INTO tenders (opportunity_id, dce_analysis_status) VALUES ($1, 'not_analyzed') RETURNING *`,
        [req.params.opportunityId]
      );
    }

    res.json(result.rows[0]);
  } catch (err: any) {
    logger.error('Tender fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch tender' });
  }
});

// GET /api/tenders/:tenderId/bid - fetch this company's bid response for a tender (auto-create draft)
router.get('/:tenderId/bid', async (req: AuthRequest, res: Response) => {
  try {
    let result = await db.query(
      'SELECT * FROM bid_responses WHERE tender_id = $1 AND company_id = $2',
      [req.params.tenderId, req.user!.companyId]
    );

    if (result.rows.length === 0) {
      result = await db.query(
        `INSERT INTO bid_responses (tender_id, company_id, status) VALUES ($1, $2, 'draft') RETURNING *`,
        [req.params.tenderId, req.user!.companyId]
      );
    }

    res.json(result.rows[0]);
  } catch (err: any) {
    logger.error('Bid fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch bid response' });
  }
});

// PUT /api/tenders/bid/:bidId - update bid response (pricing, engagement act, memo edits)
router.put('/bid/:bidId', async (req: AuthRequest, res: Response) => {
  try {
    const fields = [
      'technical_memo_text', 'is_technical_memo_approved', 'engagement_act_text',
      'is_engagement_act_signed', 'pricing_schedule_json', 'total_bid_amount',
      'submission_deadline', 'status',
    ];

    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${idx++}`);
        params.push(
          field === 'pricing_schedule_json' ? JSON.stringify(req.body[field]) : req.body[field]
        );
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(req.params.bidId, req.user!.companyId);
    const result = await db.query(
      `UPDATE bid_responses SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${idx++} AND company_id = $${idx}
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bid response not found' });
    }

    res.json(result.rows[0]);
  } catch (err: any) {
    logger.error('Bid update error:', err);
    res.status(500).json({ error: 'Failed to update bid response' });
  }
});

// POST /api/tenders/bid/:bidId/generate - auto-generate documents from the reusable company profile
// (DC1/DC2/DUME, engagement act, technical memo, pricing schedule) — Milestone 9
router.post('/bid/:bidId/generate', async (req: AuthRequest, res: Response) => {
  try {
    const bidResult = await db.query(
      `SELECT br.*, t.opportunity_id FROM bid_responses br
       JOIN tenders t ON br.tender_id = t.id
       WHERE br.id = $1 AND br.company_id = $2`,
      [req.params.bidId, req.user!.companyId]
    );

    if (bidResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bid response not found' });
    }

    const [companyResult, referencesResult, policiesResult, documentsResult] = await Promise.all([
      db.query('SELECT * FROM companies WHERE id = $1', [req.user!.companyId]),
      db.query('SELECT * FROM company_references WHERE company_id = $1 ORDER BY completion_date DESC LIMIT 5', [req.user!.companyId]),
      db.query('SELECT * FROM company_policies WHERE company_id = $1', [req.user!.companyId]),
      db.query(
        `SELECT document_type FROM company_documents
         WHERE company_id = $1 AND deleted_at IS NULL AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE)`,
        [req.user!.companyId]
      ),
    ]);

    const company = companyResult.rows[0];
    const references = referencesResult.rows;
    const policies = policiesResult.rows;
    const availableDocTypes = documentsResult.rows.map((d) => d.document_type);

    // Required documents for a standard French public tender response
    const requiredDocTypes = ['kbis', 'insurance', 'dc1', 'dc2', 'dume', 'attestation_fiscale', 'attestation_sociale'];
    const missingDocuments = requiredDocTypes.filter((d) => !availableDocTypes.includes(d));

    // Build technical memo from company's own real data (no invented facts)
    const referencesText = references.length
      ? references
          .map((r) => `- ${r.project_name} (${r.client_name || 'client confidentiel'}, ${r.completion_date || 'date non renseignee'})`)
          .join('\n')
      : 'Aucune reference enregistree dans le profil entreprise.';

    const qualityPolicy = policies.find((p) => p.policy_type === 'quality');
    const safetyPolicy = policies.find((p) => p.policy_type === 'safety');

    const technicalMemoText = `MEMOIRE TECHNIQUE\n\nEntreprise: ${company.name}\nSIRET: ${company.siret || 'non renseigne'}\nEffectif: ${company.employee_count || 'non renseigne'}\n\nREFERENCES:\n${referencesText}\n\nPOLITIQUE QUALITE:\n${qualityPolicy?.policy_text || 'Non renseignee dans le profil entreprise.'}\n\nPOLITIQUE SECURITE:\n${safetyPolicy?.policy_text || 'Non renseignee dans le profil entreprise.'}`;

    const engagementActText = `ACTE D'ENGAGEMENT\n\nRaison sociale: ${company.name}\nForme juridique: ${company.legal_form || 'non renseignee'}\nSIRET: ${company.siret || 'non renseigne'}\nAdresse: ${company.address_street || ''}, ${company.address_city || ''}\n\nLe soussigne s'engage sur la base de son offre a executer les prestations dans les conditions definies au present acte d'engagement.`;

    const result = await db.query(
      `UPDATE bid_responses SET
         technical_memo_text = $1,
         technical_memo_version = technical_memo_version + 1,
         engagement_act_text = $2,
         missing_documents = $3,
         status = 'in_progress',
         updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [technicalMemoText, engagementActText, JSON.stringify(missingDocuments), req.params.bidId]
    );

    res.json({
      bid: result.rows[0],
      missingDocuments,
      note: missingDocuments.length > 0
        ? 'Certains documents obligatoires manquent dans le profil entreprise et doivent etre ajoutes avant soumission.'
        : 'Tous les documents obligatoires sont presents dans le profil entreprise.',
    });
  } catch (err: any) {
    logger.error('Bid document generation error:', err);
    res.status(500).json({ error: 'Failed to generate bid documents' });
  }
});

export default router;
