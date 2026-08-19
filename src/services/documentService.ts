import PDFDocument from 'pdfkit';
import archiver from 'archiver';
import { PassThrough } from 'stream';
import { logger } from '../utils/logger';

// ============================================================================
// DOCUMENT GENERATION (MILESTONE 9)
// ============================================================================
//
// Turns the bid_responses text fields (already populated in tenders.ts from the
// company's own profile data) into real downloadable PDF files, bundled as a
// single ZIP - matching the acceptance criteria in Payment_Terms_v1_2.
//
// IMPORTANT - what this does NOT do yet:
// DC1, DC2 and DUME are official French government forms (Cerfa n°15905*xx,
// 15906*xx, and the DUME XML/PDF format published on marches-publics.gouv.fr).
// Correctly reproducing their exact official layout requires downloading the
// real fillable templates from service-public.fr/entreprises and filling their
// actual form fields (e.g. with pdf-lib) - not reconstructing them from memory,
// since a wrong field layout on a real administrative form is a compliance risk,
// not just a cosmetic bug. Until those templates are sourced, this generates a
// clearly-labelled "DC1/DC2/DUME - administrative summary" PDF containing the
// same structured data (company identity, references, declarations) ready to be
// transposed into the official forms by hand, or by pdf-lib once the templates
// are added.

function textToPdfBuffer(title: string, body: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).font('Helvetica-Bold').text(title, { align: 'left' });
    doc.moveDown();
    doc.fontSize(10).font('Helvetica').text(body, { align: 'left', lineGap: 4 });

    doc.end();
  });
}

function pricingScheduleToPdfBuffer(
  companyName: string,
  pricingSchedule: Array<{ label: string; quantity?: number; unit?: string; unit_price?: number }>
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).font('Helvetica-Bold').text('BORDEREAU DE PRIX UNITAIRES (BPU)');
    doc.fontSize(10).font('Helvetica').text(`Entreprise: ${companyName}`);
    doc.moveDown();

    const rows = pricingSchedule && pricingSchedule.length > 0
      ? pricingSchedule
      : [{ label: 'Aucun poste renseigne dans le profil - a completer avant soumission.' }];

    let total = 0;
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('Designation', 50, doc.y, { continued: true, width: 250 });
    doc.text('Qte', 300, doc.y, { continued: true, width: 60 });
    doc.text('Unite', 360, doc.y, { continued: true, width: 60 });
    doc.text('PU HT', 420, doc.y, { width: 100 });
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(9);

    for (const row of rows) {
      const lineTotal = (row.quantity || 0) * (row.unit_price || 0);
      total += lineTotal;
      doc.text(row.label, 50, doc.y, { continued: true, width: 250 });
      doc.text(row.quantity ? String(row.quantity) : '-', 300, doc.y, { continued: true, width: 60 });
      doc.text(row.unit || '-', 360, doc.y, { continued: true, width: 60 });
      doc.text(row.unit_price ? `${row.unit_price.toLocaleString('fr-FR')} EUR` : '-', 420, doc.y, { width: 100 });
    }

    doc.moveDown();
    doc.font('Helvetica-Bold').text(`Total estime HT: ${total.toLocaleString('fr-FR')} EUR`);

    doc.end();
  });
}

export type BidPackageInput = {
  companyName: string;
  technicalMemoText: string;
  engagementActText: string;
  pricingSchedule: Array<{ label: string; quantity?: number; unit?: string; unit_price?: number }>;
  missingDocuments: string[];
  opportunityTitle: string;
};

/**
 * Generate the full bid package (technical memo, engagement act, pricing schedule,
 * DC1/DC2/DUME administrative summary) as real PDFs and bundle them into one ZIP.
 * Returns the ZIP as a Buffer - caller decides whether to upload to S3 or stream
 * it directly to the client.
 */
export async function generateBidPackageZip(input: BidPackageInput): Promise<Buffer> {
  const [technicalMemoPdf, engagementActPdf, pricingSchedulePdf, adminSummaryPdf] = await Promise.all([
    textToPdfBuffer('MEMOIRE TECHNIQUE', input.technicalMemoText),
    textToPdfBuffer("ACTE D'ENGAGEMENT", input.engagementActText),
    pricingScheduleToPdfBuffer(input.companyName, input.pricingSchedule),
    textToPdfBuffer(
      'DC1 / DC2 / DUME - Synthese administrative',
      `Entreprise: ${input.companyName}\nAppel d'offres: ${input.opportunityTitle}\n\n` +
        `Ce document reprend les informations administratives issues du profil entreprise ` +
        `(identite, references, declarations sur l'honneur) a reporter dans les formulaires ` +
        `officiels Cerfa DC1/DC2 et le DUME (marches-publics.gouv.fr). Les gabarits officiels ` +
        `de ces formulaires n'etant pas encore integres au systeme, cette synthese sert de ` +
        `brouillon a transposer manuellement pour cette phase.\n\n` +
        (input.missingDocuments.length
          ? `PIECES MANQUANTES A FOURNIR AVANT SOUMISSION:\n- ${input.missingDocuments.join('\n- ')}`
          : 'Toutes les pieces obligatoires sont presentes dans le profil entreprise.')
    ),
  ]);

  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const passthrough = new PassThrough();
    const chunks: Buffer[] = [];

    passthrough.on('data', (chunk) => chunks.push(chunk));
    passthrough.on('end', () => resolve(Buffer.concat(chunks)));
    passthrough.on('error', reject);
    archive.on('error', reject);

    archive.pipe(passthrough);
    archive.append(technicalMemoPdf, { name: '01-memoire-technique.pdf' });
    archive.append(engagementActPdf, { name: "02-acte-engagement.pdf" });
    archive.append(pricingSchedulePdf, { name: '03-bordereau-prix-unitaires.pdf' });
    archive.append(adminSummaryPdf, { name: '04-dc1-dc2-dume-synthese.pdf' });
    archive.finalize();
  });
}

/**
 * Upload a generated document to S3 if credentials are configured; otherwise
 * logs a warning and returns null so the caller can fall back to a direct
 * download instead of failing the whole request.
 */
export async function uploadToS3IfConfigured(key: string, buffer: Buffer, contentType: string): Promise<string | null> {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_S3_BUCKET) {
    logger.warn('[documentService] AWS S3 not configured - skipping upload, caller should stream the file directly');
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AWS = require('aws-sdk');
    const s3 = new AWS.S3({ region: process.env.AWS_REGION });

    await s3
      .putObject({
        Bucket: process.env.AWS_S3_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
      .promise();

    return `${process.env.AWS_S3_URL}/${key}`;
  } catch (err) {
    logger.error('[documentService] S3 upload failed:', err);
    return null;
  }
}
