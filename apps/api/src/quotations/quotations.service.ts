import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TenantContext, TenantTx } from '@tasheel/db';
import {
  computeQuotationTotals,
  formatMoney,
  type Locale,
  type QuotationLineInput,
} from '@tasheel/shared';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service';
import { nextReference } from '../common/references';
import type { RequestMeta, TenantInfo } from '../common/request-context';
import { Mailer } from '../mail/mailer';
import { buildMail } from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';

interface Recipient {
  email: string;
  firstName: string;
  locale: Locale;
}

interface QuotationRow {
  id: string;
  organizationId: string;
  businessOrgId: string;
  requestId: string;
  reference: string;
  status: string;
  validUntil: Date;
  total: unknown;
  currency: string;
  issuedById: string;
  request: { status: string; requestedById: string; businessName: string; reference: string };
  listing: { title: { fr?: string; ar?: string } };
}

export interface RequestInput {
  listingId: string;
  quantity: number;
  message?: string;
  deliveryWilaya?: string;
}

export interface IssueInput {
  lines: QuotationLineInput[];
  vatRate: string;
  validUntil: string; // YYYY-MM-DD
  deliveryTerms?: string;
  notes?: string;
}

const today = () => new Date(new Date().toISOString().slice(0, 10));
/** A quotation past its validity date is presented and treated as EXPIRED. */
export const effectiveStatus = (q: { status: string; validUntil: Date }) =>
  q.status === 'ISSUED' && new Date(q.validUntil) < today() ? 'EXPIRED' : q.status;

const title = (t: { fr?: string; ar?: string }, locale: Locale) =>
  (locale === 'ar' ? (t.ar ?? t.fr) : (t.fr ?? t.ar)) ?? '';

/**
 * Quotations between a business and a supplier, around one listing. Each record is owned by
 * its author and shared with the counter-party through RLS (business_org_id / supplier_org_id).
 * Tasheel only carries the exchange; prices and terms are the supplier's.
 */
@Injectable()
export class QuotationsService {
  private readonly logger = new Logger(QuotationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mailer: Mailer,
    private readonly config: ConfigService,
  ) {}

  async request(tenant: TenantInfo, input: RequestInput, meta: RequestMeta) {
    if (tenant.organizationStatus !== 'VERIFIED') {
      throw new ForbiddenException({
        code: 'ORGANIZATION_NOT_VERIFIED',
        message: 'Your organization must be verified before requesting quotations.',
      });
    }
    const created = await this.prisma.forTenant(tenant, async (tx) => {
      const listing = (await tx.equipmentListing.findFirst({
        where: { id: input.listingId, status: 'PUBLISHED', deletedAt: null },
        select: { id: true, organizationId: true, title: true },
      })) as { id: string; organizationId: string; title: { fr?: string; ar?: string } } | null;
      if (!listing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Listing not found.' });

      const [org, user] = (await Promise.all([
        tx.organization.findUnique({
          where: { id: tenant.organizationId },
          select: { legalName: true },
        }),
        tx.user.findUnique({
          where: { id: tenant.userId },
          select: { firstName: true, lastName: true },
        }),
      ])) as [{ legalName: string }, { firstName: string; lastName: string }];

      const id = uuidv7();
      const reference = await nextReference(tx, 'QR');
      await tx.quotationRequest.create({
        data: {
          id,
          reference,
          organizationId: tenant.organizationId,
          supplierOrgId: listing.organizationId,
          listingId: listing.id,
          requestedById: tenant.userId,
          businessName: org.legalName,
          requesterName: `${user.firstName} ${user.lastName}`,
          quantity: input.quantity,
          message: input.message?.trim() || null,
          deliveryWilaya: input.deliveryWilaya ?? null,
        },
      });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'quotation.requested',
        entityType: 'QuotationRequest',
        entityId: id,
        diff: { reference, listingId: listing.id, supplierOrgId: listing.organizationId },
        meta,
      });
      return {
        id,
        reference,
        supplierOrgId: listing.organizationId,
        listingTitle: listing.title,
        businessName: org.legalName,
      };
    });

    const recipients = await this.membersWith(created.supplierOrgId, 'quotation.respond');
    for (const r of recipients) {
      this.deliver(
        buildMail({
          locale: r.locale,
          to: r.email,
          name: r.firstName,
          key: 'email.quoteRequested',
          vars: {
            reference: created.reference,
            business: created.businessName,
            listing: title(created.listingTitle, r.locale),
            quantity: input.quantity,
          },
          actionUrl: this.link('/app/quotations'),
        }),
      );
    }
    return { id: created.id, reference: created.reference };
  }

  /** Business side: my requests with the quotations received. */
  async forBusiness(tenant: TenantInfo) {
    const rows = (await this.prisma.forTenant(tenant, (tx) =>
      tx.quotationRequest.findMany({
        where: { organizationId: tenant.organizationId },
        include: {
          listing: {
            select: {
              id: true,
              reference: true,
              title: true,
              organization: { select: { id: true, legalName: true } },
            },
          },
          quotations: { orderBy: { createdAt: 'desc' } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    )) as Array<{ quotations: Array<{ status: string; validUntil: Date }> }>;
    return rows.map((r) => ({
      ...r,
      quotations: r.quotations.map((q) => ({ ...q, status: effectiveStatus(q) })),
    }));
  }

  /** Supplier side: requests addressed to me, with the quotations I issued. */
  async forSupplier(tenant: TenantInfo, status?: string) {
    const rows = (await this.prisma.forTenant(tenant, (tx) =>
      tx.quotationRequest.findMany({
        where: { supplierOrgId: tenant.organizationId, ...(status ? { status } : {}) },
        include: {
          listing: {
            select: { id: true, reference: true, title: true, price: true, currency: true },
          },
          quotations: {
            where: { organizationId: tenant.organizationId },
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    )) as Array<{ quotations: Array<{ status: string; validUntil: Date }> }>;
    return rows.map((r) => ({
      ...r,
      quotations: r.quotations.map((q) => ({ ...q, status: effectiveStatus(q) })),
    }));
  }

  /** Issues a quotation. A new one replaces (withdraws) the supplier's previous open quotation. */
  async issue(tenant: TenantInfo, requestId: string, input: IssueInput, meta: RequestMeta) {
    if (!input.lines.length)
      throw new BadRequestException({ code: 'LINES_REQUIRED', message: 'Add at least one line.' });
    const validUntil = new Date(`${input.validUntil}T00:00:00Z`);
    if (Number.isNaN(validUntil.getTime()) || validUntil < today()) {
      throw new BadRequestException({
        code: 'INVALID_VALIDITY',
        message: 'The validity date must be today or later.',
      });
    }
    let totals;
    try {
      totals = computeQuotationTotals(input.lines, input.vatRate);
    } catch (err) {
      throw new BadRequestException({
        code: 'INVALID_AMOUNTS',
        message: err instanceof Error ? err.message : 'Invalid amounts.',
      });
    }

    const issued = await this.prisma.forTenant(tenant, async (tx) => {
      const request = (await tx.quotationRequest.findFirst({
        where: { id: requestId, supplierOrgId: tenant.organizationId },
        include: { listing: { select: { title: true } } },
      })) as {
        id: string;
        organizationId: string;
        listingId: string;
        status: string;
        requestedById: string;
        listing: { title: { fr?: string; ar?: string } };
      } | null;
      if (!request)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Quotation request not found.' });
      if (!['OPEN', 'QUOTED'].includes(request.status)) {
        throw new ConflictException({
          code: 'REQUEST_CLOSED',
          message: 'This request is closed or cancelled.',
        });
      }

      await tx.quotation.updateMany({
        where: { requestId, organizationId: tenant.organizationId, status: 'ISSUED' },
        data: { status: 'WITHDRAWN', decidedAt: new Date() },
      });
      const id = uuidv7();
      const reference = await nextReference(tx, 'QT');
      await tx.quotation.create({
        data: {
          id,
          reference,
          organizationId: tenant.organizationId,
          businessOrgId: request.organizationId,
          requestId,
          listingId: request.listingId,
          issuedById: tenant.userId,
          lines: totals.lines as unknown as object[],
          subtotal: totals.subtotal,
          vatRate: input.vatRate,
          vatAmount: totals.vatAmount,
          total: totals.total,
          validUntil,
          deliveryTerms: input.deliveryTerms?.trim() || null,
          notes: input.notes?.trim() || null,
        },
      });
      await tx.quotationRequest.update({ where: { id: requestId }, data: { status: 'QUOTED' } });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'quotation.issued',
        entityType: 'Quotation',
        entityId: id,
        diff: { reference, requestId, total: totals.total, vatRate: input.vatRate },
        meta,
      });
      const supplier = (await tx.organization.findUnique({
        where: { id: tenant.organizationId },
        select: { legalName: true },
      })) as { legalName: string };
      return {
        id,
        reference,
        requestedById: request.requestedById,
        listingTitle: request.listing.title,
        supplierName: supplier.legalName,
      };
    });

    const requester = await this.user(issued.requestedById);
    if (requester) {
      this.deliver(
        buildMail({
          locale: requester.locale,
          to: requester.email,
          name: requester.firstName,
          key: 'email.quoteIssued',
          vars: {
            reference: issued.reference,
            supplier: issued.supplierName,
            listing: title(issued.listingTitle, requester.locale),
            total: formatMoney(totals.total, requester.locale),
            validUntil: input.validUntil.split('-').reverse().join('/'),
          },
          actionUrl: this.link('/app/quotations'),
        }),
      );
    }
    return { id: issued.id, reference: issued.reference, ...totals };
  }

  /** Business decision. Accepting closes the request; the quotation can then feed a financing application (Phase 3). */
  async decide(
    tenant: TenantInfo,
    quotationId: string,
    decision: 'accept' | 'decline',
    meta: RequestMeta,
  ) {
    const result = await this.prisma.forTenant(tenant, async (tx) => {
      const q = (await tx.quotation.findFirst({
        where: { id: quotationId, businessOrgId: tenant.organizationId },
        include: {
          request: {
            select: { status: true, requestedById: true, businessName: true, reference: true },
          },
          listing: { select: { title: true } },
        },
      })) as QuotationRow | null;
      if (!q) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Quotation not found.' });
      if (effectiveStatus(q) !== 'ISSUED') {
        throw new ConflictException({
          code: 'QUOTATION_NOT_OPEN',
          message: `This quotation is ${effectiveStatus(q).toLowerCase()}.`,
        });
      }
      if (q.request.status === 'CANCELLED' || q.request.status === 'CLOSED') {
        throw new ConflictException({
          code: 'REQUEST_CLOSED',
          message: 'This request is closed or cancelled.',
        });
      }
      const status = decision === 'accept' ? 'ACCEPTED' : 'DECLINED';
      const { count } = await tx.quotation.updateMany({
        where: { id: quotationId, status: 'ISSUED' },
        data: { status, decidedAt: new Date() },
      });
      if (count !== 1)
        throw new ConflictException({
          code: 'CONCURRENT_CHANGE',
          message: 'The quotation changed meanwhile. Reload.',
        });
      if (decision === 'accept')
        await tx.quotationRequest.update({
          where: { id: q.requestId },
          data: { status: 'CLOSED' },
        });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: `quotation.${status.toLowerCase()}`,
        entityType: 'Quotation',
        entityId: quotationId,
        diff: { reference: q.reference },
        meta,
      });
      return q;
    });

    const issuer = await this.user(result.issuedById);
    if (issuer) {
      this.deliver(
        buildMail({
          locale: issuer.locale,
          to: issuer.email,
          name: issuer.firstName,
          key: decision === 'accept' ? 'email.quoteAccepted' : 'email.quoteDeclined',
          vars: {
            reference: result.reference,
            business: result.request.businessName,
            listing: title(result.listing.title, issuer.locale),
          },
          actionUrl: this.link('/app/quotations'),
        }),
      );
    }
    return { id: quotationId, status: decision === 'accept' ? 'ACCEPTED' : 'DECLINED' };
  }

  async withdraw(tenant: TenantInfo, quotationId: string, meta: RequestMeta) {
    return this.prisma.forTenant(tenant, async (tx) => {
      const { count } = await tx.quotation.updateMany({
        where: { id: quotationId, organizationId: tenant.organizationId, status: 'ISSUED' },
        data: { status: 'WITHDRAWN', decidedAt: new Date() },
      });
      if (count !== 1)
        throw new ConflictException({
          code: 'QUOTATION_NOT_OPEN',
          message: 'Only an open quotation can be withdrawn.',
        });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'quotation.withdrawn',
        entityType: 'Quotation',
        entityId: quotationId,
        meta,
      });
      return { id: quotationId, status: 'WITHDRAWN' };
    });
  }

  async cancelRequest(tenant: TenantInfo, requestId: string, meta: RequestMeta) {
    return this.prisma.forTenant(tenant, async (tx) => {
      const { count } = await tx.quotationRequest.updateMany({
        where: {
          id: requestId,
          organizationId: tenant.organizationId,
          status: { in: ['OPEN', 'QUOTED'] },
        },
        data: { status: 'CANCELLED' },
      });
      if (count !== 1)
        throw new ConflictException({
          code: 'REQUEST_CLOSED',
          message: 'This request is already closed.',
        });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'quotation.request_cancelled',
        entityType: 'QuotationRequest',
        entityId: requestId,
        meta,
      });
      return { id: requestId, status: 'CANCELLED' };
    });
  }

  // ---------------------------------------------------------------------------

  /**
   * Active members of another organization holding a permission, for notifications only.
   * Runs in that organization's context on the server's own authority (system context):
   * nothing from it is returned to the caller.
   */
  private async membersWith(organizationId: string, permission: string): Promise<Recipient[]> {
    const system: TenantContext = { organizationId, userId: null };
    const rows = (await this.prisma.forTenant(system, (tx: TenantTx) =>
      tx.organizationMember.findMany({
        where: {
          organizationId,
          status: 'ACTIVE',
          deletedAt: null,
          roles: { some: { role: { permissions: { some: { permissionCode: permission } } } } },
        },
        select: { user: { select: { email: true, firstName: true, locale: true } } },
      }),
    )) as Array<{ user: Recipient }>;
    return rows.map((r) => r.user);
  }

  private async user(id: string): Promise<Recipient | null> {
    return (await this.prisma.user.findUnique({
      where: { id },
      select: { email: true, firstName: true, locale: true },
    })) as Recipient | null;
  }

  private link(path: string): string {
    return `${(this.config.get<string>('WEB_APP_URL') ?? 'http://localhost:5173').replace(/\/$/, '')}${path}`;
  }

  private deliver(mail: Parameters<Mailer['send']>[0]): void {
    this.mailer.send(mail).catch((err: unknown) => {
      this.logger.error(
        `Failed to send "${mail.subject}": ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }
}
