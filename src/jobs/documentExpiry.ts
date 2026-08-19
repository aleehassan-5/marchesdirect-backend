import cron from 'node-cron';
import { db } from '../config/database';
import { logger } from '../utils/logger';

// ============================================================================
// DOCUMENT EXPIRY CHECK (Milestone 9 support)
// Marks company documents as expired and raises in-app alerts:
// - 30 days before expiry (reminder)
// - on the day it actually expires
// ============================================================================

const checkExpiringDocuments = async () => {
  try {
    // Mark newly expired documents
    const expiredResult = await db.query(
      `UPDATE company_documents
       SET is_expired = true, updated_at = NOW()
       WHERE deleted_at IS NULL AND is_expired = false
         AND expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE
       RETURNING id, company_id, document_type, document_name`
    );

    for (const doc of expiredResult.rows) {
      await db.query(
        `INSERT INTO company_alerts (company_id, alert_type, title, message)
         VALUES ($1, 'document_expiry', $2, $3)`,
        [
          doc.company_id,
          `Document expiré : ${doc.document_name || doc.document_type}`,
          `Le document "${doc.document_name || doc.document_type}" a expiré. Merci de le mettre à jour dans votre profil entreprise pour continuer à répondre aux appels d'offres.`,
        ]
      );
    }

    // Reminders 30 days before expiry (send once)
    const reminderResult = await db.query(
      `UPDATE company_documents
       SET expiry_reminder_sent = true
       WHERE deleted_at IS NULL AND is_expired = false AND expiry_reminder_sent = false
         AND expiry_date IS NOT NULL
         AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
       RETURNING id, company_id, document_type, document_name, expiry_date`
    );

    for (const doc of reminderResult.rows) {
      await db.query(
        `INSERT INTO company_alerts (company_id, alert_type, title, message)
         VALUES ($1, 'document_expiry', $2, $3)`,
        [
          doc.company_id,
          `Document bientôt expiré : ${doc.document_name || doc.document_type}`,
          `Le document "${doc.document_name || doc.document_type}" expire le ${doc.expiry_date}. Pensez à le renouveler.`,
        ]
      );
    }

    if (expiredResult.rows.length || reminderResult.rows.length) {
      logger.info(
        `[Job] Document expiry check: ${expiredResult.rows.length} newly expired, ${reminderResult.rows.length} reminders sent`
      );
    }
  } catch (err) {
    logger.error('[Job] Document expiry check failed:', err);
  }
};

export const startExpiryCheck = () => {
  // Run once daily at 03:00
  cron.schedule('0 3 * * *', () => {
    logger.info('[Job] Running daily document expiry check...');
    checkExpiringDocuments();
  });

  logger.info('✅ Document expiry job scheduled (daily at 03:00)');
};

export const runExpiryCheckOnce = checkExpiringDocuments;
