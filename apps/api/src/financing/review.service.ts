import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { TenantTx } from '@tasheel/db';
import {
  computeInstallment,
  computeTotalCost,
  formatMoney,
  fromCentimes,
  toCentimes,
  type Locale,
} from '@tasheel/shared';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service';
import { nextReference } from '../common/references';
import type { RequestMeta, TenantInfo } from '../common/request-context';
import { Notifier } from '../mail/notifier';
import { PrismaService } from '../prisma/prisma.service';
import { offerStatus } from './applications.service';
import type { OfferDto } from './financing.dto';

const REVIEWABLE = ['SENT', 'UNDER_REVIEW', 'INFO_REQUESTED', 'OFFER_MADE'];
const NOT_FOUND = { code: 'NOT_FOUND', message: 'Application not found.' };

interface SubmissionRow {
  id: string;
  organizationId: string; // business
  applicationId: string;
  institutionOrgId: string;
  status: string;
  application: { reference: string; status: string; financedAmount: unknown };
}

/**
 * Institution side: applications received, review, information requests, decline and offers.
 * Offer terms (rate or margin, fees, residual value) are the institution's; the installment and
 * total cost are computed from them so every party sees the same figures. An offer is a
 * proposal subject to the institution's final decision and contract.
 */
@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifier: Notifier,
  ) {}

  inbox(tenant: TenantInfo, status?: string) {
    return this.prisma.forTenant(tenant, async (tx) => {
      const rows = (await tx.applicationSubmission.findMany({
        where: { institutionOrgId: tenant.organizationId, ...(status ? { status } : {}) },
        include: {
          application: {
            select: {
              reference: true,
              status: true,
              equipmentAmount: true,
              downPayment: true,
              financedAmount: true,
              durationMonths: true,
              categoryCode: true,
              businessSnapshot: true,
              equipmentSnapshot: true,
              submittedAt: true,
            },
          },
          product: { select: { id: true, name: true, productType: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      })) as Array<Record<string, unknown>>;
      return rows;
    });
  }

  /** Opening a newly received application marks it under review (recorded in the timeline). */
  async detail(tenant: TenantInfo, submissionId: string) {
    return this.prisma.forTenant(tenant, async (tx) => {
      const s = await this.received(tx, tenant, submissionId);
      if (s.status === 'SENT') {
        const { count } = await tx.applicationSubmission.updateMany({
          where: { id: s.id, status: 'SENT' },
          data: { status: 'UNDER_REVIEW' },
        });
        if (count === 1) await this.event(tx, tenant, s, 'VIEWED');
      }
      const full = (await tx.applicationSubmission.findUnique({
        where: { id: submissionId },
        include: {
          application: {
            include: {
              documents: {
                include: {
                  document: {
                    select: {
                      id: true,
                      typeCode: true,
                      title: true,
                      fileName: true,
                      mimeType: true,
                      sizeBytes: true,
                      scanStatus: true,
                      reviewStatus: true,
                      expiresOn: true,
                      createdAt: true,
                    },
                  },
                },
              },
            },
          },
          product: true,
          events: { orderBy: { createdAt: 'asc' } },
          offers: { orderBy: { createdAt: 'desc' } },
        },
      })) as Record<string, unknown> & { offers: Array<{ status: string; validUntil: Date }> };
      return { ...full, offers: full.offers.map((o) => ({ ...o, status: offerStatus(o) })) };
    });
  }

  async requestInfo(tenant: TenantInfo, submissionId: string, note: string, meta: RequestMeta) {
    const s = await this.transition(
      tenant,
      submissionId,
      ['SENT', 'UNDER_REVIEW'],
      'INFO_REQUESTED',
      'INFO_REQUESTED',
      note,
      meta,
      'submission.info_requested',
    );
    const institution = await this.institutionName(tenant);
    void this.notifier.notifyOrg(
      s.organizationId,
      'application.manage',
      'email.infoRequested',
      () => ({ reference: s.application.reference, institution, note }),
      `/app/financing/${s.applicationId}`,
    );
    return { id: submissionId, status: 'INFO_REQUESTED' };
  }

  async decline(tenant: TenantInfo, submissionId: string, reason: string, meta: RequestMeta) {
    const s = await this.transition(
      tenant,
      submissionId,
      REVIEWABLE,
      'DECLINED',
      'DECLINED',
      reason,
      meta,
      'submission.declined',
      async (tx) => {
        await tx.offer.updateMany({
          where: { submissionId, status: 'ISSUED' },
          data: { status: 'WITHDRAWN', decidedAt: new Date() },
        });
        await tx.applicationSubmission.update({
          where: { id: submissionId },
          data: { declineReason: reason },
        });
      },
    );
    const institution = await this.institutionName(tenant);
    void this.notifier.notifyOrg(
      s.organizationId,
      'application.manage',
      'email.applicationDeclined',
      () => ({ reference: s.application.reference, institution, reason }),
      `/app/financing/${s.applicationId}`,
    );
    return { id: submissionId, status: 'DECLINED' };
  }

  /** Issues an offer; a new offer replaces (withdraws) the institution's previous open one. */
  async issueOffer(tenant: TenantInfo, submissionId: string, dto: OfferDto, meta: RequestMeta) {
    const validUntil = new Date(`${dto.validUntil}T00:00:00Z`);
    if (
      Number.isNaN(validUntil.getTime()) ||
      validUntil < new Date(new Date().toISOString().slice(0, 10))
    ) {
      throw new BadRequestException({
        code: 'INVALID_VALIDITY',
        message: 'The validity date must be today or later.',
      });
    }
    let schedule: ReturnType<typeof computeInstallment>;
    try {
      schedule = computeInstallment({
        financedAmount: dto.financedAmount,
        ratePct: dto.ratePct,
        durationMonths: dto.durationMonths,
        residualValue: dto.residualValue,
      });
    } catch (err) {
      throw new BadRequestException({
        code: 'INVALID_TERMS',
        message: err instanceof Error ? err.message : 'Invalid terms.',
      });
    }
    const totalCost = computeTotalCost({
      downPayment: dto.downPayment,
      totalInstallments: schedule.totalInstallments,
      fees: dto.feesAmount,
      residualValue: dto.residualValue,
    });

    const res = await this.prisma.forTenant(tenant, async (tx) => {
      const s = await this.received(tx, tenant, submissionId);
      if (!REVIEWABLE.includes(s.status) || s.application.status !== 'SUBMITTED') {
        throw new ConflictException({
          code: 'SUBMISSION_CLOSED',
          message: 'This application is no longer open.',
        });
      }
      if (
        dto.productId &&
        !(await tx.financingProduct.findFirst({
          where: { id: dto.productId, organizationId: tenant.organizationId },
          select: { id: true },
        }))
      ) {
        throw new BadRequestException({ code: 'UNKNOWN_PRODUCT', message: 'Unknown product.' });
      }
      await tx.offer.updateMany({
        where: { submissionId, organizationId: tenant.organizationId, status: 'ISSUED' },
        data: { status: 'WITHDRAWN', decidedAt: new Date() },
      });
      const id = uuidv7();
      const reference = await nextReference(tx, 'OF');
      await tx.offer.create({
        data: {
          id,
          reference,
          organizationId: tenant.organizationId,
          submissionId,
          applicationId: s.applicationId,
          businessOrgId: s.organizationId,
          productId: dto.productId ?? null,
          financedAmount: fromCentimes(toCentimes(dto.financedAmount)),
          downPayment: fromCentimes(toCentimes(dto.downPayment)),
          durationMonths: dto.durationMonths,
          ratePct: dto.ratePct,
          residualValue: fromCentimes(toCentimes(dto.residualValue)),
          feesAmount: fromCentimes(toCentimes(dto.feesAmount)),
          installmentAmount: schedule.installment,
          totalCost,
          validUntil,
          conditions: dto.conditions || null,
          issuedById: tenant.userId,
        },
      });
      await tx.applicationSubmission.update({
        where: { id: submissionId },
        data: { status: 'OFFER_MADE' },
      });
      await this.event(tx, tenant, s, 'OFFER_MADE');
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'offer.issued',
        entityType: 'Offer',
        entityId: id,
        diff: {
          reference,
          application: s.application.reference,
          financedAmount: dto.financedAmount,
          ratePct: dto.ratePct,
          durationMonths: dto.durationMonths,
          installment: schedule.installment,
        },
        meta,
      });
      return { id, reference, s };
    });

    const institution = await this.institutionName(tenant);
    void this.notifier.notifyOrg(
      res.s.organizationId,
      'application.manage',
      'email.offerReceived',
      (locale: Locale) => ({
        reference: res.s.application.reference,
        institution,
        installment: formatMoney(schedule.installment, locale),
        duration: dto.durationMonths,
      }),
      `/app/financing/${res.s.applicationId}`,
    );
    return {
      id: res.id,
      reference: res.reference,
      installment: schedule.installment,
      totalInstallments: schedule.totalInstallments,
      totalCost,
    };
  }

  async withdrawOffer(tenant: TenantInfo, offerId: string, meta: RequestMeta) {
    return this.prisma.forTenant(tenant, async (tx) => {
      const offer = (await tx.offer.findFirst({
        where: { id: offerId, organizationId: tenant.organizationId },
        select: { submissionId: true, status: true },
      })) as { submissionId: string; status: string } | null;
      if (!offer) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Offer not found.' });
      const { count } = await tx.offer.updateMany({
        where: { id: offerId, status: 'ISSUED' },
        data: { status: 'WITHDRAWN', decidedAt: new Date() },
      });
      if (count !== 1)
        throw new ConflictException({
          code: 'OFFER_NOT_OPEN',
          message: 'Only an open offer can be withdrawn.',
        });
      const s = await this.received(tx, tenant, offer.submissionId);
      await tx.applicationSubmission.updateMany({
        where: { id: s.id, status: 'OFFER_MADE' },
        data: { status: 'UNDER_REVIEW' },
      });
      await this.event(tx, tenant, s, 'OFFER_WITHDRAWN');
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'offer.withdrawn',
        entityType: 'Offer',
        entityId: offerId,
        meta,
      });
      return { id: offerId, status: 'WITHDRAWN' };
    });
  }

  // ---------------------------------------------------------------------------

  private async received(
    tx: TenantTx,
    tenant: TenantInfo,
    submissionId: string,
  ): Promise<SubmissionRow> {
    const s = (await tx.applicationSubmission.findFirst({
      where: { id: submissionId, institutionOrgId: tenant.organizationId },
      include: { application: { select: { reference: true, status: true, financedAmount: true } } },
    })) as SubmissionRow | null;
    if (!s || s.status === 'WITHDRAWN') throw new NotFoundException(NOT_FOUND);
    return s;
  }

  private event(tx: TenantTx, tenant: TenantInfo, s: SubmissionRow, kind: string, note?: string) {
    return tx.submissionEvent.create({
      data: {
        id: uuidv7(),
        organizationId: tenant.organizationId,
        submissionId: s.id,
        businessOrgId: s.organizationId,
        institutionOrgId: tenant.organizationId,
        kind,
        note: note ?? null,
        actorUserId: tenant.userId,
      },
    });
  }

  private async transition(
    tenant: TenantInfo,
    submissionId: string,
    from: string[],
    to: string,
    kind: string,
    note: string,
    meta: RequestMeta,
    action: string,
    extra?: (tx: TenantTx) => Promise<void>,
  ): Promise<SubmissionRow> {
    return this.prisma.forTenant(tenant, async (tx) => {
      const s = await this.received(tx, tenant, submissionId);
      if (s.application.status !== 'SUBMITTED')
        throw new ConflictException({
          code: 'SUBMISSION_CLOSED',
          message: 'This application is no longer open.',
        });
      const { count } = await tx.applicationSubmission.updateMany({
        where: { id: submissionId, status: { in: from } },
        data: { status: to },
      });
      if (count !== 1)
        throw new ConflictException({
          code: 'INVALID_TRANSITION',
          message: `This action is not possible while the application is ${s.status.toLowerCase().replace('_', ' ')}.`,
        });
      if (extra) await extra(tx);
      await this.event(tx, tenant, s, kind, note);
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action,
        entityType: 'ApplicationSubmission',
        entityId: submissionId,
        diff: { note },
        meta,
      });
      return s;
    });
  }

  private async institutionName(tenant: TenantInfo): Promise<string> {
    const org = (await this.prisma.forTenant(tenant, (tx) =>
      tx.organization.findUnique({
        where: { id: tenant.organizationId },
        select: { legalName: true, tradeName: true },
      }),
    )) as { legalName: string; tradeName: string | null } | null;
    return org?.tradeName || org?.legalName || '';
  }
}
