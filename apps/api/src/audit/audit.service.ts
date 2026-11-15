import { Injectable } from '@nestjs/common';
import type { TenantTx } from '@tasheel/db';
import type { RequestMeta } from '../common/request-context';

export interface AuditEntry {
  organizationId: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  diff?: Record<string, unknown> | null;
  meta?: RequestMeta;
}

const MASKED_FIELDS = new Set([
  'password',
  'passwordHash',
  'mfaSecret',
  'refreshTokenHash',
  'tokenHash',
]);

function mask(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, MASKED_FIELDS.has(k) ? '***' : v]),
  );
}

/**
 * Writes to the append-only audit log, inside the caller's tenant transaction so the
 * entry commits or rolls back together with the change it records.
 *
 * Uses createMany (a plain INSERT): `create` adds RETURNING, which PostgreSQL also checks
 * against the SELECT policy, and entries outside any organization (sign-in failures,
 * password resets) are deliberately not readable by the app role.
 */
@Injectable()
export class AuditService {
  async record(tx: TenantTx, entry: AuditEntry): Promise<void> {
    await tx.auditLog.createMany({
      data: {
        organizationId: entry.organizationId,
        actorUserId: entry.actorUserId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        diff: mask(entry.diff) as object | undefined,
        ipAddress: entry.meta?.ipAddress ?? null,
        userAgent: entry.meta?.userAgent ?? null,
      },
    });
  }
}
