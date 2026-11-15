import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { asJson, type TenantTx } from '@tasheel/db';
import {
  computeInstallment,
  formatMoney,
  fromCentimes,
  matchProduct,
  toCentimes,
  type Locale,
  type SubmissionStatus,
} from '@tasheel/shared';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service';
import { nextReference } from '../common/references';
import type { RequestMeta, TenantInfo } from '../common/request-context';
import { Notifier } from '../mail/notifier';
import { PrismaService } from '../prisma/prisma.service';
import type { ApplicationDto, ApplicationUpdateDto, CompanyProfileDto } from './financing.dto';

const OPEN_SUBMISSION: SubmissionStatus[] = [
  'SENT',
  'UNDER_REVIEW',
  'INFO_REQUESTED',
  'OFFER_MADE',
];
const today = () => new Date(new Date().toISOString().slice(0, 10));
/** An offer past its validity date is presented and treated as EXPIRED. */
export const offerStatus = (o: { status: string; validUntil: Date }) =>
  o.status === 'ISSUED' && new Date(o.validUntil) < today() ? 'EXPIRED' : o.status;

interface AppRow {
  id: string;
  organizationId: string;
  reference: string;
  status: string;
  equipmentAmount: unknown;
  downPayment: unknown;
  financedAmount: unknown;
  durationMonths: number;
  categoryCode: string;
  preferredType: 'LEASING' | 'IJARA' | null;
  companyProfile: CompanyProfileDto;
}

interface ProductRow {
  id: string;
  organizationId: string;
  name: Record<string, string>;
  productType: 'LEASING' | 'IJARA';
  minAmount: unknown;
  maxAmount: unknown;
  minDurationMonths: number;
  maxDurationMonths: number;
  minDownPaymentPct: unknown;
  categoryCodes: string[];
  wilayaCodes: string[];
  minYearsInBusiness: number;
  indicativeRateMin: unknown;
  indicativeRateMax: unknown;
  requiredDocumentTypes: string[];
}

const dec = (v: unknown) => String(v);
const NOT_FOUND = { code: 'NOT_FOUND', message: 'Application not found.' };

/**
 * Business side of financing: an application built from an accepted quotation, indicative
 * matching against institutions' published criteria, submission to the institutions the
 * business chooses, replies to information requests and the decision on offers.
 * Tasheel never decides: institutions make proposals; the business chooses.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifier: Notifier,
  ) {}

  /** Accepted quotations that do not have an application yet. */
  eligibleQuotations(tenant: TenantInfo) {
    return this.prisma.forTenant(tenant, async (tx) => {
      const used = (
        (await tx.financingApplication.findMany({
          where: { organizationId: tenant.organizationId },
          select: { quotationId: true },
        })) as Array<{ quotationId: string }>
      ).map((a) => a.quotationId);
      return tx.quotation.findMany({
        where: { businessOrgId: tenant.organizationId, status: 'ACCEPTED', id: { notIn: used } },
        select: {
          id: true,
          reference: true,
          total: true,
          currency: true,
          createdAt: true,
          listing: {
            select: { reference: true, title: true, organization: { select: { legalName: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  }

  async create(tenant: TenantInfo, dto: ApplicationDto, meta: RequestMeta) {
    return this.prisma.forTenant(tenant, async (tx) => {
      const q = (await tx.quotation.findFirst({
        where: { id: dto.quotationId, businessOrgId: tenant.organizationId, status: 'ACCEPTED' },
        select: {
          id: true,
          reference: true,
          total: true,
          organizationId: true,
          listing: {
            select: {
              id: true,
              reference: true,
              title: true,
              brand: true,
              model: true,
              year: true,
              condition: true,
              category: { select: { code: true } },
              organization: { select: { legalName: true } },
            },
          },
        },
      })) as {
        id: string;
        reference: string;
        total: unknown;
        organizationId: string;
        listing: {
          id: string;
          reference: string;
          title: object;
          brand: string | null;
          model: string | null;
          year: number | null;
          condition: string;
          category: { code: string };
          organization: { legalName: string } | null;
        };
      } | null;
      if (!q)
        throw new NotFoundException({
          code: 'QUOTATION_NOT_ACCEPTED',
          message: 'Choose one of your accepted quotations.',
        });
      if (
        await tx.financingApplication.findFirst({
          where: { quotationId: q.id },
          select: { id: true },
        })
      ) {
        throw new ConflictException({
          code: 'APPLICATION_EXISTS',
          message: 'An application already exists for this quotation.',
        });
      }
      const amounts = this.amounts(dec(q.total), dto.downPayment);
      const id = uuidv7();
      const reference = await nextReference(tx, 'FA');
      await tx.financingApplication.create({
        data: {
          id,
          reference,
          organizationId: tenant.organizationId,
          quotationId: q.id,
          listingId: q.listing.id,
          supplierOrgId: q.organizationId,
          categoryCode: q.listing.category.code,
          ...amounts,
          durationMonths: dto.durationMonths,
          preferredType: dto.preferredType ?? null,
          purpose: dto.purpose || null,
          companyProfile: asJson(dto.companyProfile),
          equipmentSnapshot: {
            quotationReference: q.reference,
            listingReference: q.listing.reference,
            title: q.listing.title,
            brand: q.listing.brand,
            model: q.listing.model,
            year: q.listing.year,
            condition: q.listing.condition,
            supplierName: q.listing.organization?.legalName ?? null,
          },
          createdById: tenant.userId,
        },
      });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'application.created',
        entityType: 'FinancingApplication',
        entityId: id,
        diff: { reference, quotation: q.reference, ...amounts, durationMonths: dto.durationMonths },
        meta,
      });
      return { id, reference };
    });
  }

  async update(tenant: TenantInfo, id: string, dto: ApplicationUpdateDto, meta: RequestMeta) {
    return this.prisma.forTenant(tenant, async (tx) => {
      const app = await this.own(tx, tenant, id);
      if (app.status !== 'DRAFT')
        throw new ConflictException({
          code: 'APPLICATION_LOCKED',
          message: 'A submitted application can no longer be edited.',
        });
      const amounts = this.amounts(dec(app.equipmentAmount), dto.downPayment);
      await tx.financingApplication.update({
        where: { id },
        data: {
          ...amounts,
          durationMonths: dto.durationMonths,
          preferredType: dto.preferredType ?? null,
          purpose: dto.purpose || null,
          companyProfile: asJson(dto.companyProfile),
        },
      });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'application.updated',
        entityType: 'FinancingApplication',
        entityId: id,
        diff: { ...amounts, durationMonths: dto.durationMonths },
        meta,
      });
      return { id };
    });
  }

  list(tenant: TenantInfo) {
    return this.prisma.forTenant(tenant, async (tx) => {
      const rows = (await tx.financingApplication.findMany({
        where: { organizationId: tenant.organizationId },
        include: {
          submissions: { select: { id: true, status: true, institutionOrgId: true } },
          offers: { select: { id: true, status: true, validUntil: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      })) as Array<{ offers: Array<{ status: string; validUntil: Date }> }>;
      return rows.map((r) => ({
        ...r,
        offers: r.offers.map((o) => ({ ...o, status: offerStatus(o) })),
      }));
    });
  }

  async get(tenant: TenantInfo, id: string) {
    return this.prisma.forTenant(tenant, async (tx) => {
      const app = (await tx.financingApplication.findFirst({
        where: { id, organizationId: tenant.organizationId },
        include: {
          documents: {
            include: {
              document: {
                select: {
                  id: true,
                  typeCode: true,
                  title: true,
                  fileName: true,
                  reviewStatus: true,
                  scanStatus: true,
                  expiresOn: true,
                },
              },
            },
          },
          submissions: {
            include: {
              product: { select: { id: true, name: true, productType: true } },
              events: { orderBy: { createdAt: 'asc' } },
            },
            orderBy: { createdAt: 'asc' },
          },
          offers: { orderBy: { createdAt: 'desc' } },
        },
      })) as
        | (Record<string, unknown> & {
            submissions: Array<{ institutionOrgId: string }>;
            offers: Array<{ status: string; validUntil: Date }>;
          })
        | null;
      if (!app) throw new NotFoundException(NOT_FOUND);
      const names = await this.institutionNames(
        tx,
        app.submissions.map((s) => s.institutionOrgId),
      );
      return {
        ...app,
        submissions: app.submissions.map((s) => ({
          ...s,
          institutionName: names.get(s.institutionOrgId) ?? '',
        })),
        offers: app.offers.map((o) => ({ ...o, status: offerStatus(o) })),
      };
    });
  }

  async attach(tenant: TenantInfo, id: string, documentIds: string[], meta: RequestMeta) {
    return this.prisma.forTenant(tenant, async (tx) => {
      const app = await this.own(tx, tenant, id);
      if (!['DRAFT', 'SUBMITTED'].includes(app.status))
        throw new ConflictException({
          code: 'APPLICATION_CLOSED',
          message: 'This application is closed.',
        });
      await this.attachDocuments(tx, tenant, id, documentIds);
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'application.documents_attached',
        entityType: 'FinancingApplication',
        entityId: id,
        diff: { documentIds },
        meta,
      });
      return { id };
    });
  }

  async detach(tenant: TenantInfo, id: string, documentId: string, meta: RequestMeta) {
    return this.prisma.forTenant(tenant, async (tx) => {
      const app = await this.own(tx, tenant, id);
      if (app.status !== 'DRAFT')
        throw new ConflictException({
          code: 'APPLICATION_LOCKED',
          message: 'Documents can be removed only before submission.',
        });
      await tx.applicationDocument.deleteMany({ where: { applicationId: id, documentId } });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'application.document_detached',
        entityType: 'FinancingApplication',
        entityId: id,
        diff: { documentId },
        meta,
      });
      return { id };
    });
  }

  /**
   * Active products of verified institutions, each with an indicative fit and installment
   * range computed from the institution's own published criteria and rates.
   */
  async matches(tenant: TenantInfo, id: string) {
    return this.prisma.forTenant(tenant, async (tx) =>
      this.scoreProducts(tx, tenant, await this.own(tx, tenant, id)),
    );
  }

  private async scoreProducts(tx: TenantTx, tenant: TenantInfo, app: AppRow) {
    const org = (await tx.organization.findUnique({
      where: { id: tenant.organizationId },
      select: { wilayaCode: true },
    })) as { wilayaCode: string | null };
    const products = (await tx.financingProduct.findMany({
      where: { isActive: true, deletedAt: null },
    })) as ProductRow[];
    const names = await this.institutionNames(
      tx,
      products.map((p) => p.organizationId),
    );
    return products
      .filter((p) => names.has(p.organizationId))
      .map((p) => {
        const match = matchProduct(
          {
            productType: p.productType,
            minAmount: dec(p.minAmount),
            maxAmount: dec(p.maxAmount),
            minDurationMonths: p.minDurationMonths,
            maxDurationMonths: p.maxDurationMonths,
            minDownPaymentPct: dec(p.minDownPaymentPct),
            categoryCodes: p.categoryCodes,
            wilayaCodes: p.wilayaCodes,
            minYearsInBusiness: p.minYearsInBusiness,
          },
          {
            equipmentAmount: dec(app.equipmentAmount),
            downPayment: dec(app.downPayment),
            financedAmount: dec(app.financedAmount),
            durationMonths: app.durationMonths,
            categoryCode: app.categoryCode,
            wilayaCode: org.wilayaCode,
            yearsInBusiness: app.companyProfile?.yearsInBusiness ?? null,
            preferredType: app.preferredType,
          },
        );
        const installment = (rate: unknown) =>
          computeInstallment({
            financedAmount: dec(app.financedAmount),
            ratePct:
              Number(rate)
                .toFixed(4)
                .replace(/\.?0+$/, '') || '0',
            durationMonths: app.durationMonths,
          }).installment;
        return {
          productId: p.id,
          institutionOrgId: p.organizationId,
          institutionName: names.get(p.organizationId),
          name: p.name,
          productType: p.productType,
          indicativeRateMin: p.indicativeRateMin,
          indicativeRateMax: p.indicativeRateMax,
          requiredDocumentTypes: p.requiredDocumentTypes,
          indicative: true,
          score: match.score,
          checks: match.checks,
          installmentRange: {
            min: installment(p.indicativeRateMin),
            max: installment(p.indicativeRateMax),
          },
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  /** Sends the application to the institutions of the chosen products (one product per institution). */
  async submit(tenant: TenantInfo, id: string, productIds: string[], meta: RequestMeta) {
    if (tenant.organizationStatus !== 'VERIFIED') {
      throw new ForbiddenException({
        code: 'ORGANIZATION_NOT_VERIFIED',
        message: 'Your organization must be verified before applying for financing.',
      });
    }
    if (!productIds.length)
      throw new BadRequestException({
        code: 'NO_INSTITUTION',
        message: 'Choose at least one institution.',
      });
    const sent = await this.prisma.forTenant(tenant, async (tx) => {
      const app = await this.own(tx, tenant, id);
      if (!['DRAFT', 'SUBMITTED'].includes(app.status))
        throw new ConflictException({
          code: 'APPLICATION_CLOSED',
          message: 'This application is closed.',
        });
      const products = (await tx.financingProduct.findMany({
        where: { id: { in: productIds }, isActive: true, deletedAt: null },
      })) as ProductRow[];
      if (products.length !== productIds.length)
        throw new BadRequestException({
          code: 'PRODUCT_UNAVAILABLE',
          message: 'One of the chosen products is no longer available.',
        });
      const institutions = products.map((p) => p.organizationId);
      if (new Set(institutions).size !== institutions.length)
        throw new BadRequestException({
          code: 'ONE_PER_INSTITUTION',
          message: 'Choose one product per institution.',
        });
      const already = (await tx.applicationSubmission.findMany({
        where: { applicationId: id, institutionOrgId: { in: institutions } },
        select: { institutionOrgId: true },
      })) as Array<{ institutionOrgId: string }>;
      if (already.length)
        throw new ConflictException({
          code: 'ALREADY_SUBMITTED',
          message: 'The application was already sent to one of these institutions.',
        });

      // Required documents: those the platform requires for any application, plus each product's.
      const globalTypes = (
        (await tx.documentType.findMany({
          where: { isActive: true, requiredForApplication: true },
          select: { code: true },
        })) as Array<{ code: string }>
      ).map((t) => t.code);
      const attached = (await tx.applicationDocument.findMany({
        where: { applicationId: id },
        select: { document: { select: { typeCode: true, supersededById: true, expiresOn: true } } },
      })) as Array<{
        document: { typeCode: string; supersededById: string | null; expiresOn: Date | null };
      }>;
      const valid = new Set(
        attached
          .filter(
            (a) =>
              !a.document.supersededById &&
              !(a.document.expiresOn && new Date(a.document.expiresOn) < today()),
          )
          .map((a) => a.document.typeCode),
      );
      const required = new Set([
        ...globalTypes,
        ...products.flatMap((p) => p.requiredDocumentTypes),
      ]);
      const missing = [...required].filter((c) => !valid.has(c));
      if (missing.length)
        throw new BadRequestException({
          code: 'MISSING_DOCUMENTS',
          message: 'Some required documents are missing or expired.',
          missing,
        });

      const org = (await tx.organization.findUnique({
        where: { id: tenant.organizationId },
        select: {
          legalName: true,
          tradeName: true,
          rcNumber: true,
          nif: true,
          nis: true,
          wilayaCode: true,
          address: true,
        },
      })) as { legalName: string } & Record<string, string | null>;
      const scores = await this.scoreProducts(tx, tenant, app);
      for (const p of products) {
        const submissionId = uuidv7();
        await tx.applicationSubmission.create({
          data: {
            id: submissionId,
            organizationId: tenant.organizationId,
            applicationId: id,
            institutionOrgId: p.organizationId,
            productId: p.id,
            matchScore: scores.find((s) => s.productId === p.id)?.score ?? null,
          },
        });
        await tx.submissionEvent.create({
          data: {
            id: uuidv7(),
            organizationId: tenant.organizationId,
            submissionId,
            businessOrgId: tenant.organizationId,
            institutionOrgId: p.organizationId,
            kind: 'SUBMITTED',
            actorUserId: tenant.userId,
          },
        });
      }
      await tx.financingApplication.update({
        where: { id },
        data: {
          status: 'SUBMITTED',
          submittedAt: app.status === 'DRAFT' ? new Date() : undefined,
          businessSnapshot: org,
        },
      });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'application.submitted',
        entityType: 'FinancingApplication',
        entityId: id,
        diff: { institutions, productIds },
        meta,
      });
      return { app, institutions, businessName: org.legalName };
    });

    for (const inst of sent.institutions) {
      void this.notifier.notifyOrg(
        inst,
        'application.review',
        'email.applicationReceived',
        (locale: Locale) => ({
          reference: sent.app.reference,
          business: sent.businessName,
          amount: formatMoney(dec(sent.app.financedAmount), locale),
        }),
        '/app/financing/inbox',
      );
    }
    return { id, status: 'SUBMITTED', submittedTo: sent.institutions.length };
  }

  async replyToInfoRequest(
    tenant: TenantInfo,
    submissionId: string,
    note: string,
    documentIds: string[],
    meta: RequestMeta,
  ) {
    const res = await this.prisma.forTenant(tenant, async (tx) => {
      const s = (await tx.applicationSubmission.findFirst({
        where: { id: submissionId, organizationId: tenant.organizationId },
        include: { application: { select: { reference: true, businessSnapshot: true } } },
      })) as {
        id: string;
        applicationId: string;
        institutionOrgId: string;
        status: string;
        application: { reference: string; businessSnapshot: { legalName?: string } };
      } | null;
      if (!s) throw new NotFoundException(NOT_FOUND);
      if (s.status !== 'INFO_REQUESTED')
        throw new ConflictException({
          code: 'NO_INFO_REQUESTED',
          message: 'No information was requested.',
        });
      if (documentIds.length) await this.attachDocuments(tx, tenant, s.applicationId, documentIds);
      const { count } = await tx.applicationSubmission.updateMany({
        where: { id: submissionId, status: 'INFO_REQUESTED' },
        data: { status: 'UNDER_REVIEW' },
      });
      if (count !== 1)
        throw new ConflictException({
          code: 'CONCURRENT_CHANGE',
          message: 'The request changed meanwhile. Reload.',
        });
      await tx.submissionEvent.create({
        data: {
          id: uuidv7(),
          organizationId: tenant.organizationId,
          submissionId,
          businessOrgId: tenant.organizationId,
          institutionOrgId: s.institutionOrgId,
          kind: 'INFO_PROVIDED',
          note,
          documentId: documentIds[0] ?? null,
          actorUserId: tenant.userId,
        },
      });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'application.info_provided',
        entityType: 'ApplicationSubmission',
        entityId: submissionId,
        diff: { documentIds },
        meta,
      });
      return s;
    });
    void this.notifier.notifyOrg(
      res.institutionOrgId,
      'application.review',
      'email.infoProvided',
      () => ({
        reference: res.application.reference,
        business: res.application.businessSnapshot.legalName ?? '',
      }),
      `/app/financing/inbox/${submissionId}`,
    );
    return { id: submissionId, status: 'UNDER_REVIEW' };
  }

  /** Accepting one offer closes the competition: other open offers are declined, other submissions closed. */
  async decideOffer(
    tenant: TenantInfo,
    offerId: string,
    decision: 'accept' | 'decline',
    meta: RequestMeta,
  ) {
    const res = await this.prisma.forTenant(tenant, async (tx) => {
      const offer = (await tx.offer.findFirst({
        where: { id: offerId, businessOrgId: tenant.organizationId },
        include: {
          application: {
            select: { id: true, reference: true, status: true, businessSnapshot: true },
          },
        },
      })) as {
        id: string;
        organizationId: string;
        submissionId: string;
        reference: string;
        status: string;
        validUntil: Date;
        application: {
          id: string;
          reference: string;
          status: string;
          businessSnapshot: { legalName?: string };
        };
      } | null;
      if (!offer) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Offer not found.' });
      if (offerStatus(offer) !== 'ISSUED')
        throw new ConflictException({
          code: 'OFFER_NOT_OPEN',
          message: `This offer is ${offerStatus(offer).toLowerCase()}.`,
        });
      if (offer.application.status !== 'SUBMITTED')
        throw new ConflictException({
          code: 'APPLICATION_CLOSED',
          message: 'This application is closed.',
        });

      const status = decision === 'accept' ? 'ACCEPTED' : 'DECLINED';
      const { count } = await tx.offer.updateMany({
        where: { id: offerId, status: 'ISSUED' },
        data: { status, decidedAt: new Date() },
      });
      if (count !== 1)
        throw new ConflictException({
          code: 'CONCURRENT_CHANGE',
          message: 'The offer changed meanwhile. Reload.',
        });
      const event = async (submissionId: string, institutionOrgId: string, kind: string) =>
        tx.submissionEvent.create({
          data: {
            id: uuidv7(),
            organizationId: tenant.organizationId,
            submissionId,
            businessOrgId: tenant.organizationId,
            institutionOrgId,
            kind,
            actorUserId: tenant.userId,
          },
        });
      await event(
        offer.submissionId,
        offer.organizationId,
        decision === 'accept' ? 'OFFER_ACCEPTED' : 'OFFER_DECLINED',
      );

      let others: Array<{ organizationId: string }> = [];
      if (decision === 'accept') {
        others = (await tx.offer.findMany({
          where: { applicationId: offer.application.id, status: 'ISSUED', id: { not: offerId } },
          select: { organizationId: true, submissionId: true },
        })) as Array<{ organizationId: string; submissionId: string }>;
        await tx.offer.updateMany({
          where: { applicationId: offer.application.id, status: 'ISSUED', id: { not: offerId } },
          data: { status: 'DECLINED', decidedAt: new Date() },
        });
        const open = (await tx.applicationSubmission.findMany({
          where: {
            applicationId: offer.application.id,
            status: { in: OPEN_SUBMISSION },
            id: { not: offer.submissionId },
          },
          select: { id: true, institutionOrgId: true },
        })) as Array<{ id: string; institutionOrgId: string }>;
        for (const s of open) await event(s.id, s.institutionOrgId, 'CLOSED');
        await tx.applicationSubmission.updateMany({
          where: { id: { in: open.map((s) => s.id) } },
          data: { status: 'CLOSED' },
        });
        await tx.financingApplication.update({
          where: { id: offer.application.id },
          data: { status: 'OFFER_ACCEPTED', decidedAt: new Date() },
        });
      }
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: `offer.${status.toLowerCase()}`,
        entityType: 'Offer',
        entityId: offerId,
        diff: { reference: offer.reference, application: offer.application.reference },
        meta,
      });
      return { offer, others };
    });

    const vars = () => ({
      reference: res.offer.application.reference,
      business: res.offer.application.businessSnapshot.legalName ?? '',
    });
    void this.notifier.notifyOrg(
      res.offer.organizationId,
      'application.review',
      decision === 'accept' ? 'email.offerAccepted' : 'email.offerDeclined',
      vars,
      '/app/financing/inbox',
    );
    for (const o of res.others)
      void this.notifier.notifyOrg(
        o.organizationId,
        'application.review',
        'email.offerDeclined',
        vars,
        '/app/financing/inbox',
      );
    return { id: offerId, status: decision === 'accept' ? 'ACCEPTED' : 'DECLINED' };
  }

  async withdraw(tenant: TenantInfo, id: string, meta: RequestMeta) {
    const res = await this.prisma.forTenant(tenant, async (tx) => {
      const app = await this.own(tx, tenant, id);
      if (!['DRAFT', 'SUBMITTED'].includes(app.status))
        throw new ConflictException({
          code: 'APPLICATION_CLOSED',
          message: 'This application is already closed.',
        });
      const open = (await tx.applicationSubmission.findMany({
        where: { applicationId: id, status: { in: OPEN_SUBMISSION } },
        select: { id: true, institutionOrgId: true },
      })) as Array<{ id: string; institutionOrgId: string }>;
      for (const s of open) {
        await tx.submissionEvent.create({
          data: {
            id: uuidv7(),
            organizationId: tenant.organizationId,
            submissionId: s.id,
            businessOrgId: tenant.organizationId,
            institutionOrgId: s.institutionOrgId,
            kind: 'WITHDRAWN',
            actorUserId: tenant.userId,
          },
        });
      }
      await tx.offer.updateMany({
        where: { applicationId: id, status: 'ISSUED' },
        data: { status: 'DECLINED', decidedAt: new Date() },
      });
      await tx.applicationSubmission.updateMany({
        where: { id: { in: open.map((s) => s.id) } },
        data: { status: 'WITHDRAWN' },
      });
      await tx.financingApplication.update({
        where: { id },
        data: { status: 'WITHDRAWN', decidedAt: new Date() },
      });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'application.withdrawn',
        entityType: 'FinancingApplication',
        entityId: id,
        meta,
      });
      const org = (await tx.organization.findUnique({
        where: { id: tenant.organizationId },
        select: { legalName: true },
      })) as { legalName: string };
      return {
        app,
        institutions: open.map((s) => s.institutionOrgId),
        businessName: org.legalName,
      };
    });
    for (const inst of res.institutions) {
      void this.notifier.notifyOrg(
        inst,
        'application.review',
        'email.applicationWithdrawn',
        () => ({ reference: res.app.reference, business: res.businessName }),
        '/app/financing/inbox',
      );
    }
    return { id, status: 'WITHDRAWN' };
  }

  // ---------------------------------------------------------------------------

  private amounts(equipmentAmount: string, downPayment: string) {
    const equipment = toCentimes(equipmentAmount);
    const down = toCentimes(downPayment);
    if (down < 0n || down >= equipment) {
      throw new BadRequestException({
        code: 'INVALID_DOWN_PAYMENT',
        message: 'The down payment must be below the equipment amount.',
      });
    }
    return {
      equipmentAmount: fromCentimes(equipment),
      downPayment: fromCentimes(down),
      financedAmount: fromCentimes(equipment - down),
    };
  }

  private async own(tx: TenantTx, tenant: TenantInfo, id: string): Promise<AppRow> {
    const app = (await tx.financingApplication.findFirst({
      where: { id, organizationId: tenant.organizationId },
    })) as AppRow | null;
    if (!app) throw new NotFoundException(NOT_FOUND);
    return app;
  }

  /** Only the organization's own current documents (not superseded, not infected) can be attached. */
  private async attachDocuments(
    tx: TenantTx,
    tenant: TenantInfo,
    applicationId: string,
    documentIds: string[],
  ) {
    if (!documentIds.length) return;
    const docs = (await tx.document.findMany({
      where: {
        id: { in: documentIds },
        organizationId: tenant.organizationId,
        supersededById: null,
        scanStatus: { in: ['CLEAN', 'NOT_SCANNED'] },
      },
      select: { id: true },
    })) as Array<{ id: string }>;
    if (docs.length !== documentIds.length)
      throw new BadRequestException({
        code: 'INVALID_DOCUMENT',
        message: 'One of the documents cannot be attached.',
      });
    const existing = new Set(
      (
        (await tx.applicationDocument.findMany({
          where: { applicationId },
          select: { documentId: true },
        })) as Array<{ documentId: string }>
      ).map((d) => d.documentId),
    );
    for (const d of docs.filter((d) => !existing.has(d.id))) {
      await tx.applicationDocument.create({
        data: {
          id: uuidv7(),
          organizationId: tenant.organizationId,
          applicationId,
          documentId: d.id,
        },
      });
    }
  }

  /** Names of verified institutions (public profiles). Unverified ones are absent from the map. */
  private async institutionNames(tx: TenantTx, ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const orgs = (await tx.organization.findMany({
      where: { id: { in: [...new Set(ids)] }, type: 'FINANCIAL_INSTITUTION', status: 'VERIFIED' },
      select: { id: true, legalName: true, tradeName: true },
    })) as Array<{ id: string; legalName: string; tradeName: string | null }>;
    return new Map(orgs.map((o) => [o.id, o.tradeName || o.legalName]));
  }
}
