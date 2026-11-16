/**
 * Billing rules against an in-memory store. RLS, the accrual function and the counter are
 * covered by the SQL suite and test-int/billing.int-spec.ts.
 */
import type { TenantInfo } from '../src/common/request-context';
import { BillingSettingsService } from '../src/billing/billing-settings.service';
import { BillingService } from '../src/billing/billing.service';

const SUPPLIER = '0193a1b2-0000-7000-8000-0000000000bb';
const BANK = '0193a1b2-0000-7000-8000-0000000000dd';
const meta = { ipAddress: null, userAgent: null };
const platform: TenantInfo = {
  userId: '0193a1b2-0000-7000-8000-000000000001',
  organizationId: '0193a1b2-0000-7000-8000-0000000000ff',
  organizationType: 'PLATFORM',
  organizationStatus: 'VERIFIED',
  permissions: new Set(['admin.billing.manage']),
};
const SETTINGS = {
  issuer: {
    legalName: 'Tasheel SPA (fictif)',
    address: '1 rue Exemple, Alger',
    wilayaCode: '16',
    rcNumber: '16/00-0000000B26',
    nif: '000016000000000',
    nis: '000016000000000',
    articleImposition: '16000000000',
  },
  vatRate: '19',
  paymentTermsDays: 30,
  invoicePrefix: 'TSL',
  creditNotePrefix: 'AV',
};
const yesterday = new Date(Date.now() - 86_400_000);
const todayIso = new Date().toISOString().slice(0, 10);

function store(withSettings = true) {
  const db = {
    settings: withSettings ? { value: SETTINGS } : null,
    counter: 0,
    commissions: [
      {
        id: 'c1',
        organizationId: SUPPLIER,
        sourceReference: 'QT-2026-000001',
        trigger: 'QUOTATION_ACCEPTED',
        amount: '20000.00',
        accruedAt: yesterday,
        status: 'ACCRUED',
        invoiceId: null as string | null,
      },
      {
        id: 'c2',
        organizationId: SUPPLIER,
        sourceReference: 'QT-2026-000002',
        trigger: 'QUOTATION_ACCEPTED',
        amount: '15125.55',
        accruedAt: yesterday,
        status: 'ACCRUED',
        invoiceId: null as string | null,
      },
      {
        id: 'c3',
        organizationId: BANK,
        sourceReference: 'OF-2026-000001',
        trigger: 'OFFER_ACCEPTED',
        amount: '50000.00',
        accruedAt: yesterday,
        status: 'ACCRUED',
        invoiceId: null as string | null,
      },
    ],
    invoices: [] as Array<Record<string, unknown>>,
    lines: [] as Array<Record<string, unknown>>,
    audits: [] as string[],
  };
  const match = (row: Record<string, unknown>, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        const c = v as { in?: unknown[]; lt?: Date; not?: unknown };
        if (c.in) return c.in.includes(row[k]);
        if (c.lt) return (row[k] as Date) < c.lt;
        if ('not' in c) return row[k] !== c.not;
      }
      return row[k] === v;
    });
  const withLines = (inv: Record<string, unknown> | undefined) =>
    inv ? { ...inv, lines: db.lines.filter((l) => l.invoiceId === inv.id) } : null;
  const tx = {
    platformSetting: { findUnique: async () => db.settings, upsert: async () => undefined },
    commission: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        db.commissions.filter((c) => match(c, where)),
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const hits = db.commissions.filter((c) => match(c, where));
        hits.forEach((c) => Object.assign(c, data));
        return { count: hits.length };
      },
    },
    invoice: {
      create: async ({ data }: { data: Record<string, unknown> }) =>
        void db.invoices.push({ status: 'DRAFT', kind: 'INVOICE', number: null, ...data }),
      findUnique: async ({ where }: { where: { id: string } }) =>
        withLines(db.invoices.find((i) => i.id === where.id)),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
        Object.assign(
          db.invoices.find((i) => i.id === where.id)!,
          data,
        ),
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const hits = db.invoices.filter((i) => match(i, where));
        hits.forEach((i) => Object.assign(i, data));
        return { count: hits.length };
      },
    },
    invoiceLine: {
      create: async ({ data }: { data: Record<string, unknown> }) => void db.lines.push(data),
    },
    organization: {
      findUnique: async () => ({
        legalName: 'Atlas Machines (fictif)',
        nif: '000009',
        type: 'SUPPLIER',
      }),
      findMany: async () => [],
    },
    commissionRule: {
      findUnique: async () => null,
      create: async () => undefined,
      update: async () => undefined,
    },
    $queryRaw: async () => [{ last: ++db.counter }],
  };
  const prisma = {
    forTenant: async (_: unknown, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  const service = new BillingService(
    prisma as never,
    { record: async (_: unknown, e: { action: string }) => void db.audits.push(e.action) } as never,
    new BillingSettingsService(),
    { notifyOrg: async () => undefined } as never,
  );
  return { service, db };
}

describe('invoicing', () => {
  it('refuses to invoice before the billing settings are configured', async () => {
    const { service } = store(false);
    await expect(service.generateDrafts(platform, todayIso, meta)).rejects.toMatchObject({
      response: { code: 'BILLING_NOT_CONFIGURED' },
    });
  });

  it('drafts one invoice per payer, with exact totals and commissions reserved', async () => {
    const { service, db } = store();
    await expect(service.generateDrafts(platform, todayIso, meta)).resolves.toEqual({ drafts: 2 });
    const supplierInvoice = db.invoices.find((i) => i.organizationId === SUPPLIER)!;
    expect(supplierInvoice).toMatchObject({
      status: 'DRAFT',
      number: null,
      subtotal: '35125.55',
      vatAmount: '6673.85',
      total: '41799.40',
      vatRate: '19',
    });
    expect(db.lines.filter((l) => l.invoiceId === supplierInvoice.id)).toHaveLength(2);
    expect(db.commissions.every((c) => c.invoiceId !== null && c.status === 'ACCRUED')).toBe(true);
    // Nothing left to draft a second time.
    await expect(service.generateDrafts(platform, todayIso, meta)).resolves.toEqual({ drafts: 0 });
  });

  it('issues with a sequential number and identity snapshots; commissions become invoiced', async () => {
    const { service, db } = store();
    await service.generateDrafts(platform, todayIso, meta);
    const [first, second] = db.invoices;
    const year = new Date().getUTCFullYear();
    await expect(service.issue(platform, first!.id as string, meta)).resolves.toMatchObject({
      number: `TSL-${year}-000001`,
    });
    await expect(service.issue(platform, second!.id as string, meta)).resolves.toMatchObject({
      number: `TSL-${year}-000002`,
    });
    expect(first).toMatchObject({
      status: 'ISSUED',
      issuer: SETTINGS.issuer,
      customer: { legalName: 'Atlas Machines (fictif)' },
    });
    expect(db.commissions.every((c) => c.status === 'INVOICED')).toBe(true);
    await expect(service.issue(platform, first!.id as string, meta)).rejects.toMatchObject({
      response: { code: 'INVOICE_NOT_DRAFT' },
    });
  });

  it('cancels an issued invoice only through a credit note that mirrors it, releasing the commissions', async () => {
    const { service, db } = store();
    await service.generateDrafts(platform, todayIso, meta);
    const inv = db.invoices.find((i) => i.organizationId === SUPPLIER)!;
    await service.issue(platform, inv.id as string, meta);
    const credit = await service.creditNote(
      platform,
      inv.id as string,
      { reason: 'Devis annulé par le client', releaseCommissions: true },
      meta,
    );
    expect(credit).toMatchObject({
      subtotal: '-35125.55',
      vatAmount: '-6673.85',
      total: '-41799.40',
    });
    expect(credit.number).toMatch(/^AV-\d{4}-000002$/);
    expect(inv.status).toBe('CANCELLED');
    expect(
      db.commissions
        .filter((c) => c.organizationId === SUPPLIER)
        .every((c) => c.status === 'ACCRUED' && c.invoiceId === null),
    ).toBe(true);
    await expect(
      service.creditNote(
        platform,
        inv.id as string,
        { reason: 'encore', releaseCommissions: true },
        meta,
      ),
    ).rejects.toMatchObject({
      response: { code: 'INVOICE_NOT_CREDITABLE' },
    });
  });

  it('marks only issued invoices as paid, never in the future', async () => {
    const { service, db } = store();
    await service.generateDrafts(platform, todayIso, meta);
    const inv = db.invoices[0]!;
    await expect(
      service.markPaid(platform, inv.id as string, todayIso, 'VIR-001', meta),
    ).rejects.toMatchObject({ response: { code: 'INVOICE_NOT_ISSUED' } });
    await service.issue(platform, inv.id as string, meta);
    await expect(
      service.markPaid(platform, inv.id as string, '2999-01-01', 'VIR-001', meta),
    ).rejects.toMatchObject({ response: { code: 'INVALID_DATE' } });
    await expect(
      service.markPaid(platform, inv.id as string, todayIso, 'VIR-001', meta),
    ).resolves.toMatchObject({ status: 'PAID' });
  });

  it('discarding a draft frees its commissions for the next run', async () => {
    const { service, db } = store();
    await service.generateDrafts(platform, todayIso, meta);
    await service.discardDraft(platform, db.invoices[0]!.id as string, meta);
    expect(db.invoices[0]!.status).toBe('CANCELLED');
    await expect(service.generateDrafts(platform, todayIso, meta)).resolves.toEqual({ drafts: 1 });
  });
});

describe('commission rules', () => {
  const rule = {
    name: { fr: 'Fournisseurs' },
    trigger: 'QUOTATION_ACCEPTED' as const,
    basis: 'PERCENT' as const,
    ratePct: '2',
    categoryCodes: [],
    validFrom: '2026-01-01',
    isActive: true,
  };
  it('validates rates, amounts, ranges and the payer kind', async () => {
    const { service } = store();
    await expect(
      service.saveRule(platform, null, { ...rule, ratePct: undefined }, meta),
    ).rejects.toMatchObject({ response: { code: 'RATE_REQUIRED' } });
    await expect(
      service.saveRule(platform, null, { ...rule, basis: 'FIXED', ratePct: undefined }, meta),
    ).rejects.toMatchObject({ response: { code: 'AMOUNT_REQUIRED' } });
    await expect(
      service.saveRule(platform, null, { ...rule, minAmount: '100', maxAmount: '10' }, meta),
    ).rejects.toMatchObject({ response: { code: 'INVALID_RANGE' } });
    await expect(
      service.saveRule(
        platform,
        null,
        { ...rule, trigger: 'OFFER_ACCEPTED', payerOrgId: SUPPLIER },
        meta,
      ),
    ).rejects.toMatchObject({ response: { code: 'INVALID_PAYER' } });
    await expect(service.saveRule(platform, null, rule, meta)).resolves.toHaveProperty('id');
  });
});
