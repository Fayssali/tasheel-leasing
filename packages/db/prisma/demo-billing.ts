/**
 * Phase 4 demo data: billing settings for a fictional issuer, two commission rules, and the
 * commissions they produce on the deals already accepted in the marketplace demo.
 *
 * Invoices are deliberately not seeded: the demo script has the Tasheel administrator
 * prepare, issue and collect them, so numbering and the snapshots go through the real API.
 * Every amount and rate here is fictional demo configuration, entered as an administrator
 * would through the billing settings screen; none of it is a default of the platform.
 */
import { Prisma, type PrismaClient } from '@prisma/client';

type Org = { id: string; userId: string; name: string };

const PLATFORM = 'Tasheel Leasing (démo)';

const SETTINGS = {
  issuer: {
    legalName: 'Tasheel Leasing SPA (fictif)',
    address: '12 rue des Frères Fictifs, Hydra, Alger',
    wilayaCode: '16',
    rcNumber: '16/00-0000000B26',
    nif: '000016000000000',
    nis: '000016000000001',
    articleImposition: '16000000000',
    bankName: 'Banque Fictive du Sahel SPA',
    rib: '000 00000 0000000000 00',
    email: 'facturation@demo.tasheel.local',
    phone: '+213 21 00 00 00',
  },
  vatRate: '19.00',
  paymentTermsDays: 30,
  invoicePrefix: 'DEMO',
  creditNotePrefix: 'DEMO-AV',
};

const RULES = [
  {
    name: {
      fr: 'Commission fournisseur (démo)',
      ar: 'عمولة المورّد (تجريبي)',
      en: 'Supplier commission (demo)',
    },
    trigger: 'QUOTATION_ACCEPTED' as const,
    basis: 'PERCENT' as const,
    ratePct: '2.0000',
    minAmount: '5000.00',
    maxAmount: '500000.00',
  },
  {
    name: {
      fr: 'Forfait établissement financier (démo)',
      ar: 'مبلغ جزافي للمؤسسة المالية (تجريبي)',
      en: 'Financial institution flat fee (demo)',
    },
    trigger: 'OFFER_ACCEPTED' as const,
    basis: 'FIXED' as const,
    fixedAmount: '150000.00',
  },
];

export async function seedDemoBilling(
  prisma: PrismaClient,
  orgs: Map<string, Org>,
): Promise<string> {
  const platform = orgs.get(PLATFORM)!;

  await prisma.platformSetting.upsert({
    where: { key: 'billing.settings' },
    update: {},
    create: { key: 'billing.settings', value: SETTINGS, updatedById: platform.userId },
  });

  // Valid from the start of the year, so the deals accepted in the marketplace demo qualify.
  const validFrom = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
  let created = 0;
  for (const r of RULES) {
    const exists = await prisma.commissionRule.findFirst({
      where: { name: { path: ['fr'], equals: r.name.fr } },
    });
    if (exists) continue;
    await prisma.commissionRule.create({
      data: { ...r, validFrom, createdById: platform.userId },
    });
    created += 1;
  }

  // The same function the administrator's "compute missing commissions" button calls, run in
  // the platform context it requires.
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${platform.id}, true)`;
    await tx.$executeRaw`SELECT set_config('app.user_id', ${platform.userId}, true)`;
    return tx.$queryRaw<Array<{ n: number }>>(
      Prisma.sql`SELECT app_accrue_missing_commissions() AS n`,
    );
  });

  const accrued = Number(rows[0]?.n ?? 0);
  return `billing settings, ${created} commission rule(s), ${accrued} commission(s) accrued`;
}
