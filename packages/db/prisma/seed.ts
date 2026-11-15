/**
 * Seeds the permission catalogue, system roles and a minimal set of FICTIONAL demo
 * organizations. Runs with the admin role (DATABASE_URL_ADMIN), which owns the tables
 * and is therefore not subject to RLS. Safe to run repeatedly (upserts).
 *
 * Full demonstration data (3 suppliers, 2 institutions, 5 businesses, 20 listings,
 * applications in every status) is added in Phases 2–3 when those tables exist.
 */
import { hash } from '@node-rs/argon2';
import { PrismaClient, type OrganizationType } from '@prisma/client';
import { PERMISSIONS, SYSTEM_ROLES } from '@tasheel/shared';

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_ADMIN });

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo-Tasheel-2026!';

const DEMO_ORGS: Array<{
  type: OrganizationType;
  legalName: string;
  wilayaCode: string;
  adminRole: string;
  user: { email: string; firstName: string; lastName: string };
}> = [
  {
    type: 'PLATFORM',
    legalName: 'Tasheel Leasing (démo)',
    wilayaCode: '16',
    adminRole: 'platform_super_admin',
    user: { email: 'admin@demo.tasheel.local', firstName: 'Admin', lastName: 'Tasheel' },
  },
  {
    type: 'SUPPLIER',
    legalName: 'Atlas Machines Industrielles SARL (fictif)',
    wilayaCode: '09',
    adminRole: 'supplier_admin',
    user: { email: 'fournisseur@demo.tasheel.local', firstName: 'Karim', lastName: 'Demo' },
  },
  {
    type: 'FINANCIAL_INSTITUTION',
    legalName: 'Hodna Leasing SPA (fictif)',
    wilayaCode: '16',
    adminRole: 'institution_admin',
    user: { email: 'banque@demo.tasheel.local', firstName: 'Samia', lastName: 'Demo' },
  },
  {
    type: 'BUSINESS',
    legalName: 'Tassili Agro Transformation EURL (fictif)',
    wilayaCode: '31',
    adminRole: 'business_admin',
    user: { email: 'entreprise@demo.tasheel.local', firstName: 'Yacine', lastName: 'Demo' },
  },
];

async function seedCatalogue(): Promise<void> {
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { description: p.description, allowedOrgTypes: [...p.allowedOrgTypes] },
      create: { code: p.code, description: p.description, allowedOrgTypes: [...p.allowedOrgTypes] },
    });
  }

  for (const r of SYSTEM_ROLES) {
    // Prisma cannot upsert on a compound unique containing NULL, so look it up first.
    const existing = await prisma.role.findFirst({ where: { organizationId: null, code: r.code } });
    const role = existing
      ? await prisma.role.update({
          where: { id: existing.id },
          data: { name: r.name, organizationType: r.organizationType },
        })
      : await prisma.role.create({
          data: {
            code: r.code,
            organizationType: r.organizationType,
            name: r.name,
            isSystem: true,
          },
        });

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: r.permissions.map((permissionCode) => ({
        roleId: role.id,
        permissionCode,
        organizationId: null,
      })),
    });
  }
}

async function seedDemoOrganizations(): Promise<void> {
  const passwordHash = await hash(DEMO_PASSWORD);

  for (const d of DEMO_ORGS) {
    const user = await prisma.user.upsert({
      where: { email: d.user.email },
      update: {},
      create: { ...d.user, passwordHash, emailVerifiedAt: new Date() },
    });

    let org = await prisma.organization.findFirst({ where: { legalName: d.legalName } });
    if (!org) {
      org = await prisma.organization.create({
        data: {
          type: d.type,
          legalName: d.legalName,
          wilayaCode: d.wilayaCode,
          status: 'VERIFIED',
          verifiedAt: new Date(),
        },
      });
    }

    const member = await prisma.organizationMember.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
      update: {},
      create: { userId: user.id, organizationId: org.id },
    });

    const role = await prisma.role.findFirstOrThrow({
      where: { organizationId: null, code: d.adminRole },
    });
    await prisma.memberRole.upsert({
      where: { memberId_roleId: { memberId: member.id, roleId: role.id } },
      update: {},
      create: { memberId: member.id, roleId: role.id, organizationId: org.id },
    });
  }
}

async function main(): Promise<void> {
  await seedCatalogue();
  if (process.argv.includes('--catalogue-only')) {
    console.log(
      `Seeded ${PERMISSIONS.length} permissions and ${SYSTEM_ROLES.length} system roles (no demo data).`,
    );
    return;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to create demo organizations in production. Use --catalogue-only.');
  }
  await seedDemoOrganizations();
  console.log(
    `Seeded ${PERMISSIONS.length} permissions, ${SYSTEM_ROLES.length} system roles, ${DEMO_ORGS.length} demo organizations.`,
  );
  console.log(
    `Demo users: ${DEMO_ORGS.map((d) => d.user.email).join(', ')} (password from SEED_DEMO_PASSWORD).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
