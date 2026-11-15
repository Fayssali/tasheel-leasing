import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { toCentimes } from '@tasheel/shared';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta, TenantInfo } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import type { ProductDto } from './financing.dto';

/** Financing products configured by each institution: its own criteria and indicative rates. */
@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenant: TenantInfo) {
    return this.prisma.forTenant(tenant, (tx) =>
      tx.financingProduct.findMany({
        where: { organizationId: tenant.organizationId, deletedAt: null },
        include: { _count: { select: { submissions: true, offers: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async create(tenant: TenantInfo, dto: ProductDto, meta: RequestMeta) {
    this.validate(dto);
    return this.prisma.forTenant(tenant, async (tx) => {
      await this.checkCodes(tx, dto);
      const id = uuidv7();
      await tx.financingProduct.create({
        data: {
          id,
          organizationId: tenant.organizationId,
          createdById: tenant.userId,
          ...this.data(dto),
        },
      });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'product.created',
        entityType: 'FinancingProduct',
        entityId: id,
        diff: this.data(dto) as unknown as Record<string, unknown>,
        meta,
      });
      return { id };
    });
  }

  async update(tenant: TenantInfo, id: string, dto: ProductDto, meta: RequestMeta) {
    this.validate(dto);
    return this.prisma.forTenant(tenant, async (tx) => {
      const before = await tx.financingProduct.findFirst({
        where: { id, organizationId: tenant.organizationId, deletedAt: null },
      });
      if (!before)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found.' });
      await this.checkCodes(tx, dto);
      await tx.financingProduct.update({ where: { id }, data: this.data(dto) });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'product.updated',
        entityType: 'FinancingProduct',
        entityId: id,
        diff: { after: this.data(dto) as unknown as Record<string, unknown> },
        meta,
      });
      return { id };
    });
  }

  private validate(dto: ProductDto) {
    if (!dto.name.fr && !dto.name.ar)
      throw new BadRequestException({
        code: 'NAME_REQUIRED',
        message: 'Give the product a name in French or Arabic.',
      });
    if (toCentimes(dto.maxAmount) < toCentimes(dto.minAmount))
      throw new BadRequestException({
        code: 'INVALID_RANGE',
        message: 'The maximum amount is below the minimum.',
      });
    if (dto.maxDurationMonths < dto.minDurationMonths)
      throw new BadRequestException({
        code: 'INVALID_RANGE',
        message: 'The maximum duration is below the minimum.',
      });
    if (Number(dto.indicativeRateMax) < Number(dto.indicativeRateMin))
      throw new BadRequestException({
        code: 'INVALID_RANGE',
        message: 'The maximum rate is below the minimum.',
      });
  }

  /** Category and document codes must exist in the reference tables. */
  private async checkCodes(
    tx: {
      equipmentCategory: { count: (a: object) => Promise<number> };
      documentType: { count: (a: object) => Promise<number> };
    },
    dto: ProductDto,
  ) {
    if (
      dto.categoryCodes.length &&
      (await tx.equipmentCategory.count({ where: { code: { in: dto.categoryCodes } } })) !==
        dto.categoryCodes.length
    ) {
      throw new BadRequestException({
        code: 'UNKNOWN_CATEGORY',
        message: 'Unknown equipment category.',
      });
    }
    if (
      dto.requiredDocumentTypes.length &&
      (await tx.documentType.count({ where: { code: { in: dto.requiredDocumentTypes } } })) !==
        dto.requiredDocumentTypes.length
    ) {
      throw new BadRequestException({
        code: 'UNKNOWN_DOCUMENT_TYPE',
        message: 'Unknown document type.',
      });
    }
  }

  private data(dto: ProductDto) {
    return {
      name: dto.name,
      description: dto.description ?? {},
      productType: dto.productType,
      minAmount: dto.minAmount,
      maxAmount: dto.maxAmount,
      minDurationMonths: dto.minDurationMonths,
      maxDurationMonths: dto.maxDurationMonths,
      minDownPaymentPct: dto.minDownPaymentPct,
      categoryCodes: dto.categoryCodes,
      wilayaCodes: dto.wilayaCodes,
      minYearsInBusiness: dto.minYearsInBusiness,
      indicativeRateMin: dto.indicativeRateMin,
      indicativeRateMax: dto.indicativeRateMax,
      requiredDocumentTypes: dto.requiredDocumentTypes,
      isActive: dto.isActive,
    };
  }
}
