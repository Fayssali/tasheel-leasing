import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { sql, type TenantTx } from '@tasheel/db';
import { CurrentTenant, RequirePermissions, TenantScoped } from '../common/decorators';
import type { TenantInfo } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

type Row = Record<string, string | number | null>;
type Series = Array<{ month: string; value: string }>;

/**
 * Activity figures per organization type. Everything runs under the tenant's RLS context, so a
 * report can only count what the organization may see. Money is summed in SQL and returned as
 * exact decimal text.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  overview(tenant: TenantInfo) {
    return this.prisma.forTenant(tenant, async (tx) => {
      switch (tenant.organizationType) {
        case 'SUPPLIER':
          return { kind: 'SUPPLIER', ...(await this.supplier(tx, tenant.organizationId)) };
        case 'BUSINESS':
          return { kind: 'BUSINESS', ...(await this.business(tx, tenant.organizationId)) };
        case 'FINANCIAL_INSTITUTION':
          return {
            kind: 'FINANCIAL_INSTITUTION',
            ...(await this.institution(tx, tenant.organizationId)),
          };
        default:
          return { kind: tenant.organizationType };
      }
    });
  }

  platform(tenant: TenantInfo) {
    return this.prisma.forTenant(tenant, async (tx) => {
      const [m] = await rows(
        tx,
        sql`
        SELECT
          (SELECT count(*) FROM equipment_listings WHERE status = 'PUBLISHED' AND deleted_at IS NULL)::int AS "publishedListings",
          (SELECT count(*) FROM quotation_requests)::int AS "quotationRequests",
          (SELECT count(*) FROM quotations WHERE status = 'ACCEPTED')::int AS "acceptedQuotations",
          (SELECT coalesce(sum(subtotal), 0) FROM quotations WHERE status = 'ACCEPTED')::text AS "acceptedQuotationValue",
          (SELECT count(*) FROM financing_applications WHERE status <> 'DRAFT')::int AS "submittedApplications",
          (SELECT count(*) FROM offers WHERE status = 'ACCEPTED')::int AS "acceptedOffers",
          (SELECT coalesce(sum(financed_amount), 0) FROM offers WHERE status = 'ACCEPTED')::text AS "financedVolume",
          (SELECT coalesce(sum(amount), 0) FROM commissions WHERE status = 'ACCRUED')::text AS "commissionsAccrued",
          (SELECT coalesce(sum(amount), 0) FROM commissions WHERE status = 'INVOICED')::text AS "commissionsInvoiced",
          (SELECT coalesce(sum(total), 0) FROM invoices WHERE kind = 'INVOICE' AND status = 'ISSUED')::text AS "receivables",
          (SELECT coalesce(sum(total), 0) FROM invoices WHERE kind = 'INVOICE' AND status = 'ISSUED' AND due_date < current_date)::text AS "overdue",
          (SELECT coalesce(sum(total), 0) FROM invoices WHERE kind = 'INVOICE' AND paid_at IS NOT NULL)::text AS "collected"`,
      );
      return {
        ...m,
        financedByMonth: await monthly(
          tx,
          sql`SELECT date_trunc('month', decided_at) AS m, sum(financed_amount) AS v FROM offers WHERE status = 'ACCEPTED' AND decided_at IS NOT NULL GROUP BY 1`,
        ),
        commissionsByMonth: await monthly(
          tx,
          sql`SELECT date_trunc('month', accrued_at) AS m, sum(amount) AS v FROM commissions WHERE status <> 'CANCELLED' GROUP BY 1`,
        ),
      };
    });
  }

  private async supplier(tx: TenantTx, org: string) {
    const [m] = await rows(
      tx,
      sql`
      SELECT
        (SELECT count(*) FROM equipment_listings WHERE organization_id = ${org}::uuid AND status = 'PUBLISHED' AND deleted_at IS NULL)::int AS "publishedListings",
        (SELECT coalesce(sum(view_count), 0) FROM equipment_listings WHERE organization_id = ${org}::uuid)::int AS "views",
        (SELECT count(*) FROM quotation_requests WHERE supplier_org_id = ${org}::uuid)::int AS "requestsReceived",
        (SELECT count(*) FROM quotation_requests WHERE supplier_org_id = ${org}::uuid AND status = 'OPEN')::int AS "requestsAwaiting",
        (SELECT count(*) FROM quotations WHERE organization_id = ${org}::uuid AND status <> 'WITHDRAWN')::int AS "quotationsIssued",
        (SELECT count(*) FROM quotations WHERE organization_id = ${org}::uuid AND status = 'ACCEPTED')::int AS "quotationsAccepted",
        (SELECT coalesce(sum(subtotal), 0) FROM quotations WHERE organization_id = ${org}::uuid AND status = 'ACCEPTED')::text AS "acceptedValue",
        ${billingColumns(org)}`,
    );
    return {
      ...m,
      acceptanceRate: rate(m!.quotationsAccepted, m!.quotationsIssued),
      requestsByMonth: await monthly(
        tx,
        sql`SELECT date_trunc('month', created_at) AS m, count(*) AS v FROM quotation_requests WHERE supplier_org_id = ${org}::uuid GROUP BY 1`,
      ),
    };
  }

  private async business(tx: TenantTx, org: string) {
    const [m] = await rows(
      tx,
      sql`
      SELECT
        (SELECT count(*) FROM quotation_requests WHERE organization_id = ${org}::uuid)::int AS "requestsSent",
        (SELECT count(*) FROM quotations WHERE business_org_id = ${org}::uuid AND status <> 'WITHDRAWN')::int AS "quotationsReceived",
        (SELECT count(*) FROM quotations WHERE business_org_id = ${org}::uuid AND status = 'ACCEPTED')::int AS "quotationsAccepted",
        (SELECT count(*) FROM financing_applications WHERE organization_id = ${org}::uuid AND status <> 'DRAFT')::int AS "applicationsSubmitted",
        (SELECT count(*) FROM financing_applications WHERE organization_id = ${org}::uuid AND status = 'DRAFT')::int AS "applicationsDraft",
        (SELECT count(*) FROM offers WHERE business_org_id = ${org}::uuid AND status <> 'WITHDRAWN')::int AS "offersReceived",
        (SELECT count(*) FROM offers WHERE business_org_id = ${org}::uuid AND status = 'ACCEPTED')::int AS "offersAccepted",
        (SELECT coalesce(sum(financed_amount), 0) FROM offers WHERE business_org_id = ${org}::uuid AND status = 'ACCEPTED')::text AS "financedAmount"`,
    );
    return m!;
  }

  private async institution(tx: TenantTx, org: string) {
    const [m] = await rows(
      tx,
      sql`
      SELECT
        (SELECT count(*) FROM application_submissions WHERE institution_org_id = ${org}::uuid AND status <> 'WITHDRAWN')::int AS "received",
        (SELECT count(*) FROM application_submissions WHERE institution_org_id = ${org}::uuid AND status IN ('SENT', 'UNDER_REVIEW', 'INFO_REQUESTED'))::int AS "toReview",
        (SELECT count(*) FROM application_submissions WHERE institution_org_id = ${org}::uuid AND status = 'DECLINED')::int AS "declined",
        (SELECT count(*) FROM offers WHERE organization_id = ${org}::uuid AND status <> 'WITHDRAWN')::int AS "offersIssued",
        (SELECT count(*) FROM offers WHERE organization_id = ${org}::uuid AND status = 'ACCEPTED')::int AS "offersAccepted",
        (SELECT coalesce(sum(financed_amount), 0) FROM offers WHERE organization_id = ${org}::uuid AND status = 'ACCEPTED')::text AS "financedVolume",
        (SELECT round(avg(extract(epoch FROM (o.first_offer - s.created_at)) / 3600)::numeric, 1)
           FROM application_submissions s
           JOIN LATERAL (SELECT min(created_at) AS first_offer FROM offers WHERE submission_id = s.id) o ON o.first_offer IS NOT NULL
           WHERE s.institution_org_id = ${org}::uuid)::text AS "avgHoursToFirstOffer",
        ${billingColumns(org)}`,
    );
    return {
      ...m,
      acceptanceRate: rate(m!.offersAccepted, m!.offersIssued),
      receivedByMonth: await monthly(
        tx,
        sql`SELECT date_trunc('month', created_at) AS m, count(*) AS v FROM application_submissions WHERE institution_org_id = ${org}::uuid AND status <> 'WITHDRAWN' GROUP BY 1`,
      ),
    };
  }
}

/** Commissions and invoices owed to Tasheel by this payer. */
function billingColumns(org: string) {
  return sql`
    (SELECT coalesce(sum(amount), 0) FROM commissions WHERE organization_id = ${org}::uuid AND status = 'ACCRUED')::text AS "commissionsAccrued",
    (SELECT coalesce(sum(total), 0) FROM invoices WHERE organization_id = ${org}::uuid AND kind = 'INVOICE' AND status = 'ISSUED')::text AS "invoicesDue"`;
}

async function rows(tx: TenantTx, query: ReturnType<typeof sql>): Promise<Row[]> {
  return (await tx.$queryRaw(query)) as Row[];
}

/** Last six months including the current one; months without activity are zero. */
async function monthly(tx: TenantTx, inner: ReturnType<typeof sql>): Promise<Series> {
  const data = (await tx.$queryRaw(sql`
    SELECT to_char(g.month, 'YYYY-MM') AS month, coalesce(d.v, 0)::text AS value
    FROM generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') AS g(month)
    LEFT JOIN (${inner}) AS d ON d.m = g.month
    ORDER BY g.month`)) as Series;
  return data;
}

const rate = (num: unknown, den: unknown) =>
  Number(den) > 0 ? Math.round((Number(num) * 1000) / Number(den)) / 10 : null;

@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('reports/overview')
  @TenantScoped()
  overview(@CurrentTenant() t: TenantInfo) {
    return this.reports.overview(t);
  }

  @Get('admin/reports')
  @RequirePermissions('admin.kpi.read')
  platform(@CurrentTenant() t: TenantInfo) {
    return this.reports.platform(t);
  }
}

@Module({ controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
