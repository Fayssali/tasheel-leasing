/**
 * Seeds the permission catalogue, system roles and a minimal set of FICTIONAL demo
 * organizations. Runs with the admin role (DATABASE_URL_ADMIN), which owns the tables
 * and is therefore not subject to RLS. Safe to run repeatedly (upserts).
 *
 * Marketplace demo (3 suppliers, 5 businesses, 20 listings, quotations) comes from
 * demo-marketplace.ts. Financing applications are added in Phase 3.
 */
import { hash } from '@node-rs/argon2';
import { PrismaClient, type OrganizationType } from '@prisma/client';
import { DOCUMENT_TYPES, EQUIPMENT_CATEGORIES, PERMISSIONS, SYSTEM_ROLES } from '@tasheel/shared';
import { seedDemoMarketplace } from './demo-marketplace';

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
  {
    type: 'SUPPLIER',
    legalName: 'Sahel Agri Équipement EURL (fictif)',
    wilayaCode: '07',
    adminRole: 'supplier_admin',
    user: { email: 'fournisseur2@demo.tasheel.local', firstName: 'Lamine', lastName: 'Demo' },
  },
  {
    type: 'SUPPLIER',
    legalName: 'MediTech Solutions Algérie SPA (fictif)',
    wilayaCode: '16',
    adminRole: 'supplier_admin',
    user: { email: 'fournisseur3@demo.tasheel.local', firstName: 'Nesrine', lastName: 'Demo' },
  },
  {
    type: 'BUSINESS',
    legalName: 'Djurdjura Travaux Publics SPA (fictif)',
    wilayaCode: '15',
    adminRole: 'business_admin',
    user: { email: 'entreprise2@demo.tasheel.local', firstName: 'Mourad', lastName: 'Demo' },
  },
  {
    type: 'BUSINESS',
    legalName: 'Clinique Les Palmiers SARL (fictif)',
    wilayaCode: '16',
    adminRole: 'business_admin',
    user: { email: 'entreprise3@demo.tasheel.local', firstName: 'Lina', lastName: 'Demo' },
  },
  {
    type: 'BUSINESS',
    legalName: 'Oasis Froid Industriel SARL (fictif)',
    wilayaCode: '30',
    adminRole: 'business_admin',
    user: { email: 'entreprise4@demo.tasheel.local', firstName: 'Nadia', lastName: 'Demo' },
  },
  {
    type: 'BUSINESS',
    legalName: 'Imprimerie El Bahdja EURL (fictif)',
    wilayaCode: '16',
    adminRole: 'business_admin',
    user: { email: 'entreprise5@demo.tasheel.local', firstName: 'Sofiane', lastName: 'Demo' },
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

async function seedCategories(): Promise<void> {
  for (const [i, c] of EQUIPMENT_CATEGORIES.entries()) {
    await prisma.equipmentCategory.upsert({
      where: { code: c.code },
      update: { name: c.name, specSchema: c.specSchema as object[], sortOrder: i },
      create: { code: c.code, name: c.name, specSchema: c.specSchema as object[], sortOrder: i },
    });
  }
  // Document types: inserted once, then owned by the database (Tasheel may adjust them there).
  for (const [i, d] of DOCUMENT_TYPES.entries()) {
    await prisma.documentType.upsert({
      where: { code: d.code },
      update: {},
      create: {
        code: d.code,
        name: d.name,
        ownerTypes: d.ownerTypes,
        requiredForVerification: d.requiredForVerification,
        requiredForApplication: d.requiredForApplication,
        hasExpiry: d.hasExpiry,
        sortOrder: i,
      },
    });
  }
}

async function seedDemoOrganizations(): Promise<
  Map<string, { id: string; userId: string; name: string }>
> {
  const passwordHash = await hash(DEMO_PASSWORD);
  const byName = new Map<string, { id: string; userId: string; name: string }>();

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
    byName.set(d.legalName, { id: org.id, userId: user.id, name: d.legalName });
  }
  return byName;
}

async function main(): Promise<void> {
  await seedCatalogue();
  await seedCategories();
  if (process.argv.includes('--catalogue-only')) {
    console.log(
      `Seeded ${PERMISSIONS.length} permissions and ${SYSTEM_ROLES.length} system roles (no demo data).`,
    );
    return;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to create demo organizations in production. Use --catalogue-only.');
  }
  const orgs = await seedDemoOrganizations();
  const marketplace = await seedDemoMarketplace(prisma, orgs);
  console.log(
    `Seeded ${PERMISSIONS.length} permissions, ${SYSTEM_ROLES.length} system roles, ${DEMO_ORGS.length} demo organizations.`,
  );
  console.log(`Marketplace demo: ${marketplace}.`);
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
