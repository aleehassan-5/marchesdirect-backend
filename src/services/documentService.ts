import PDFDocument from 'pdfkit';
import archiver from 'archiver';
import { PassThrough } from 'stream';
import { logger } from '../utils/logger';
import { generateDC1, generateDC2, generateDUMESummary, DC2References } from './cerfaFormService';

// ============================================================================
// DOCUMENT GENERATION (MILESTONE 9)
// ============================================================================
//
// Turns the bid_responses text fields (already populated in tenders.ts from the
// company's own profile data) into real downloadable files, bundled as a
// single ZIP - matching the acceptance criteria in Payment_Terms_v1_2.
//
// DC1 / DC2 / DUME: the official government forms (economie.gouv.fr/daj) are
// distributed as Word templates, not fillable PDFs - there is no official
// Cerfa-numbered fillable PDF for DC1/DC2 to fill with pdf-lib. cerfaFormService
// reproduces their exact section structure (verified against the official
// notices explicatives) as real .docx files instead - the same format the
// government itself distributes. DUME has no static template at all (it's a
// live EU/French online service); its fixed Part I-VI structure per EU
// Implementing Regulation 2016/7 is reproduced the same way, for manual
// transposition into the official online tool.

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
  company: {
    name: string;
    legal_form?: string | null;
    siret?: string | null;
    address_street?: string | null;
    address_city?: string | null;
    address_postal_code?: string | null;
    email: string;
    phone?: string | null;
    employee_count?: number | null;
    annual_revenue?: number | null;
    founding_year?: number | null;
  };
  buyer: {
    name?: string | null;
    reference?: string | null;
    title: string;
    lotDescription?: string | null;
  };
  references: DC2References;
  technicalMemoText: string;
  engagementActText: string;
  pricingSchedule: Array<{ label: string; quantity?: number; unit?: string; unit_price?: number }>;
  missingDocuments: string[];
};

/**
 * Generate the full bid package (technical memo, engagement act, pricing schedule,
 * and real DC1/DC2/DUME documents matching the official government structure) and
 * bundle them into one ZIP. Returns the ZIP as a Buffer - caller decides whether to
 * upload to S3 or stream it directly to the client.
 */
export async function generateBidPackageZip(input: BidPackageInput): Promise<Buffer> {
  const [technicalMemoPdf, engagementActPdf, pricingSchedulePdf, dc1Docx, dc2Docx, dumeDocx] = await Promise.all([
    textToPdfBuffer('MEMOIRE TECHNIQUE', input.technicalMemoText),
    textToPdfBuffer("ACTE D'ENGAGEMENT", input.engagementActText),
    pricingScheduleToPdfBuffer(input.company.name, input.pricingSchedule),
    generateDC1(input.company, input.buyer),
    generateDC2(input.company, input.buyer, input.references),
    generateDUMESummary(input.company, input.buyer),
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
    archive.append(dc1Docx as Buffer, { name: '04-DC1-lettre-candidature.docx' });
    archive.append(dc2Docx as Buffer, { name: '05-DC2-declaration-candidat.docx' });
    archive.append(dumeDocx as Buffer, { name: '06-DUME-synthese.docx' });

    if (input.missingDocuments.length > 0) {
      const missingNote = Buffer.from(
        `PIECES MANQUANTES A FOURNIR AVANT SOUMISSION (depuis le profil entreprise):\n\n- ${input.missingDocuments.join('\n- ')}`,
        'utf-8'
      );
      archive.append(missingNote, { name: '00-PIECES-MANQUANTES.txt' });
    }

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
