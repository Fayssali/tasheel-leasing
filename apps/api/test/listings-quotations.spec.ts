/**
 * Listing lifecycle and quotation rules against in-memory fakes. Real SQL/RLS is covered by
 * the RLS suite and test-int/marketplace.int-spec.ts.
 */
import type { TenantInfo } from '../src/common/request-context';
import { ListingsService } from '../src/marketplace/listings.service';
import { QuotationsService, effectiveStatus } from '../src/quotations/quotations.service';

const SUPPLIER = '0193a1b2-0000-7000-8000-0000000000bb';
const BUSINESS = '0193a1b2-0000-7000-8000-0000000000aa';
const meta = { ipAddress: null, userAgent: null };
const tenant = (organizationId: string, status = 'VERIFIED', type = 'SUPPLIER'): TenantInfo => ({
  userId: '0193a1b2-0000-7000-8000-000000000001',
  organizationId,
  organizationType: type as TenantInfo['organizationType'],
  organizationStatus: status as TenantInfo['organizationStatus'],
  permissions: new Set(),
});

function listingsSetup(
  opts: { moderation?: boolean; images?: number; status?: string; price?: string | null } = {},
) {
  const listing = {
    id: 'l1',
    organizationId: SUPPLIER,
    reference: 'EQ-2026-000001',
    status: opts.status ?? 'DRAFT',
    title: { fr: 'Pelle' },
    price: opts.price === undefined ? '1000.00' : opts.price,
    priceOnRequest: false,
    deletedAt: null,
    images: Array.from({ length: opts.images ?? 1 }, (_, i) => ({ id: `i${i}` })),
    statusReason: null as string | null,
    publishedAt: undefined as Date | undefined,
  };
  const tx = {
    equipmentListing: {
      findFirst: async () => ({ ...listing }),
      findUnique: async () => ({ ...listing }),
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(listing, data),
      updateMany: async ({
        where,
        data,
      }: {
        where: { status: { in: string[] } };
        data: Record<string, unknown>;
      }) => {
        if (!where.status.in.includes(listing.status)) return { count: 0 };
        Object.assign(listing, data);
        return { count: 1 };
      },
    },
    equipmentCategory: { findUnique: async () => ({ id: 'c1', isActive: true, specSchema: [] }) },
  };
  const prisma = {
    forTenant: async (_: unknown, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  const settings = { moderationEnabled: async () => opts.moderation ?? false };
  const service = new ListingsService(
    prisma as never,
    { record: async () => undefined } as never,
    {} as never,
    settings as never,
  );
  return { service, listing };
}

describe('listing lifecycle', () => {
  it('publishes directly when moderation is off', async () => {
    const { service, listing } = listingsSetup();
    await expect(service.submit(tenant(SUPPLIER), 'l1', meta)).resolves.toEqual({
      id: 'l1',
      status: 'PUBLISHED',
    });
    expect(listing.publishedAt).toBeInstanceOf(Date);
  });

  it('goes to review when moderation is on', async () => {
    const { service } = listingsSetup({ moderation: true });
    await expect(service.submit(tenant(SUPPLIER), 'l1', meta)).resolves.toMatchObject({
      status: 'PENDING_REVIEW',
    });
  });

  it('refuses to publish for an unverified supplier', async () => {
    const { service } = listingsSetup();
    await expect(
      service.submit(tenant(SUPPLIER, 'PENDING_VERIFICATION'), 'l1', meta),
    ).rejects.toMatchObject({
      response: { code: 'ORGANIZATION_NOT_VERIFIED' },
    });
  });

  it('requires at least one image and a price (or price on request)', async () => {
    const noImage = listingsSetup({ images: 0 });
    await expect(noImage.service.submit(tenant(SUPPLIER), 'l1', meta)).rejects.toMatchObject({
      response: { code: 'LISTING_INCOMPLETE', missing: ['image'] },
    });
    const noPrice = listingsSetup({ price: null });
    await expect(noPrice.service.submit(tenant(SUPPLIER), 'l1', meta)).rejects.toMatchObject({
      response: { missing: ['price'] },
    });
  });

  it('lets Tasheel approve or reject a listing under review, with a reason for rejection', async () => {
    const platform = tenant('0193a1b2-0000-7000-8000-0000000000ff', 'VERIFIED', 'PLATFORM');
    const a = listingsSetup({ status: 'PENDING_REVIEW' });
    await expect(
      a.service.moderate(platform, 'l1', 'reject', undefined, meta),
    ).rejects.toMatchObject({ response: { code: 'REASON_REQUIRED' } });
    await a.service.moderate(platform, 'l1', 'reject', 'Photos floues', meta);
    expect(a.listing).toMatchObject({ status: 'REJECTED', statusReason: 'Photos floues' });

    const b = listingsSetup({ status: 'DRAFT' });
    await expect(
      b.service.moderate(platform, 'l1', 'approve', undefined, meta),
    ).rejects.toMatchObject({ response: { code: 'INVALID_TRANSITION' } });
  });
});

function quotationsSetup(
  opts: { requestStatus?: string; quotationValidUntil?: Date; quotationStatus?: string } = {},
) {
  const request = {
    id: 'r1',
    organizationId: BUSINESS,
    listingId: 'l1',
    status: opts.requestStatus ?? 'OPEN',
    requestedById: 'u-b',
    listing: { title: { fr: 'Pelle' } },
  };
  const quotations: Array<Record<string, unknown>> = [
    {
      id: 'q0',
      organizationId: SUPPLIER,
      businessOrgId: BUSINESS,
      requestId: 'r1',
      reference: 'QT-2026-000001',
      status: opts.quotationStatus ?? 'ISSUED',
      validUntil: opts.quotationValidUntil ?? new Date(Date.now() + 7 * 86_400_000),
      issuedById: 'u-s',
      request: {
        status: request.status,
        requestedById: 'u-b',
        businessName: 'Biz',
        reference: 'QR-2026-000001',
      },
      listing: { title: { fr: 'Pelle' } },
    },
  ];
  const tx = {
    quotationRequest: {
      findFirst: async () => ({ ...request }),
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(request, data),
    },
    quotation: {
      findFirst: async () => quotations[0],
      create: async ({ data }: { data: Record<string, unknown> }) => void quotations.push(data),
      updateMany: async ({
        where,
        data,
      }: {
        where: { status: string; id?: string };
        data: Record<string, unknown>;
      }) => {
        const hits = quotations.filter(
          (q) => q.status === where.status && (!where.id || q.id === where.id),
        );
        hits.forEach((q) => Object.assign(q, data));
        return { count: hits.length };
      },
    },
    organization: { findUnique: async () => ({ legalName: 'Atlas Machines (fictif)' }) },
    $queryRawUnsafe: async () => [{ n: 7n }],
    $executeRaw: jest.fn(async () => 1),
  };
  const prisma = {
    forTenant: async (_: unknown, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    user: { findUnique: async () => ({ email: 'x@y.dz', firstName: 'Yacine', locale: 'fr' }) },
  };
  const service = new QuotationsService(
    prisma as never,
    { record: async () => undefined } as never,
    { notifyOrg: async () => undefined, notifyUser: async () => undefined } as never,
  );
  return { service, request, quotations, tx };
}

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

describe('quotations', () => {
  it('issues a quotation with exact totals, withdraws the previous one and marks the request quoted', async () => {
    const { service, request, quotations } = quotationsSetup({ requestStatus: 'QUOTED' });
    const res = await service.issue(
      tenant(SUPPLIER),
      'r1',
      {
        lines: [{ label: 'Pelle', quantity: 1, unitPrice: '15000000.00' }],
        vatRate: '19',
        validUntil: inDays(15),
      },
      meta,
    );
    expect(res).toMatchObject({
      reference: 'QT-' + new Date().getFullYear() + '-000007',
      subtotal: '15000000.00',
      vatAmount: '2850000.00',
      total: '17850000.00',
    });
    expect(quotations[0]!.status).toBe('WITHDRAWN');
    expect(quotations[1]).toMatchObject({ total: '17850000.00', businessOrgId: BUSINESS });
    expect(request.status).toBe('QUOTED');
  });

  it('refuses a validity date in the past and a closed request', async () => {
    const a = quotationsSetup();
    await expect(
      a.service.issue(
        tenant(SUPPLIER),
        'r1',
        {
          lines: [{ label: 'x', quantity: 1, unitPrice: '1' }],
          vatRate: '19',
          validUntil: inDays(-1),
        },
        meta,
      ),
    ).rejects.toMatchObject({ response: { code: 'INVALID_VALIDITY' } });
    const b = quotationsSetup({ requestStatus: 'CANCELLED' });
    await expect(
      b.service.issue(
        tenant(SUPPLIER),
        'r1',
        {
          lines: [{ label: 'x', quantity: 1, unitPrice: '1' }],
          vatRate: '19',
          validUntil: inDays(3),
        },
        meta,
      ),
    ).rejects.toMatchObject({ response: { code: 'REQUEST_CLOSED' } });
  });

  it('accepting closes the request; an expired quotation cannot be accepted', async () => {
    const ok = quotationsSetup({ requestStatus: 'QUOTED' });
    const accrual = ok.tx.$executeRaw;
    await expect(
      ok.service.decide(tenant(BUSINESS, 'VERIFIED', 'BUSINESS'), 'q0', 'accept', meta),
    ).resolves.toMatchObject({ status: 'ACCEPTED' });
    expect(ok.request.status).toBe('CLOSED');
    // The supplier commission is accrued in the same transaction as the acceptance.
    expect(accrual).toHaveBeenCalledTimes(1);
    expect(((accrual.mock.calls[0] as unknown[])[0] as { sql: string }).sql).toContain(
      'app_accrue_commission',
    );

    const expired = quotationsSetup({
      requestStatus: 'QUOTED',
      quotationValidUntil: new Date(Date.now() - 3 * 86_400_000),
    });
    await expect(
      expired.service.decide(tenant(BUSINESS, 'VERIFIED', 'BUSINESS'), 'q0', 'accept', meta),
    ).rejects.toMatchObject({
      response: { code: 'QUOTATION_NOT_OPEN' },
    });
  });

  it('requires a verified business to request quotations', async () => {
    const { service } = quotationsSetup();
    await expect(
      service.request(
        tenant(BUSINESS, 'PENDING_VERIFICATION', 'BUSINESS'),
        { listingId: 'l1', quantity: 1 },
        meta,
      ),
    ).rejects.toMatchObject({
      response: { code: 'ORGANIZATION_NOT_VERIFIED' },
    });
  });

  it('presents past-validity quotations as expired', () => {
    expect(effectiveStatus({ status: 'ISSUED', validUntil: new Date('2020-01-01') })).toBe(
      'EXPIRED',
    );
    expect(effectiveStatus({ status: 'ACCEPTED', validUntil: new Date('2020-01-01') })).toBe(
      'ACCEPTED',
    );
  });
});
