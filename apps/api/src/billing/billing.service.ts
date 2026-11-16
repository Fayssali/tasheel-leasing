import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { asJson, sql, type TenantTx } from '@tasheel/db';
import {
  computeInvoiceTotals,
  formatMoney,
  fromCentimes,
  toCentimes,
  type Locale,
} from '@tasheel/shared';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta, TenantInfo } from '../common/request-context';
import { Notifier } from '../mail/notifier';
import { PrismaService } from '../prisma/prisma.service';
import type { BillingSettingsDto, CommissionRuleDto, CreditNoteDto } from './billing.dto';
import { BillingSettingsService, type BillingSettings } from './billing-settings.service';

const dateOnly = (iso: string) => new Date(`${iso}T00:00:00Z`);
const today = () => new Date(new Date().toISOString().slice(0, 10));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const dec = (v: unknown) => String(v);
const NOT_FOUND = { code: 'NOT_FOUND', message: 'Invoice not found.' };

interface InvoiceRow {
  id: string;
  organizationId: string;
  kind: 'INVOICE' | 'CREDIT_NOTE';
  number: string | null;
  status: 'DRAFT' | 'ISSUED' | 'PAID' | 'CANCELLED';
  periodStart: Date;
  periodEnd: Date;
  subtotal: unknown;
  lines: Array<{ label: string; amount: unknown; commissionId: string | null; sortOrder: number }>;
}

/**
 * Commission rules, commissions and invoicing. Amounts are exact (integer centimes, VAT once on
 * the subtotal). Invoice numbers are gapless per year and given only when an invoice is issued;
 * an issued invoice is never edited or deleted: it is cancelled by a credit note.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: BillingSettingsService,
    private readonly notifier: Notifier,
  ) {}

  // --- Settings and rules (Tasheel) ----------------------------------------------

  getSettings(tenant: TenantInfo) {
    return this.prisma.forTenant(tenant, (tx) => this.settings.get(tx));
  }

  async setSettings(tenant: TenantInfo, dto: BillingSettingsDto, meta: RequestMeta) {
    computeInvoiceTotals(['0'], dto.vatRate); // validates the rate format
    await this.prisma.forTenant(tenant, async (tx) => {
      await this.settings.set(tx, dto, tenant.userId);
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'billing.settings_updated',
        entityType: 'PlatformSetting',
        entityId: null,
        diff: { vatRate: dto.vatRate, paymentTermsDays: dto.paymentTermsDays },
        meta,
      });
    });
    return { ok: true };
  }

  rules(tenant: TenantInfo) {
    return this.prisma.forTenant(tenant, (tx) =>
      tx.commissionRule.findMany({
        include: { _count: { select: { commissions: true } } },
        orderBy: [{ trigger: 'asc' }, { validFrom: 'desc' }],
      }),
    );
  }

  async saveRule(tenant: TenantInfo, id: string | null, dto: CommissionRuleDto, meta: RequestMeta) {
    if (!dto.name.fr && !dto.name.ar)
      throw new BadRequestException({
        code: 'NAME_REQUIRED',
        message: 'Give the rule a name in French or Arabic.',
      });
    if (dto.basis === 'PERCENT' && !dto.ratePct)
      throw new BadRequestException({
        code: 'RATE_REQUIRED',
        message: 'A percentage rule needs a rate.',
      });
    if (dto.basis === 'FIXED' && !dto.fixedAmount)
      throw new BadRequestException({
        code: 'AMOUNT_REQUIRED',
        message: 'A fixed rule needs an amount.',
      });
    if (dto.minAmount && dto.maxAmount && toCentimes(dto.maxAmount) < toCentimes(dto.minAmount)) {
      throw new BadRequestException({
        code: 'INVALID_RANGE',
        message: 'The maximum is below the minimum.',
      });
    }
    if (dto.validTo && dto.validTo < dto.validFrom)
      throw new BadRequestException({
        code: 'INVALID_RANGE',
        message: 'The end date is before the start date.',
      });
    const data = {
      name: asJson(dto.name),
      trigger: dto.trigger,
      payerOrgId: dto.payerOrgId ?? null,
      basis: dto.basis,
      ratePct: dto.basis === 'PERCENT' ? dto.ratePct! : null,
      fixedAmount: dto.basis === 'FIXED' ? dto.fixedAmount! : null,
      minAmount: dto.basis === 'PERCENT' ? (dto.minAmount ?? null) : null,
      maxAmount: dto.basis === 'PERCENT' ? (dto.maxAmount ?? null) : null,
      categoryCodes: dto.categoryCodes,
      validFrom: dateOnly(dto.validFrom),
      validTo: dto.validTo ? dateOnly(dto.validTo) : null,
      isActive: dto.isActive,
    };
    return this.prisma.forTenant(tenant, async (tx) => {
      if (dto.payerOrgId) {
        const payer = (await tx.organization.findUnique({
          where: { id: dto.payerOrgId },
          select: { type: true },
        })) as { type: string } | null;
        const expected =
          dto.trigger === 'QUOTATION_ACCEPTED' ? 'SUPPLIER' : 'FINANCIAL_INSTITUTION';
        if (payer?.type !== expected)
          throw new BadRequestException({
            code: 'INVALID_PAYER',
            message: 'The organization does not match the rule (supplier or institution).',
          });
      }
      let ruleId = id;
      if (id) {
        if (!(await tx.commissionRule.findUnique({ where: { id }, select: { id: true } })))
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Rule not found.' });
        await tx.commissionRule.update({ where: { id }, data });
      } else {
        ruleId = uuidv7();
        await tx.commissionRule.create({
          data: { id: ruleId, createdById: tenant.userId, ...data },
        });
      }
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: id ? 'commission_rule.updated' : 'commission_rule.created',
        entityType: 'CommissionRule',
        entityId: ruleId,
        diff: { ...dto },
        meta,
      });
      return { id: ruleId };
    });
  }

  // --- Commissions ---------------------------------------------------------------

  commissions(
    tenant: TenantInfo,
    filter: { status?: 'ACCRUED' | 'INVOICED' | 'CANCELLED'; organizationId?: string },
  ) {
    return this.prisma.forTenant(tenant, async (tx) => {
      const rows = (await tx.commission.findMany({
        where: {
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.organizationId ? { organizationId: filter.organizationId } : {}),
        },
        include: {
          rule: { select: { name: true, basis: true } },
          invoice: { select: { id: true, number: true, status: true } },
        },
        orderBy: { accruedAt: 'desc' },
        take: 500,
      })) as Array<{ organizationId: string }>;
      return this.withOrgNames(tx, rows);
    });
  }

  /** Accrues commissions for accepted deals that have none (e.g. a rule created afterwards). */
  async accrueMissing(tenant: TenantInfo, meta: RequestMeta) {
    return this.prisma.forTenant(tenant, async (tx) => {
      const rows = (await tx.$queryRaw(
        sql`SELECT app_accrue_missing_commissions() AS n`,
      )) as Array<{ n: number }>;
      const accrued = Number(rows[0]?.n ?? 0);
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'commission.accrued_missing',
        entityType: 'Commission',
        entityId: null,
        diff: { accrued },
        meta,
      });
      return { accrued };
    });
  }

  // --- Invoices (Tasheel) ----------------------------------------------------------

  invoices(
    tenant: TenantInfo,
    filter: { status?: 'DRAFT' | 'ISSUED' | 'PAID' | 'CANCELLED'; organizationId?: string },
  ) {
    return this.prisma.forTenant(tenant, async (tx) => {
      const rows = (await tx.invoice.findMany({
        where: {
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.organizationId ? { organizationId: filter.organizationId } : {}),
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 500,
      })) as Array<{ organizationId: string }>;
      return this.withOrgNames(tx, rows);
    });
  }

  invoice(tenant: TenantInfo, id: string, ownOnly: boolean) {
    return this.prisma.forTenant(tenant, async (tx) => {
      const inv = (await tx.invoice.findFirst({
        where: {
          id,
          ...(ownOnly
            ? {
                organizationId: tenant.organizationId,
                status: { not: 'DRAFT' },
                number: { not: null },
              }
            : {}),
        },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      })) as (Record<string, unknown> & { organizationId: string }) | null;
      if (!inv) throw new NotFoundException(NOT_FOUND);
      const [named] = await this.withOrgNames(tx, [inv]);
      return named;
    });
  }

  /** One draft per payer with accrued, not yet invoiced commissions up to periodEnd. */
  async generateDrafts(tenant: TenantInfo, periodEnd: string, meta: RequestMeta) {
    const end = dateOnly(periodEnd);
    if (Number.isNaN(end.getTime()) || end > today())
      throw new BadRequestException({
        code: 'INVALID_PERIOD',
        message: 'The period must end today or earlier.',
      });
    return this.prisma.forTenant(tenant, async (tx) => {
      const settings = await this.settings.require(tx);
      const pending = (await tx.commission.findMany({
        where: { status: 'ACCRUED', invoiceId: null, accruedAt: { lt: addDays(end, 1) } },
        orderBy: { accruedAt: 'asc' },
      })) as Array<{
        id: string;
        organizationId: string;
        sourceReference: string;
        trigger: string;
        amount: unknown;
        accruedAt: Date;
      }>;
      const byPayer = new Map<string, typeof pending>();
      for (const c of pending)
        byPayer.set(c.organizationId, [...(byPayer.get(c.organizationId) ?? []), c]);

      const created: string[] = [];
      for (const [organizationId, list] of byPayer) {
        const lines = list.map((c, i) => ({
          id: uuidv7(),
          organizationId,
          commissionId: c.id,
          label: `${c.trigger === 'QUOTATION_ACCEPTED' ? 'Commission sur devis accepté' : 'Commission sur financement accepté'} ${c.sourceReference}`,
          amount: dec(c.amount),
          sortOrder: i,
        }));
        const totals = computeInvoiceTotals(
          lines.map((l) => l.amount),
          settings.vatRate,
        );
        const id = uuidv7();
        await tx.invoice.create({
          data: {
            id,
            organizationId,
            periodStart: new Date(list[0]!.accruedAt.toISOString().slice(0, 10)),
            periodEnd: end,
            ...totals,
            vatRate: settings.vatRate,
            createdById: tenant.userId,
          },
        });
        for (const l of lines) await tx.invoiceLine.create({ data: { ...l, invoiceId: id } });
        await tx.commission.updateMany({
          where: { id: { in: list.map((c) => c.id) }, invoiceId: null },
          data: { invoiceId: id },
        });
        created.push(id);
      }
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'invoice.drafts_generated',
        entityType: 'Invoice',
        entityId: null,
        diff: { periodEnd, drafts: created.length },
        meta,
      });
      return { drafts: created.length };
    });
  }

  /** Issues a draft: gapless number, identities snapshotted, VAT from the current settings. */
  async issue(tenant: TenantInfo, id: string, meta: RequestMeta) {
    const res = await this.prisma.forTenant(tenant, async (tx) => {
      const settings = await this.settings.require(tx);
      const inv = await this.load(tx, id);
      if (inv.status !== 'DRAFT')
        throw new ConflictException({
          code: 'INVOICE_NOT_DRAFT',
          message: 'Only a draft can be issued.',
        });
      // RC and NIF of the customer are mandatory mentions on an invoice: refuse rather than
      // issue a document that cannot be used for accounting. Fixed in the organization profile.
      const customer = await this.customer(tx, inv.organizationId);
      if (!customer.rcNumber || !customer.nif)
        throw new UnprocessableEntityException({
          code: 'CUSTOMER_IDENTITY_INCOMPLETE',
          message: 'The customer organization has no commercial register number or NIF.',
        });
      const issueDate = today();
      const number = await this.nextNumber(tx, settings, 'INVOICE', issueDate);
      const totals = computeInvoiceTotals(
        inv.lines.map((l) => dec(l.amount)),
        settings.vatRate,
      );
      const { count } = await tx.invoice.updateMany({
        where: { id, status: 'DRAFT' },
        data: {
          ...totals,
          number,
          status: 'ISSUED',
          vatRate: settings.vatRate,
          issueDate,
          dueDate: addDays(issueDate, settings.paymentTermsDays),
          issuer: asJson(settings.issuer),
          customer: asJson(customer),
        },
      });
      if (count !== 1)
        throw new ConflictException({
          code: 'CONCURRENT_CHANGE',
          message: 'The invoice changed meanwhile. Reload.',
        });
      await tx.commission.updateMany({
        where: { invoiceId: id, status: 'ACCRUED' },
        data: { status: 'INVOICED' },
      });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'invoice.issued',
        entityType: 'Invoice',
        entityId: id,
        diff: { number, ...totals },
        meta,
      });
      return {
        number,
        totals,
        organizationId: inv.organizationId,
        dueDate: addDays(issueDate, settings.paymentTermsDays),
      };
    });
    void this.notifier.notifyOrg(
      res.organizationId,
      'billing.read',
      'email.invoiceIssued',
      (locale: Locale) => ({
        number: res.number,
        total: formatMoney(res.totals.total, locale),
        dueDate: res.dueDate.toISOString().slice(0, 10).split('-').reverse().join('/'),
      }),
      '/app/billing',
    );
    return { id, number: res.number, ...res.totals };
  }

  async discardDraft(tenant: TenantInfo, id: string, meta: RequestMeta) {
    return this.prisma.forTenant(tenant, async (tx) => {
      const { count } = await tx.invoice.updateMany({
        where: { id, status: 'DRAFT' },
        data: { status: 'CANCELLED' },
      });
      if (count !== 1)
        throw new ConflictException({
          code: 'INVOICE_NOT_DRAFT',
          message: 'Only a draft can be discarded.',
        });
      await tx.commission.updateMany({
        where: { invoiceId: id, status: 'ACCRUED' },
        data: { invoiceId: null },
      });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'invoice.draft_discarded',
        entityType: 'Invoice',
        entityId: id,
        meta,
      });
      return { id, status: 'CANCELLED' };
    });
  }

  async markPaid(
    tenant: TenantInfo,
    id: string,
    paidOn: string,
    reference: string,
    meta: RequestMeta,
  ) {
    const paidAt = dateOnly(paidOn);
    if (Number.isNaN(paidAt.getTime()) || paidAt > today())
      throw new BadRequestException({
        code: 'INVALID_DATE',
        message: 'The payment date cannot be in the future.',
      });
    return this.prisma.forTenant(tenant, async (tx) => {
      const { count } = await tx.invoice.updateMany({
        where: { id, status: 'ISSUED', kind: 'INVOICE' },
        data: { status: 'PAID', paidAt, paymentReference: reference },
      });
      if (count !== 1)
        throw new ConflictException({
          code: 'INVOICE_NOT_ISSUED',
          message: 'Only an issued invoice can be marked as paid.',
        });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'invoice.paid',
        entityType: 'Invoice',
        entityId: id,
        diff: { paidOn, reference },
        meta,
      });
      return { id, status: 'PAID' };
    });
  }

  /** Cancels an issued (or paid) invoice with a credit note mirroring it exactly. */
  async creditNote(tenant: TenantInfo, id: string, dto: CreditNoteDto, meta: RequestMeta) {
    return this.prisma.forTenant(tenant, async (tx) => {
      const settings = await this.settings.require(tx);
      const inv = await this.load(tx, id);
      if (inv.kind !== 'INVOICE' || !['ISSUED', 'PAID'].includes(inv.status)) {
        throw new ConflictException({
          code: 'INVOICE_NOT_CREDITABLE',
          message: 'Only an issued or paid invoice can be credited.',
        });
      }
      const original = (await tx.invoice.findUnique({
        where: { id },
        select: { vatRate: true, customer: true, number: true },
      })) as { vatRate: unknown; customer: object; number: string };
      const lines = inv.lines.map((l, i) => ({
        id: uuidv7(),
        organizationId: inv.organizationId,
        commissionId: l.commissionId,
        label: `Annulation — ${l.label}`,
        amount: fromCentimes(-toCentimes(dec(l.amount))),
        sortOrder: i,
      }));
      // Same VAT rate as the invoice it cancels, so the credit note mirrors it to the centime.
      const totals = computeInvoiceTotals(
        lines.map((l) => l.amount),
        Number(original.vatRate).toString(),
      );
      const issueDate = today();
      const creditId = uuidv7();
      const number = await this.nextNumber(tx, settings, 'CREDIT_NOTE', issueDate);
      await tx.invoice.create({
        data: {
          id: creditId,
          organizationId: inv.organizationId,
          kind: 'CREDIT_NOTE',
          number,
          status: 'ISSUED',
          creditedInvoiceId: id,
          periodStart: inv.periodStart,
          periodEnd: inv.periodEnd,
          issueDate,
          ...totals,
          vatRate: dec(original.vatRate),
          issuer: asJson(settings.issuer),
          customer: asJson(original.customer),
          notes: dto.reason,
          createdById: tenant.userId,
        },
      });
      for (const l of lines) await tx.invoiceLine.create({ data: { ...l, invoiceId: creditId } });
      await tx.invoice.update({ where: { id }, data: { status: 'CANCELLED' } });
      await tx.commission.updateMany({
        where: { invoiceId: id },
        data: dto.releaseCommissions
          ? { status: 'ACCRUED', invoiceId: null }
          : { status: 'CANCELLED' },
      });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'invoice.credited',
        entityType: 'Invoice',
        entityId: id,
        diff: {
          creditNote: number,
          invoice: original.number,
          reason: dto.reason,
          releaseCommissions: dto.releaseCommissions,
        },
        meta,
      });
      return { id: creditId, number, ...totals };
    });
  }

  // --- Payer (supplier or institution) ----------------------------------------------

  payerInvoices(tenant: TenantInfo) {
    return this.prisma.forTenant(tenant, (tx) =>
      tx.invoice.findMany({
        where: { organizationId: tenant.organizationId, number: { not: null } },
        orderBy: { issueDate: 'desc' },
      }),
    );
  }

  payerCommissions(tenant: TenantInfo) {
    return this.prisma.forTenant(tenant, (tx) =>
      tx.commission.findMany({
        where: { organizationId: tenant.organizationId },
        include: { invoice: { select: { number: true, status: true } } },
        orderBy: { accruedAt: 'desc' },
        take: 500,
      }),
    );
  }

  /** The rules that apply to the payer (RLS returns only those). */
  payerRules(tenant: TenantInfo) {
    return this.prisma.forTenant(tenant, (tx) =>
      tx.commissionRule.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          trigger: true,
          basis: true,
          ratePct: true,
          fixedAmount: true,
          minAmount: true,
          maxAmount: true,
          categoryCodes: true,
          validFrom: true,
          validTo: true,
          payerOrgId: true,
        },
        orderBy: { validFrom: 'desc' },
      }),
    );
  }

  // ---------------------------------------------------------------------------

  private async load(tx: TenantTx, id: string): Promise<InvoiceRow> {
    const inv = (await tx.invoice.findUnique({
      where: { id },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    })) as InvoiceRow | null;
    if (!inv) throw new NotFoundException(NOT_FOUND);
    return inv;
  }

  /** Gapless per year: the counter row is locked until the transaction commits. */
  private async nextNumber(
    tx: TenantTx,
    settings: BillingSettings,
    kind: 'INVOICE' | 'CREDIT_NOTE',
    date: Date,
  ): Promise<string> {
    const year = date.getUTCFullYear();
    const rows = (await tx.$queryRaw(sql`
      INSERT INTO invoice_counters (year, last) VALUES (${year}, 1)
      ON CONFLICT (year) DO UPDATE SET last = invoice_counters.last + 1
      RETURNING last`)) as Array<{ last: number }>;
    const prefix = kind === 'INVOICE' ? settings.invoicePrefix : settings.creditNotePrefix;
    return `${prefix}-${year}-${String(rows[0]!.last).padStart(6, '0')}`;
  }

  private async customer(tx: TenantTx, organizationId: string) {
    return (await tx.organization.findUnique({
      where: { id: organizationId },
      select: {
        legalName: true,
        tradeName: true,
        rcNumber: true,
        nif: true,
        nis: true,
        articleImposition: true,
        address: true,
        wilayaCode: true,
      },
    })) as Record<string, string | null>;
  }

  private async withOrgNames<T extends { organizationId: string }>(
    tx: TenantTx,
    rows: T[],
  ): Promise<Array<T & { organizationName: string }>> {
    const ids = [...new Set(rows.map((r) => r.organizationId))];
    const orgs = ids.length
      ? ((await tx.organization.findMany({
          where: { id: { in: ids } },
          select: { id: true, legalName: true },
        })) as Array<{ id: string; legalName: string }>)
      : [];
    const names = new Map(orgs.map((o) => [o.id, o.legalName]));
    return rows.map((r) => ({ ...r, organizationName: names.get(r.organizationId) ?? '' }));
  }
}
