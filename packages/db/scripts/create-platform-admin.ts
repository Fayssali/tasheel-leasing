/**
 * Creates (or reuses) the Tasheel platform organization and a super administrator.
 * For a fresh server, after `prisma migrate deploy` and the catalogue seed. Idempotent.
 *
 *   PLATFORM_ADMIN_PASSWORD='…' pnpm db:create-admin -- --email admin@tasheel.dz --first Faissal --last Admin
 *
 * The password is read from the environment, never from the command line (shell history).
 * The admin must enable two-factor authentication at first sign-in: platform routes refuse
 * access until it is on.
 */
import { hash } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const email = arg('email')?.trim().toLowerCase();
  const firstName = arg('first')?.trim();
  const lastName = arg('last')?.trim();
  const orgName = arg('org')?.trim() ?? 'Tasheel Leasing';
  const password = process.env.PLATFORM_ADMIN_PASSWORD;

  if (!email || !firstName || !lastName) {
    throw new Error(
      'Usage: --email <email> --first <first name> --last <last name> [--org <name>]',
    );
  }
  if (!password || password.length < 12) {
    throw new Error('Set PLATFORM_ADMIN_PASSWORD (at least 12 characters) in the environment.');
  }

  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_ADMIN });
  try {
    const role = await prisma.role.findFirst({
      where: { organizationId: null, code: 'platform_super_admin' },
    });
    if (!role)
      throw new Error(
        'System roles missing: run `pnpm db:seed:catalogue` (or `pnpm db:seed`) first.',
      );

    let org = await prisma.organization.findFirst({ where: { type: 'PLATFORM', deletedAt: null } });
    if (!org) {
      org = await prisma.organization.create({
        data: {
          type: 'PLATFORM',
          legalName: orgName,
          status: 'VERIFIED',
          verifiedAt: new Date(),
          wilayaCode: '16',
        },
      });
      console.log(`Created platform organization "${orgName}".`);
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    const user =
      existing ??
      (await prisma.user.create({
        data: {
          email,
          firstName,
          lastName,
          passwordHash: await hash(password),
          emailVerifiedAt: new Date(),
        },
      }));

    const member = await prisma.organizationMember.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
      update: { status: 'ACTIVE', deletedAt: null },
      create: { userId: user.id, organizationId: org.id },
    });
    await prisma.memberRole.upsert({
      where: { memberId_roleId: { memberId: member.id, roleId: role.id } },
      update: {},
      create: { memberId: member.id, roleId: role.id, organizationId: org.id },
    });
    await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        actorUserId: null,
        action: 'platform.admin_bootstrapped',
        entityType: 'User',
        entityId: user.id,
        diff: { email, existingUser: Boolean(existing) },
      },
    });

    console.log(
      `Super administrator ready: ${email}${existing ? ' (existing account, password unchanged)' : ''}.`,
    );
    console.log('Next: sign in and enable two-factor authentication.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
