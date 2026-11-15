/**
 * Cross-tenant isolation suite (Phase 0 specification, section 9).
 * Runs against a real PostgreSQL with migrations applied.
 *
 * Setup uses the ADMIN connection (owner, not subject to RLS) to create two tenants.
 * Assertions use the APP connection (tasheel_app, NOBYPASSRLS) through withTenantContext,
 * exactly as the API does. Every new tenant-owned table must add a case here.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { withTenantContext } from '../src/tenant-context';

const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_ADMIN });
const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

const run = randomUUID().slice(0, 8);
let orgA: string, orgB: string, platform: string;
let userA: string, userB: string, userP: string;

before(async () => {
  const mk = async (type: 'BUSINESS' | 'SUPPLIER' | 'PLATFORM', label: string) => {
    const org = await admin.organization.create({ data: { type, legalName: `${label} ${run}` } });
    const user = await admin.user.create({
      data: {
        email: `${label.toLowerCase()}-${run}@test.local`,
        passwordHash: 'x',
        firstName: label,
        lastName: 'Test',
      },
    });
    await admin.organizationMember.create({ data: { organizationId: org.id, userId: user.id } });
    await admin.auditLog.create({
      data: {
        organizationId: org.id,
        action: 'test.created',
        entityType: 'Organization',
        entityId: org.id,
      },
    });
    return { org: org.id, user: user.id };
  };
  ({ org: orgA, user: userA } = await mk('BUSINESS', 'TenantA'));
  ({ org: orgB, user: userB } = await mk('SUPPLIER', 'TenantB'));
  ({ org: platform, user: userP } = await mk('PLATFORM', 'Platform'));
});

after(async () => {
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

describe('row-level security', () => {
  test('a tenant sees only its own organization', async () => {
    const ids = await withTenantContext(app, { organizationId: orgA, userId: userA }, (tx) =>
      tx.organization.findMany({ where: { id: { in: [orgA, orgB] } }, select: { id: true } }),
    );
    assert.deepEqual(
      ids.map((o) => o.id),
      [orgA],
    );
  });

  test('a tenant cannot read another tenant’s members or audit log', async () => {
    const [members, logs] = await withTenantContext(
      app,
      { organizationId: orgA, userId: userA },
      (tx) =>
        Promise.all([
          tx.organizationMember.findMany({ where: { organizationId: orgB } }),
          tx.auditLog.findMany({ where: { organizationId: orgB } }),
        ]),
    );
    assert.equal(members.length, 0);
    assert.equal(logs.length, 0);
  });

  test('a tenant cannot update another tenant’s organization', async () => {
    const result = await withTenantContext(app, { organizationId: orgA, userId: userA }, (tx) =>
      tx.organization.updateMany({ where: { id: orgB }, data: { legalName: 'hijacked' } }),
    );
    assert.equal(result.count, 0);
  });

  test('a tenant cannot insert rows into another tenant', async () => {
    await assert.rejects(
      withTenantContext(app, { organizationId: orgA, userId: userA }, (tx) =>
        tx.organizationMember.create({ data: { organizationId: orgB, userId: userA } }),
      ),
      /row-level security/i,
    );
  });

  test('without any context, nothing tenant-owned is visible', async () => {
    const count = await withTenantContext(app, { organizationId: null, userId: null }, (tx) =>
      tx.organization.count({ where: { id: { in: [orgA, orgB] } } }),
    );
    assert.equal(count, 0);
  });

  test('a user sees the organizations they belong to, for the organization switcher', async () => {
    const ids = await withTenantContext(app, { organizationId: null, userId: userB }, (tx) =>
      tx.organization.findMany({ where: { id: { in: [orgA, orgB] } }, select: { id: true } }),
    );
    assert.deepEqual(
      ids.map((o) => o.id),
      [orgB],
    );
  });

  test('the platform organization can read all organizations (admin console)', async () => {
    const count = await withTenantContext(app, { organizationId: platform, userId: userP }, (tx) =>
      tx.organization.count({ where: { id: { in: [orgA, orgB] } } }),
    );
    assert.equal(count, 2);
  });

  test('the audit log is append-only for the app role', async () => {
    await assert.rejects(
      withTenantContext(app, { organizationId: orgA, userId: userA }, (tx) =>
        tx.auditLog.deleteMany({ where: { organizationId: orgA } }),
      ),
      /permission denied/i,
    );
  });

  test('a user cannot read another user’s email tokens', async () => {
    await admin.userToken.create({
      data: {
        userId: userB,
        purpose: 'PASSWORD_RESET',
        tokenHash: `iso-${run}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const found = await withTenantContext(app, { organizationId: null, userId: userA }, (tx) =>
      tx.userToken.findUnique({ where: { tokenHash: `iso-${run}` } }),
    );
    assert.equal(found, null);
  });

  test('context does not leak between transactions on a pooled connection', async () => {
    await withTenantContext(app, { organizationId: orgA, userId: userA }, async () => undefined);
    const rows = await app.$queryRaw<
      Array<{ org: string | null }>
    >`SELECT current_setting('app.org_id', true) AS org`;
    assert.ok(!rows[0]?.org, 'app.org_id must be empty outside withTenantContext');
  });
});

describe('marketplace row-level security', () => {
  let orgC: string, userC: string;
  let draftId: string, publishedId: string, requestId: string;

  before(async () => {
    const c = await admin.organization.create({
      data: { type: 'SUPPLIER', legalName: `TenantC ${run}` },
    });
    const u = await admin.user.create({
      data: {
        email: `tenantc-${run}@test.local`,
        passwordHash: 'x',
        firstName: 'C',
        lastName: 'Test',
      },
    });
    await admin.organizationMember.create({ data: { organizationId: c.id, userId: u.id } });
    orgC = c.id;
    userC = u.id;
    // Created here: in CI this suite runs before the seed.
    const category = await admin.equipmentCategory.create({
      data: { code: `iso-${run}`, name: { fr: 'Isolation' }, specSchema: [] },
    });
    const mkListing = async (status: 'DRAFT' | 'PUBLISHED', ref: string) =>
      (
        await admin.equipmentListing.create({
          data: {
            organizationId: orgB,
            reference: `ISO-${ref}-${run}`,
            categoryId: category.id,
            title: { fr: `Iso ${ref}` },
            status,
            createdById: userB,
          },
        })
      ).id;
    draftId = await mkListing('DRAFT', 'D');
    publishedId = await mkListing('PUBLISHED', 'P');
    requestId = (
      await admin.quotationRequest.create({
        data: {
          organizationId: orgA,
          supplierOrgId: orgB,
          reference: `ISO-QR-${run}`,
          listingId: publishedId,
          requestedById: userA,
        },
      })
    ).id;
    await admin.favourite.create({
      data: { organizationId: orgA, userId: userA, listingId: publishedId },
    });
  });

  test('the public sees published listings, never drafts', async () => {
    const ids = await withTenantContext(app, { organizationId: null, userId: null }, (tx) =>
      tx.equipmentListing.findMany({
        where: { id: { in: [draftId, publishedId] } },
        select: { id: true },
      }),
    );
    assert.deepEqual(
      ids.map((l) => l.id),
      [publishedId],
    );
  });

  test('another supplier cannot read or change a supplier’s listings', async () => {
    const [seen, changed] = await withTenantContext(
      app,
      { organizationId: orgC, userId: userC },
      (tx) =>
        Promise.all([
          tx.equipmentListing.count({ where: { id: draftId } }),
          tx.equipmentListing.updateMany({
            where: { id: publishedId },
            data: { title: { fr: 'hijacked' } },
          }),
        ]),
    );
    assert.equal(seen, 0);
    assert.equal(changed.count, 0);
  });

  test('quotation requests are visible to their two parties only', async () => {
    const count = (organizationId: string, userId: string) =>
      withTenantContext(app, { organizationId, userId }, (tx) =>
        tx.quotationRequest.count({ where: { id: requestId } }),
      );
    assert.equal(await count(orgA, userA), 1);
    assert.equal(await count(orgB, userB), 1);
    assert.equal(await count(orgC, userC), 0);
  });

  test('favourites are private to their user', async () => {
    const count = await withTenantContext(app, { organizationId: orgB, userId: userB }, (tx) =>
      tx.favourite.count({ where: { listingId: publishedId } }),
    );
    assert.equal(count, 0);
  });

  test('commercial records cannot be deleted by the app role', async () => {
    await assert.rejects(
      withTenantContext(app, { organizationId: orgA, userId: userA }, (tx) =>
        tx.quotationRequest.deleteMany({ where: { id: requestId } }),
      ),
      /permission denied/i,
    );
  });
});
