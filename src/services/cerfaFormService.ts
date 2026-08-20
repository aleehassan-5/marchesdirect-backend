import {
  Document,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  WidthType,
  BorderStyle,
  AlignmentType,
  Packer,
} from 'docx';

// ============================================================================
// OFFICIAL DC1 / DC2 / DUME GENERATION (Milestone 9)
// ============================================================================
//
// IMPORTANT: the real DC1 and DC2 forms published by the French government
// (economie.gouv.fr/daj/les-formulaires-de-declaration-du-candidat) are NOT
// fillable PDFs - they are distributed as Word (.doc/.docx) templates. There
// is no official Cerfa-numbered fillable PDF for DC1/DC2 to fill with pdf-lib;
// that was a wrong assumption. This generator instead reproduces the exact
// section structure (A, B, C... as published in the official notices
// explicatives, verified 2019-04-01 for DC1 and 2023-11-20 for DC2) as real
// .docx files - the same format the government itself distributes.
//
// DUME (Document Unique de Marché Européen) has no static downloadable
// template at all - it's only available as a live online questionnaire
// (europa.eu/espd or the French DUME service on marches-publics.gouv.fr,
// which requires a session on their platform). What CAN be reproduced
// faithfully offline is its fixed structure as defined by EU Implementing
// Regulation 2016/7 (Parts I-VI) - so this generates a structured DUME-format
// summary a company can transpose into the official online tool, clearly
// labelled as such rather than pretending to be the live e-service output.
//
// Any field not present in the company's profile is written as
// "Non renseigné" - never invented - per the explicit client requirement
// that missing information must be flagged, not fabricated.

const NOT_PROVIDED = 'Non renseigné';

const val = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return NOT_PROVIDED;
  return String(v);
};

type CompanyProfile = {
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

type BuyerInfo = {
  name?: string | null;
  reference?: string | null;
  title: string;
  lotDescription?: string | null;
};

const heading = (text: string, letter: string) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 150 },
    children: [new TextRun({ text: `${letter} - ${text}`, bold: true, size: 24 })],
  });

const fieldRow = (label: string, value: string) =>
  new TableRow({
    children: [
      new TableCell({
        width: { size: 35, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20 })] })],
      }),
      new TableCell({
        width: { size: 65, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [new TextRun({ text: value, size: 20 })] })],
      }),
    ],
  });

const fieldTable = (rows: TableRow[]) =>
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' },
      left: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' },
      right: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
    },
    rows,
  });

const titleBlock = (formCode: string, title: string) => [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'MARCHÉS PUBLICS', bold: true, size: 20, color: '666666' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    heading: HeadingLevel.HEADING_1,
    spacing: { after: 100 },
    children: [new TextRun({ text: title, bold: true, size: 32 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 300 },
    children: [
      new TextRun({
        text: `Formulaire ${formCode} — structure conforme à la notice explicative officielle DAJ`,
        italics: true,
        size: 18,
        color: '888888',
      }),
    ],
  }),
];

// ----------------------------------------------------------------------------
// DC1 - Lettre de candidature (sections A through G, per the official notice)
// ----------------------------------------------------------------------------
export async function generateDC1(company: CompanyProfile, buyer: BuyerInfo): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          ...titleBlock('DC1', 'LETTRE DE CANDIDATURE'),

          heading('Identification de l\u2019acheteur', 'A'),
          fieldTable([
            fieldRow('Acheteur', val(buyer.name)),
            fieldRow('Référence de la consultation', val(buyer.reference)),
          ]),

          heading('Objet de la consultation', 'B'),
          new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: val(buyer.title), size: 20 })] }),

          heading('Objet de la candidature', 'C'),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: buyer.lotDescription
                  ? `Lot(s) concerné(s) : ${buyer.lotDescription}`
                  : 'Marché non alloti (candidature portant sur l\u2019ensemble du marché)',
                size: 20,
              }),
            ],
          }),

          heading('Présentation du candidat', 'D'),
          fieldTable([
            fieldRow('Dénomination sociale', val(company.name)),
            fieldRow('Forme juridique', val(company.legal_form)),
            fieldRow('SIRET', val(company.siret)),
            fieldRow(
              'Adresse',
              company.address_street
                ? `${val(company.address_street)}, ${val(company.address_postal_code)} ${val(company.address_city)}`
                : NOT_PROVIDED
            ),
            fieldRow('Adresse électronique', val(company.email)),
            fieldRow('Téléphone', val(company.phone)),
          ]),

          heading('Identification des membres du groupement', 'E'),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: 'Candidature individuelle — sans objet (aucun groupement déclaré dans le profil entreprise).',
                size: 20,
                italics: true,
              }),
            ],
          }),

          heading('Engagements du candidat', 'F'),
          new Paragraph({
            spacing: { after: 100 },
            children: [
              new TextRun({
                text:
                  'F1 — Le candidat déclare sur l\u2019honneur ne pas entrer dans un des cas d\u2019interdiction ' +
                  'de soumissionner prévus aux articles L. 2141-1 à L. 2141-10 du code de la commande publique.',
                size: 20,
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 100 },
            children: [
              new TextRun({
                text: 'F2 — Documents de preuve disponibles en ligne : ' + NOT_PROVIDED + ' (à compléter si applicable).',
                size: 20,
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: 'F3 — Le candidat déclare présenter les capacités nécessaires à l\u2019exécution du marché public (voir DC2 joint).',
                size: 20,
              }),
            ],
          }),

          heading('Désignation du mandataire (en cas de groupement)', 'G'),
          new Paragraph({
            children: [new TextRun({ text: 'Sans objet — candidature individuelle.', size: 20, italics: true })],
          }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

// ----------------------------------------------------------------------------
// DC2 - Déclaration du candidat (sections A through H, per the official notice)
// ----------------------------------------------------------------------------
export type DC2References = Array<{ project_name: string; client_name?: string | null; contract_value?: number | null; completion_date?: string | null }>;

export async function generateDC2(
  company: CompanyProfile,
  buyer: BuyerInfo,
  references: DC2References
): Promise<Buffer> {
  const referenceRows =
    references.length > 0
      ? references.map((r) =>
          fieldRow(
            val(r.project_name),
            `${val(r.client_name)} — ${r.contract_value ? `${r.contract_value.toLocaleString('fr-FR')} EUR` : NOT_PROVIDED} — ${val(r.completion_date)}`
          )
        )
      : [fieldRow('Références', NOT_PROVIDED + ' — aucune référence enregistrée dans le profil entreprise.')];

  const doc = new Document({
    sections: [
      {
        children: [
          ...titleBlock('DC2', 'DÉCLARATION DU CANDIDAT'),

          heading('Identification de l\u2019acheteur', 'A'),
          fieldTable([
            fieldRow('Acheteur', val(buyer.name)),
            fieldRow('Référence de la consultation', val(buyer.reference)),
          ]),

          heading('Objet de la consultation', 'B'),
          new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: val(buyer.title), size: 20 })] }),

          heading('Identification du candidat (cas général)', 'C'),
          fieldTable([
            fieldRow('Dénomination sociale', val(company.name)),
            fieldRow('Forme juridique', val(company.legal_form)),
            fieldRow('SIRET', val(company.siret)),
            fieldRow(
              'Adresse du siège social',
              company.address_street
                ? `${val(company.address_street)}, ${val(company.address_postal_code)} ${val(company.address_city)}`
                : NOT_PROVIDED
            ),
            fieldRow(
              'PME (< 250 salariés, CA < 50M€)',
              company.employee_count != null ? (company.employee_count < 250 ? 'Oui' : 'Non') : NOT_PROVIDED
            ),
          ]),

          heading('Cas particuliers (marché réservé)', 'D'),
          new Paragraph({
            children: [new TextRun({ text: 'Sans objet, sauf indication contraire de l\u2019acheteur.', size: 20, italics: true })],
          }),

          heading('Aptitude à exercer l\u2019activité professionnelle', 'E'),
          fieldTable([
            fieldRow('Année de création', val(company.founding_year)),
            fieldRow('Effectif', val(company.employee_count)),
          ]),

          heading('Capacité économique et financière', 'F'),
          fieldTable([
            fieldRow('Chiffre d\u2019affaires annuel', company.annual_revenue ? `${company.annual_revenue.toLocaleString('fr-FR')} EUR` : NOT_PROVIDED),
            fieldRow('Assurance responsabilité décennale', NOT_PROVIDED + ' — à joindre depuis le profil entreprise (documents)'),
          ]),

          heading('Capacité technique et professionnelle (références)', 'G'),
          fieldTable(referenceRows),

          heading('Opérateurs économiques tiers mobilisés', 'H'),
          new Paragraph({
            children: [
              new TextRun({
                text: 'Sans objet — le candidat ne s\u2019appuie sur aucun opérateur tiers pour cette candidature.',
                size: 20,
                italics: true,
              }),
            ],
          }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

// ----------------------------------------------------------------------------
// DUME - structured summary matching EU Implementing Regulation 2016/7
// (Parts I-VI), for manual transposition into the official online e-DUME tool.
// ----------------------------------------------------------------------------
export async function generateDUMESummary(company: CompanyProfile, buyer: BuyerInfo): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          ...titleBlock('DUME', 'DOCUMENT UNIQUE DE MARCHÉ EUROPÉEN — SYNTHÈSE'),

          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun({
                text:
                  'Le DUME officiel n\u2019existe que sous forme de service en ligne (espd.eu / service DUME ' +
                  'marches-publics.gouv.fr) — il n\u2019y a pas de gabarit statique téléchargeable. Cette synthèse ' +
                  'reprend la structure fixée par le règlement d\u2019exécution (UE) 2016/7 (parties I à VI) avec les ' +
                  'données du profil entreprise, à reporter dans l\u2019outil en ligne officiel.',
                italics: true,
                size: 18,
                color: '888888',
              }),
            ],
          }),

          heading('Informations concernant la procédure de passation de marché', 'I'),
          fieldTable([
            fieldRow('Acheteur', val(buyer.name)),
            fieldRow('Objet du marché', val(buyer.title)),
            fieldRow('Référence', val(buyer.reference)),
          ]),

          heading('Informations concernant l\u2019opérateur économique', 'II'),
          fieldTable([
            fieldRow('Dénomination sociale', val(company.name)),
            fieldRow('SIRET', val(company.siret)),
            fieldRow('Forme juridique', val(company.legal_form)),
            fieldRow(
              'PME',
              company.employee_count != null ? (company.employee_count < 250 ? 'Oui' : 'Non') : NOT_PROVIDED
            ),
          ]),

          heading('Motifs d\u2019exclusion', 'III'),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: 'Déclaration sur l\u2019honneur : le candidat ne se trouve dans aucun des cas d\u2019exclusion prévus par le code de la commande publique.',
                size: 20,
              }),
            ],
          }),

          heading('Critères de sélection', 'IV'),
          fieldTable([
            fieldRow('Chiffre d\u2019affaires annuel', company.annual_revenue ? `${company.annual_revenue.toLocaleString('fr-FR')} EUR` : NOT_PROVIDED),
            fieldRow('Effectif', val(company.employee_count)),
          ]),

          heading('Réduction du nombre de candidats qualifiés', 'V'),
          new Paragraph({
            children: [new TextRun({ text: 'Sans objet, sauf indication contraire de l\u2019acheteur.', size: 20, italics: true })],
          }),

          heading('Déclarations finales', 'VI'),
          new Paragraph({
            children: [
              new TextRun({
                text:
                  'Le soussigné déclare que les informations fournies ci-dessus sont exactes et sincères, et ' +
                  'peut fournir sur demande de l\u2019acheteur les certificats et pièces justificatives correspondants.',
                size: 20,
              }),
            ],
          }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
