/**
 * FICTIONAL financing demo: products for the three demo banks, verification and application
 * papers for two businesses, one application submitted to three banks (two offers, one
 * decline) and one draft. Rates, fees and terms are invented examples entered "by the banks";
 * they are data, not platform settings. Document files are tiny placeholder PDFs, uploaded to
 * the local S3 (MinIO) when reachable; without storage the documents part is skipped.
 */
import { PutObjectCommand } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import { computeInstallment, computeTotalCost, fromCentimes, toCentimes } from '@tasheel/shared';
import { createHash, randomUUID } from 'node:crypto';
import { storage } from './demo-marketplace';

type Org = { id: string; userId: string; name: string };

const HODNA = 'Hodna Leasing SPA (fictif)';
const SAHEL_BANK = 'Banque Fictive du Sahel SPA';
const CPF = 'Crédit Populaire Fictif SPA';
const DJURDJURA = 'Djurdjura Travaux Publics SPA (fictif)';
const CLINIQUE = 'Clinique Les Palmiers SARL (fictif)';

const PRODUCTS: Array<{ bank: string; data: Record<string, unknown> }> = [
  {
    bank: HODNA,
    data: {
      name: { fr: 'Crédit-bail équipement', ar: 'الاعتماد الإيجاري للمعدات' },
      productType: 'LEASING',
      minAmount: '2000000',
      maxAmount: '150000000',
      minDurationMonths: 24,
      maxDurationMonths: 84,
      minDownPaymentPct: '10',
      minYearsInBusiness: 2,
      indicativeRateMin: '7.5',
      indicativeRateMax: '9',
      requiredDocumentTypes: ['bank_statements'],
    },
  },
  {
    bank: HODNA,
    data: {
      name: { fr: 'Leasing véhicules utilitaires', ar: 'ليزينغ المركبات النفعية' },
      productType: 'LEASING',
      minAmount: '1000000',
      maxAmount: '25000000',
      minDurationMonths: 12,
      maxDurationMonths: 60,
      minDownPaymentPct: '20',
      categoryCodes: ['vehicles'],
      indicativeRateMin: '8',
      indicativeRateMax: '10.5',
    },
  },
  {
    bank: SAHEL_BANK,
    data: {
      name: { fr: 'Ijara matériel professionnel', ar: 'إجارة المعدات المهنية' },
      productType: 'IJARA',
      minAmount: '1000000',
      maxAmount: '80000000',
      minDurationMonths: 12,
      maxDurationMonths: 72,
      minDownPaymentPct: '15',
      indicativeRateMin: '7',
      indicativeRateMax: '8.5',
    },
  },
  {
    bank: CPF,
    data: {
      name: { fr: 'Leasing PME', ar: 'ليزينغ المؤسسات الصغيرة والمتوسطة' },
      productType: 'LEASING',
      minAmount: '500000',
      maxAmount: '15000000',
      minDurationMonths: 12,
      maxDurationMonths: 60,
      minDownPaymentPct: '10',
      categoryCodes: ['agriculture', 'medical', 'industrial'],
      minYearsInBusiness: 3,
      indicativeRateMin: '8',
      indicativeRateMax: '10',
    },
  },
];

/** A one-page PDF saying it is a demonstration document. */
function placeholderPdf(title: string): Buffer {
  const text = `Document de demonstration (fictif) - ${title}`.replace(/[()\\]/g, '');
  const stream = `BT /F1 14 Tf 60 760 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

const nextRef = async (prisma: PrismaClient, prefix: 'FA' | 'OF') => {
  const seq = prefix === 'FA' ? 'financing_application_ref_seq' : 'offer_ref_seq';
  const rows = (await prisma.$queryRawUnsafe(`SELECT nextval('${seq}') AS n`)) as Array<{
    n: bigint;
  }>;
  return `${prefix}-${new Date().getFullYear()}-${String(rows[0]!.n).padStart(6, '0')}`;
};
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);
const dateOnly = (d: number) => new Date(`${inDays(d).toISOString().slice(0, 10)}T00:00:00Z`);

export async function seedDemoFinancing(
  prisma: PrismaClient,
  orgs: Map<string, Org>,
): Promise<string> {
  const banks = [HODNA, SAHEL_BANK, CPF].map((n) => orgs.get(n)!);
  if (
    (await prisma.financingProduct.count({
      where: { organizationId: { in: banks.map((b) => b.id) } },
    })) > 0
  ) {
    return 'financing demo already present (skipped)';
  }

  // Banks' products.
  const productIds = new Map<string, string>();
  for (const p of PRODUCTS) {
    const bank = orgs.get(p.bank)!;
    const id = randomUUID();
    await prisma.financingProduct.create({
      data: { id, organizationId: bank.id, createdById: bank.userId, ...p.data } as never,
    });
    productIds.set(`${p.bank}:${(p.data.name as { fr: string }).fr}`, id);
  }

  // Business papers (only when storage is reachable: a document row without its file is useless).
  const store = storage();
  const docIds = new Map<string, Record<string, string>>();
  let documentsNote = 'documents skipped (S3_ENDPOINT not set)';
  if (store) {
    try {
      for (const business of [DJURDJURA, CLINIQUE]) {
        const org = orgs.get(business)!;
        const ids: Record<string, string> = {};
        const papers: Array<[string, string, string, number | null]> = [
          ['rc_extract', 'Extrait RC', 'ACCEPTED', null],
          ['nif_certificate', 'Attestation NIF', 'ACCEPTED', null],
          ['articles_of_association', 'Statuts', 'ACCEPTED', null],
          ['legal_rep_id', 'Pièce d’identité du gérant', 'ACCEPTED', 900],
          ['tax_clearance', 'Situation fiscale', 'PENDING', 90],
          ['cnas_clearance', 'Attestation CNAS', 'PENDING', 90],
          ['financial_statements', 'Bilans 2024 et 2025', 'PENDING', null],
          ['bank_statements', 'Relevés bancaires', 'PENDING', null],
        ];
        for (const [typeCode, title, review, expiry] of papers) {
          const id = randomUUID();
          const body = placeholderPdf(`${title} - ${business}`);
          const storageKey = `org/${org.id}/documents/${id}.pdf`;
          await store.s3.send(
            new PutObjectCommand({
              Bucket: store.bucket,
              Key: storageKey,
              Body: body,
              ContentType: 'application/pdf',
            }),
          );
          await prisma.document.create({
            data: {
              id,
              organizationId: org.id,
              typeCode,
              title,
              fileName: `${typeCode}.pdf`,
              mimeType: 'application/pdf',
              sizeBytes: body.length,
              sha256: createHash('sha256').update(body).digest('hex'),
              storageKey,
              scanStatus: 'NOT_SCANNED',
              reviewStatus: review as 'ACCEPTED' | 'PENDING',
              reviewedAt: review === 'ACCEPTED' ? new Date() : null,
              expiresOn: expiry ? dateOnly(expiry) : null,
              uploadedById: org.userId,
            },
          });
          ids[typeCode] = id;
        }
        docIds.set(business, ids);
      }
      documentsNote = '16 placeholder documents';
    } catch (err) {
      documentsNote = `documents skipped (storage unreachable: ${err instanceof Error ? err.message : String(err)})`;
      docIds.clear();
    }
  }

  // Applications need accepted quotations (from the marketplace demo).
  const quotation = async (business: string) =>
    (await prisma.quotation.findFirst({
      where: { businessOrgId: orgs.get(business)!.id, status: 'ACCEPTED' },
      include: { listing: { include: { category: true } } },
    })) as unknown as {
      id: string;
      reference: string;
      total: unknown;
      organizationId: string;
      listing: {
        id: string;
        reference: string;
        title: object;
        brand: string | null;
        model: string | null;
        year: number | null;
        condition: string;
        category: { code: string };
      };
    } | null;

  let applications = 0;
  let offers = 0;
  const snapshot = (q: NonNullable<Awaited<ReturnType<typeof quotation>>>) => ({
    quotationReference: q.reference,
    listingReference: q.listing.reference,
    title: q.listing.title,
    brand: q.listing.brand,
    model: q.listing.model,
    year: q.listing.year,
    condition: q.listing.condition,
    supplierName: 'Atlas Machines Industrielles SARL (fictif)',
  });

  // 1. Djurdjura: submitted to the three banks — two offers, one decline.
  const qd = await quotation(DJURDJURA);
  if (qd) {
    const org = orgs.get(DJURDJURA)!;
    const equipment = toCentimes(String(qd.total));
    const down = (equipment * 15n) / 100n;
    const financed = fromCentimes(equipment - down);
    const appId = randomUUID();
    await prisma.financingApplication.create({
      data: {
        id: appId,
        reference: await nextRef(prisma, 'FA'),
        organizationId: org.id,
        quotationId: qd.id,
        listingId: qd.listing.id,
        supplierOrgId: qd.organizationId,
        categoryCode: qd.listing.category.code,
        equipmentAmount: fromCentimes(equipment),
        downPayment: fromCentimes(down),
        financedAmount: financed,
        durationMonths: 48,
        purpose: 'Pelle pour le chantier de la pénétrante de Tizi Ouzou (démo).',
        companyProfile: {
          yearsInBusiness: 12,
          employees: 140,
          annualRevenue: '850000000',
          sector: 'Travaux publics',
        },
        businessSnapshot: {
          legalName: DJURDJURA,
          tradeName: 'Djurdjura TP',
          nif: '000015099999999 (fictif)',
          rcNumber: '15/00-9999999B14 (fictif)',
          nis: null,
          wilayaCode: '15',
          address: null,
        },
        equipmentSnapshot: snapshot(qd),
        status: 'SUBMITTED',
        submittedAt: inDays(-2),
        createdById: org.userId,
      },
    });
    applications++;
    for (const id of Object.values(docIds.get(DJURDJURA) ?? {})) {
      await prisma.applicationDocument.create({
        data: { organizationId: org.id, applicationId: appId, documentId: id },
      });
    }
    const plan: Array<{
      bank: string;
      product: string;
      score: number;
      outcome: 'OFFER' | 'DECLINED';
      rate?: string;
      fees?: string;
      residual?: string;
    }> = [
      {
        bank: HODNA,
        product: 'Crédit-bail équipement',
        score: 100,
        outcome: 'OFFER',
        rate: '8.25',
        fees: '150000',
        residual: '0',
      },
      {
        bank: SAHEL_BANK,
        product: 'Ijara matériel professionnel',
        score: 100,
        outcome: 'OFFER',
        rate: '7.8',
        fees: '0',
        residual: fromCentimes((equipment - down) / 20n),
      },
      { bank: CPF, product: 'Leasing PME', score: 50, outcome: 'DECLINED' },
    ];
    for (const p of plan) {
      const bank = orgs.get(p.bank)!;
      const submissionId = randomUUID();
      await prisma.applicationSubmission.create({
        data: {
          id: submissionId,
          organizationId: org.id,
          applicationId: appId,
          institutionOrgId: bank.id,
          productId: productIds.get(`${p.bank}:${p.product}`) ?? null,
          matchScore: p.score,
          status: p.outcome === 'OFFER' ? 'OFFER_MADE' : 'DECLINED',
          declineReason:
            p.outcome === 'DECLINED' ? 'Montant au-delà du plafond de ce produit (démo).' : null,
        },
      });
      const event = (author: Org, kind: string, note: string | null, at: Date) =>
        prisma.submissionEvent.create({
          data: {
            organizationId: author.id,
            submissionId,
            businessOrgId: org.id,
            institutionOrgId: bank.id,
            kind,
            note,
            actorUserId: author.userId,
            createdAt: at,
          },
        });
      await event(org, 'SUBMITTED', null, inDays(-2));
      await event(bank, 'VIEWED', null, inDays(-1.8));
      if (p.outcome === 'DECLINED') {
        await event(
          bank,
          'DECLINED',
          'Montant au-delà du plafond de ce produit (démo).',
          inDays(-1.5),
        );
        continue;
      }
      if (p.bank === HODNA) {
        await event(
          bank,
          'INFO_REQUESTED',
          'Merci de préciser le calendrier de livraison (démo).',
          inDays(-1.5),
        );
        await event(
          org,
          'INFO_PROVIDED',
          'Livraison prévue sous trois semaines après accord (démo).',
          inDays(-1.2),
        );
      }
      const schedule = computeInstallment({
        financedAmount: financed,
        ratePct: p.rate!,
        durationMonths: 48,
        residualValue: p.residual,
      });
      await prisma.offer.create({
        data: {
          organizationId: bank.id,
          submissionId,
          applicationId: appId,
          businessOrgId: org.id,
          productId: productIds.get(`${p.bank}:${p.product}`) ?? null,
          reference: await nextRef(prisma, 'OF'),
          financedAmount: financed,
          downPayment: fromCentimes(down),
          durationMonths: 48,
          ratePct: p.rate!,
          residualValue: p.residual!,
          feesAmount: p.fees!,
          installmentAmount: schedule.installment,
          totalCost: computeTotalCost({
            downPayment: fromCentimes(down),
            totalInstallments: schedule.totalInstallments,
            fees: p.fees!,
            residualValue: p.residual!,
          }),
          validUntil: dateOnly(14),
          conditions:
            p.bank === HODNA
              ? 'Assurance tous risques à la charge du preneur. Sous réserve de la décision finale de l’établissement (démo).'
              : 'Ijara muntahia bittamlik : option d’achat en fin de contrat (démo).',
          issuedById: bank.userId,
        },
      });
      offers++;
      await event(bank, 'OFFER_MADE', null, inDays(-1));
    }
  }

  // 2. Clinique: a draft ready to be completed and submitted during the demo.
  const qc = await quotation(CLINIQUE);
  if (qc) {
    const org = orgs.get(CLINIQUE)!;
    const equipment = toCentimes(String(qc.total));
    const down = (equipment * 20n) / 100n;
    const appId = randomUUID();
    await prisma.financingApplication.create({
      data: {
        id: appId,
        reference: await nextRef(prisma, 'FA'),
        organizationId: org.id,
        quotationId: qc.id,
        listingId: qc.listing.id,
        supplierOrgId: qc.organizationId,
        categoryCode: qc.listing.category.code,
        equipmentAmount: fromCentimes(equipment),
        downPayment: fromCentimes(down),
        financedAmount: fromCentimes(equipment - down),
        durationMonths: 36,
        purpose: 'Équipement du service des urgences (démo).',
        companyProfile: { yearsInBusiness: 6, employees: 60, sector: 'Santé' },
        equipmentSnapshot: snapshot(qc),
        createdById: org.userId,
      },
    });
    applications++;
    for (const code of ['tax_clearance', 'financial_statements']) {
      const id = docIds.get(CLINIQUE)?.[code];
      if (id)
        await prisma.applicationDocument.create({
          data: { organizationId: org.id, applicationId: appId, documentId: id },
        });
    }
  }

  return `${PRODUCTS.length} products, ${applications} applications, ${offers} offers, ${documentsNote}`;
}
