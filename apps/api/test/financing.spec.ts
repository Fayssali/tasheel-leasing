/**
 * Financing rules against in-memory fakes. Real SQL and RLS are covered by the RLS suite and
 * test-int/financing.int-spec.ts.
 */
import type { TenantInfo } from '../src/common/request-context';
import { ApplicationsService, offerStatus } from '../src/financing/applications.service';
import { ReviewService } from '../src/financing/review.service';

const BUSINESS = '0193a1b2-0000-7000-8000-0000000000aa';
const BANK = '0193a1b2-0000-7000-8000-0000000000dd';
const BANK2 = '0193a1b2-0000-7000-8000-0000000000de';
const meta = { ipAddress: null, userAgent: null };
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);
const tenant = (organizationId: string, type: string, status = 'VERIFIED'): TenantInfo => ({
  userId: '0193a1b2-0000-7000-8000-000000000001',
  organizationId,
  organizationType: type as TenantInfo['organizationType'],
  organizationStatus: status as TenantInfo['organizationStatus'],
  permissions: new Set(),
});

/** A tiny in-memory store with the Prisma calls the services use. */
function store() {
  const db = {
    application: {
      id: 'app1',
      organizationId: BUSINESS,
      reference: 'FA-2026-000001',
      status: 'DRAFT',
      equipmentAmount: '20000000.00',
      downPayment: '2000000.00',
      financedAmount: '18000000.00',
      durationMonths: 48,
      categoryCode: 'construction',
      preferredType: null,
      companyProfile: { yearsInBusiness: 5 },
      businessSnapshot: { legalName: 'Biz' },
    } as Record<string, unknown>,
    products: [
      {
        id: 'p1',
        organizationId: BANK,
        name: { fr: 'Crédit-bail' },
        productType: 'LEASING',
        minAmount: '1000000',
        maxAmount: '50000000',
        minDurationMonths: 12,
        maxDurationMonths: 60,
        minDownPaymentPct: '10',
        categoryCodes: [],
        wilayaCodes: [],
        minYearsInBusiness: 2,
        indicativeRateMin: '7',
        indicativeRateMax: '9',
        requiredDocumentTypes: ['bank_statements'],
        isActive: true,
        deletedAt: null,
      },
      {
        id: 'p2',
        organizationId: BANK2,
        name: { fr: 'Ijara' },
        productType: 'IJARA',
        minAmount: '1000000',
        maxAmount: '10000000',
        minDurationMonths: 12,
        maxDurationMonths: 36,
        minDownPaymentPct: '20',
        categoryCodes: ['medical'],
        wilayaCodes: [],
        minYearsInBusiness: 0,
        indicativeRateMin: '6',
        indicativeRateMax: '8',
        requiredDocumentTypes: [],
        isActive: true,
        deletedAt: null,
      },
      {
        id: 'p3',
        organizationId: BANK,
        name: { fr: 'Autre' },
        productType: 'LEASING',
        minAmount: '1',
        maxAmount: '99999999',
        minDurationMonths: 1,
        maxDurationMonths: 240,
        minDownPaymentPct: '0',
        categoryCodes: [],
        wilayaCodes: [],
        minYearsInBusiness: 0,
        indicativeRateMin: '5',
        indicativeRateMax: '5',
        requiredDocumentTypes: [],
        isActive: true,
        deletedAt: null,
      },
    ],
    attached: [] as Array<{
      document: { typeCode: string; supersededById: string | null; expiresOn: Date | null };
    }>,
    submissions: [] as Array<Record<string, unknown>>,
    events: [] as Array<Record<string, unknown>>,
    offers: [] as Array<Record<string, unknown>>,
    audits: [] as string[],
  };
  const matchWhere = (row: Record<string, unknown>, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        const cond = v as { in?: unknown[]; not?: unknown; notIn?: unknown[] };
        if (cond.in) return cond.in.includes(row[k]);
        if ('not' in cond) return row[k] !== cond.not;
        return true;
      }
      return row[k] === v;
    });
  const table = (rows: Array<Record<string, unknown>>) => ({
    findMany: async ({ where }: { where?: Record<string, unknown> } = {}) =>
      rows.filter((r) => matchWhere(r, where)),
    findFirst: async ({ where }: { where?: Record<string, unknown> } = {}) =>
      rows.find((r) => matchWhere(r, where)) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) =>
      void rows.push({ ...data, status: data.status ?? (rows === db.offers ? 'ISSUED' : 'SENT') }),
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
      Object.assign(rows.find((r) => r.id === where.id) ?? {}, data),
    updateMany: async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      const hits = rows.filter((r) => matchWhere(r, where));
      hits.forEach((r) => Object.assign(r, data));
      return { count: hits.length };
    },
  });
  const tx = {
    financingApplication: {
      findFirst: async () => db.application,
      update: async ({ data }: { data: Record<string, unknown> }) =>
        Object.assign(db.application, data),
    },
    financingProduct: table(db.products as Array<Record<string, unknown>>),
    applicationSubmission: {
      ...table(db.submissions),
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const s = db.submissions.find((r) => matchWhere(r, where));
        return s ? { ...s, application: db.application } : null;
      },
    },
    applicationDocument: { findMany: async () => db.attached },
    documentType: { findMany: async () => [{ code: 'tax_clearance' }] },
    organization: {
      findUnique: async () => ({ legalName: 'Biz SARL (fictif)', wilayaCode: '16' }),
      findMany: async () => [
        { id: BANK, legalName: 'Banque A (fictif)', tradeName: null },
        { id: BANK2, legalName: 'Banque B (fictif)', tradeName: null },
      ],
    },
    submissionEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => void db.events.push(data),
    },
    offer: {
      ...table(db.offers),
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const o = db.offers.find((r) => matchWhere(r, where));
        return o ? { ...o, application: db.application } : null;
      },
    },
    $queryRawUnsafe: async () => [{ n: 3n }],
    $executeRaw: jest.fn(async () => 1),
  };
  const prisma = {
    forTenant: async (_: unknown, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  const audit = {
    record: async (_: unknown, e: { action: string }) => void db.audits.push(e.action),
  };
  const notifier = { notifyOrg: async () => undefined };
  return {
    tx,
    db,
    applications: new ApplicationsService(prisma as never, audit as never, notifier as never),
    review: new ReviewService(prisma as never, audit as never, notifier as never),
  };
}

const doc = (typeCode: string, expiresOn: Date | null = null) => ({
  document: { typeCode, supersededById: null, expiresOn },
});

describe('indicative matching', () => {
  it('ranks products by the share of published criteria met, with an indicative installment range', async () => {
    const { applications } = store();
    const res = await applications.matches(tenant(BUSINESS, 'BUSINESS'), 'app1');
    expect(res.map((m) => [m.productId, m.score])).toEqual([
      ['p1', 100],
      ['p3', 100],
      ['p2', 33], // amount, down payment, category, duration fail; wilaya and seniority pass
    ]);
    expect(res[0]).toMatchObject({
      indicative: true,
      installmentRange: { min: '431032.40', max: '447930.76' },
    });
  });
});

describe('submission', () => {
  it('requires a verified business', async () => {
    const { applications } = store();
    await expect(
      applications.submit(
        tenant(BUSINESS, 'BUSINESS', 'PENDING_VERIFICATION'),
        'app1',
        ['p1'],
        meta,
      ),
    ).rejects.toMatchObject({
      response: { code: 'ORGANIZATION_NOT_VERIFIED' },
    });
  });

  it('lists the missing documents: required by the platform and by each chosen product', async () => {
    const { applications, db } = store();
    db.attached.push(doc('tax_clearance', inDays(-1))); // expired
    await expect(
      applications.submit(tenant(BUSINESS, 'BUSINESS'), 'app1', ['p1'], meta),
    ).rejects.toMatchObject({
      response: { code: 'MISSING_DOCUMENTS', missing: ['tax_clearance', 'bank_statements'] },
    });
  });

  it('refuses two products of the same institution', async () => {
    const { applications, db } = store();
    db.attached.push(doc('tax_clearance'), doc('bank_statements'));
    await expect(
      applications.submit(tenant(BUSINESS, 'BUSINESS'), 'app1', ['p1', 'p3'], meta),
    ).rejects.toMatchObject({ response: { code: 'ONE_PER_INSTITUTION' } });
  });

  it('sends one submission per institution with a timeline entry and the business snapshot', async () => {
    const { applications, db } = store();
    db.attached.push(doc('tax_clearance'), doc('bank_statements'));
    await expect(
      applications.submit(tenant(BUSINESS, 'BUSINESS'), 'app1', ['p1', 'p2'], meta),
    ).resolves.toMatchObject({ status: 'SUBMITTED', submittedTo: 2 });
    expect(db.submissions.map((s) => [s.institutionOrgId, s.matchScore])).toEqual([
      [BANK, 100],
      [BANK2, 33],
    ]);
    expect(db.events.map((e) => e.kind)).toEqual(['SUBMITTED', 'SUBMITTED']);
    expect(db.application).toMatchObject({
      status: 'SUBMITTED',
      businessSnapshot: { legalName: 'Biz SARL (fictif)' },
    });
  });
});

describe('institution review and offers', () => {
  function submitted() {
    const s = store();
    s.db.application.status = 'SUBMITTED';
    s.db.submissions.push({
      id: 's1',
      organizationId: BUSINESS,
      applicationId: 'app1',
      institutionOrgId: BANK,
      status: 'UNDER_REVIEW',
    });
    s.db.submissions.push({
      id: 's2',
      organizationId: BUSINESS,
      applicationId: 'app1',
      institutionOrgId: BANK2,
      status: 'UNDER_REVIEW',
    });
    return s;
  }
  const offer = {
    financedAmount: '18000000',
    downPayment: '2000000',
    durationMonths: 48,
    ratePct: '8.5',
    residualValue: '0',
    feesAmount: '90000',
    validUntil: inDays(20).toISOString().slice(0, 10),
  };

  it('computes the installment and total cost from the institution’s terms and replaces its previous offer', async () => {
    const { review, db } = submitted();
    const first = await review.issueOffer(tenant(BANK, 'FINANCIAL_INSTITUTION'), 's1', offer, meta);
    // Checked with 60-digit decimals: 18 000 000 at 8.5 % over 48 months.
    expect(first).toMatchObject({
      installment: '443669.46',
      totalInstallments: '21296134.08',
      totalCost: '23386134.08',
    });
    await review.issueOffer(
      tenant(BANK, 'FINANCIAL_INSTITUTION'),
      's1',
      { ...offer, ratePct: '8' },
      meta,
    );
    expect(db.offers.map((o) => o.status)).toEqual(['WITHDRAWN', 'ISSUED']);
    expect(db.submissions[0]!.status).toBe('OFFER_MADE');
  });

  it('refuses an expired validity date and transitions that do not apply', async () => {
    const { review } = submitted();
    await expect(
      review.issueOffer(
        tenant(BANK, 'FINANCIAL_INSTITUTION'),
        's1',
        { ...offer, validUntil: '2020-01-01' },
        meta,
      ),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_VALIDITY' },
    });
    await review.requestInfo(
      tenant(BANK, 'FINANCIAL_INSTITUTION'),
      's1',
      'Merci de joindre le bilan 2025.',
      meta,
    );
    await expect(
      review.requestInfo(tenant(BANK, 'FINANCIAL_INSTITUTION'), 's1', 'Encore', meta),
    ).rejects.toMatchObject({ response: { code: 'INVALID_TRANSITION' } });
  });

  it('declining withdraws the institution’s open offer', async () => {
    const { review, db } = submitted();
    await review.issueOffer(tenant(BANK, 'FINANCIAL_INSTITUTION'), 's1', offer, meta);
    await review.decline(
      tenant(BANK, 'FINANCIAL_INSTITUTION'),
      's1',
      'Hors politique de risque',
      meta,
    );
    expect(db.offers[0]!.status).toBe('WITHDRAWN');
    expect(db.submissions[0]).toMatchObject({
      status: 'DECLINED',
      declineReason: 'Hors politique de risque',
    });
  });

  it('accepting one offer declines the others and closes the remaining submissions', async () => {
    const { review, applications, db, tx } = submitted();
    const a = await review.issueOffer(tenant(BANK, 'FINANCIAL_INSTITUTION'), 's1', offer, meta);
    await review.issueOffer(
      tenant(BANK2, 'FINANCIAL_INSTITUTION'),
      's2',
      { ...offer, ratePct: '9' },
      meta,
    );
    await applications.decideOffer(tenant(BUSINESS, 'BUSINESS'), a.id, 'accept', meta);
    expect(db.offers.map((o) => o.status)).toEqual(['ACCEPTED', 'DECLINED']);
    expect(db.submissions.map((s) => s.status)).toEqual(['OFFER_MADE', 'CLOSED']);
    expect(db.application.status).toBe('OFFER_ACCEPTED');
    // The institution commission is accrued in the same transaction.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('presents and treats past-validity offers as expired', async () => {
    expect(offerStatus({ status: 'ISSUED', validUntil: new Date('2020-01-01') })).toBe('EXPIRED');
    const { applications, db } = submitted();
    db.offers.push({
      id: 'old',
      organizationId: BANK,
      submissionId: 's1',
      applicationId: 'app1',
      businessOrgId: BUSINESS,
      reference: 'OF-1',
      status: 'ISSUED',
      validUntil: new Date('2020-01-01'),
    });
    await expect(
      applications.decideOffer(tenant(BUSINESS, 'BUSINESS'), 'old', 'accept', meta),
    ).rejects.toMatchObject({ response: { code: 'OFFER_NOT_OPEN' } });
  });
});
