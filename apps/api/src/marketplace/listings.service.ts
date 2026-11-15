import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { asJson, type TenantTx } from '@tasheel/db';
import type { ListingStatus, SpecField } from '@tasheel/shared';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service';
import { nextReference } from '../common/references';
import type { RequestMeta, TenantInfo } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { Scanner } from '../storage/scanner';
import { Storage } from '../storage/storage';
import {
  assertImage,
  assertPdf,
  MAX_DOCUMENTS_PER_LISTING,
  MAX_IMAGES_PER_LISTING,
  safeFileName,
} from './files';
import type { ListingInputDto } from './marketplace.dto';
import { SettingsService } from './settings.service';
import { validateSpecs } from './specs';

type Status = 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'ARCHIVED' | 'REJECTED';

interface ListingRow {
  id: string;
  organizationId: string;
  reference: string;
  status: Status;
  title: { fr?: string; ar?: string };
  price: unknown;
  priceOnRequest: boolean;
  deletedAt: Date | null;
  images?: Array<{ id: string }>;
}

const NOT_FOUND = { code: 'NOT_FOUND', message: 'Listing not found.' };
const LISTING_INCLUDE = {
  category: { select: { id: true, code: true, name: true, specSchema: true } },
  images: {
    orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
    select: { id: true, mimeType: true, sizeBytes: true, sortOrder: true },
  },
  documents: {
    orderBy: { createdAt: 'asc' as const },
    select: { id: true, kind: true, fileName: true, sizeBytes: true, createdAt: true },
  },
};

/** Supplier side of the catalogue (permission listing.manage) plus Tasheel moderation. */
@Injectable()
export class ListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: Storage,
    private readonly settings: SettingsService,
    @Optional() private readonly scanner?: Scanner,
  ) {}

  list(tenant: TenantInfo, status?: ListingStatus) {
    return this.prisma.forTenant(tenant, (tx) =>
      tx.equipmentListing.findMany({
        where: {
          organizationId: tenant.organizationId,
          deletedAt: null,
          ...(status ? { status } : {}),
        },
        include: {
          category: { select: { code: true, name: true } },
          images: {
            orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
            take: 1,
            select: { id: true },
          },
          _count: { select: { quotationRequests: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
    );
  }

  async get(tenant: TenantInfo, id: string) {
    const listing = await this.prisma.forTenant(tenant, (tx) =>
      tx.equipmentListing.findFirst({
        where: { id, organizationId: tenant.organizationId, deletedAt: null },
        include: LISTING_INCLUDE,
      }),
    );
    if (!listing) throw new NotFoundException(NOT_FOUND);
    return listing;
  }

  async create(tenant: TenantInfo, input: ListingInputDto, meta: RequestMeta) {
    return this.prisma.forTenant(tenant, async (tx) => {
      const data = await this.prepare(tx, input);
      const reference = await nextReference(tx, 'EQ');
      const id = uuidv7();
      await tx.equipmentListing.create({
        data: {
          id,
          organizationId: tenant.organizationId,
          reference,
          createdById: tenant.userId,
          status: 'DRAFT',
          ...data,
        },
      });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'listing.created',
        entityType: 'EquipmentListing',
        entityId: id,
        diff: { reference },
        meta,
      });
      return tx.equipmentListing.findUnique({ where: { id }, include: LISTING_INCLUDE });
    });
  }

  /**
   * Editable in every status except ARCHIVED. A rejected listing goes back to DRAFT when
   * edited, so the supplier fixes it and submits again.
   */
  async update(tenant: TenantInfo, id: string, input: ListingInputDto, meta: RequestMeta) {
    return this.prisma.forTenant(tenant, async (tx) => {
      const listing = await this.owned(tx, tenant, id);
      if (listing.status === 'ARCHIVED') {
        throw new ConflictException({
          code: 'LISTING_ARCHIVED',
          message: 'Restore the listing before editing it.',
        });
      }
      const data = await this.prepare(tx, input);
      await tx.equipmentListing.update({
        where: { id },
        data: {
          ...data,
          ...(listing.status === 'REJECTED'
            ? { status: 'DRAFT' as const, statusReason: null }
            : {}),
        },
      });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'listing.updated',
        entityType: 'EquipmentListing',
        entityId: id,
        meta,
      });
      return tx.equipmentListing.findUnique({ where: { id }, include: LISTING_INCLUDE });
    });
  }

  /**
   * Publishes the listing, or sends it for review when moderation is on. The supplier must be
   * verified, and the listing complete enough to be useful to a buyer.
   */
  async submit(tenant: TenantInfo, id: string, meta: RequestMeta) {
    if (tenant.organizationStatus !== 'VERIFIED') {
      throw new ForbiddenException({
        code: 'ORGANIZATION_NOT_VERIFIED',
        message: 'Your organization must be verified before publishing.',
      });
    }
    return this.prisma.forTenant(tenant, async (tx) => {
      const listing = (await tx.equipmentListing.findFirst({
        where: { id, organizationId: tenant.organizationId, deletedAt: null },
        include: { images: { select: { id: true } } },
      })) as ListingRow | null;
      if (!listing) throw new NotFoundException(NOT_FOUND);
      if (!['DRAFT', 'REJECTED'].includes(listing.status)) {
        throw new ConflictException({
          code: 'INVALID_TRANSITION',
          message: `Cannot submit a listing whose status is ${listing.status}.`,
        });
      }
      const missing: string[] = [];
      if (!listing.images?.length) missing.push('image');
      if (listing.price === null && !listing.priceOnRequest) missing.push('price');
      if (missing.length) {
        throw new BadRequestException({
          code: 'LISTING_INCOMPLETE',
          message: `Missing before publishing: ${missing.join(', ')}.`,
          missing,
        });
      }

      const moderated = await this.settings.moderationEnabled(tx);
      const status: Status = moderated ? 'PENDING_REVIEW' : 'PUBLISHED';
      await tx.equipmentListing.update({
        where: { id },
        data: {
          status,
          statusReason: null,
          ...(status === 'PUBLISHED' ? { publishedAt: new Date() } : {}),
        },
      });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: moderated ? 'listing.submitted' : 'listing.published',
        entityType: 'EquipmentListing',
        entityId: id,
        meta,
      });
      return { id, status };
    });
  }

  async archive(tenant: TenantInfo, id: string, meta: RequestMeta) {
    return this.setOwnStatus(
      tenant,
      id,
      ['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED'],
      'ARCHIVED',
      'listing.archived',
      meta,
    );
  }

  async restore(tenant: TenantInfo, id: string, meta: RequestMeta) {
    return this.setOwnStatus(tenant, id, ['ARCHIVED'], 'DRAFT', 'listing.restored', meta);
  }

  // --- Images and documents --------------------------------------------------

  async addImage(
    tenant: TenantInfo,
    listingId: string,
    file: Express.Multer.File | undefined,
    meta: RequestMeta,
  ) {
    const type = assertImage(file);
    return this.prisma.forTenant(tenant, async (tx) => {
      await this.owned(tx, tenant, listingId);
      const count = await tx.equipmentImage.count({ where: { listingId } });
      if (count >= MAX_IMAGES_PER_LISTING) {
        throw new BadRequestException({
          code: 'TOO_MANY_FILES',
          message: `A listing can have up to ${MAX_IMAGES_PER_LISTING} images.`,
        });
      }
      const id = uuidv7();
      const storageKey = `org/${tenant.organizationId}/listings/${listingId}/images/${id}.${type.ext}`;
      await this.storage.put(storageKey, file!.buffer, type.mime);
      await tx.equipmentImage.create({
        data: {
          id,
          organizationId: tenant.organizationId,
          listingId,
          storageKey,
          mimeType: type.mime,
          sizeBytes: file!.size,
          sortOrder: count,
        },
      });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'listing.image_added',
        entityType: 'EquipmentListing',
        entityId: listingId,
        meta,
      });
      return { id, mimeType: type.mime, sizeBytes: file!.size, sortOrder: count };
    });
  }

  async removeImage(tenant: TenantInfo, listingId: string, imageId: string, meta: RequestMeta) {
    const key = await this.prisma.forTenant(tenant, async (tx) => {
      const image = (await tx.equipmentImage.findFirst({
        where: { id: imageId, listingId, organizationId: tenant.organizationId },
      })) as { storageKey: string } | null;
      if (!image) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Image not found.' });
      const listing = await this.owned(tx, tenant, listingId);
      if (
        listing.status === 'PUBLISHED' &&
        (await tx.equipmentImage.count({ where: { listingId } })) <= 1
      ) {
        throw new ConflictException({
          code: 'LAST_IMAGE',
          message: 'A published listing must keep at least one image.',
        });
      }
      await tx.equipmentImage.delete({ where: { id: imageId } });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'listing.image_removed',
        entityType: 'EquipmentListing',
        entityId: listingId,
        meta,
      });
      return image.storageKey;
    });
    // Object deleted after the row: a failure here leaves an orphan file, never a broken link.
    await this.storage.delete(key).catch(() => undefined);
  }

  async reorderImages(tenant: TenantInfo, listingId: string, imageIds: string[]) {
    return this.prisma.forTenant(tenant, async (tx) => {
      await this.owned(tx, tenant, listingId);
      const existing = (await tx.equipmentImage.findMany({
        where: { listingId },
        select: { id: true },
      })) as Array<{ id: string }>;
      const known = new Set(existing.map((i) => i.id));
      if (imageIds.length !== known.size || imageIds.some((i) => !known.has(i))) {
        throw new BadRequestException({
          code: 'INVALID_ORDER',
          message: 'Provide every image of the listing exactly once.',
        });
      }
      for (const [sortOrder, id] of imageIds.entries()) {
        await tx.equipmentImage.update({ where: { id }, data: { sortOrder } });
      }
      return { ok: true };
    });
  }

  async addDocument(
    tenant: TenantInfo,
    listingId: string,
    file: Express.Multer.File | undefined,
    kind: 'BROCHURE' | 'SPEC_SHEET' | 'OTHER',
    meta: RequestMeta,
  ) {
    const type = assertPdf(file);
    // Public PDFs go through the same antivirus scan as vault documents.
    const verdict = (await this.scanner?.scan(file!.buffer)) ?? { status: 'NOT_SCANNED' as const };
    if (verdict.status === 'INFECTED') {
      throw new UnprocessableEntityException({
        code: 'FILE_INFECTED',
        message: 'The antivirus flagged this file. It was not stored.',
      });
    }
    return this.prisma.forTenant(tenant, async (tx) => {
      await this.owned(tx, tenant, listingId);
      if (
        (await tx.equipmentDocument.count({ where: { listingId } })) >= MAX_DOCUMENTS_PER_LISTING
      ) {
        throw new BadRequestException({
          code: 'TOO_MANY_FILES',
          message: `A listing can have up to ${MAX_DOCUMENTS_PER_LISTING} documents.`,
        });
      }
      const id = uuidv7();
      const storageKey = `org/${tenant.organizationId}/listings/${listingId}/documents/${id}.${type.ext}`;
      await this.storage.put(storageKey, file!.buffer, type.mime);
      const fileName = safeFileName(file!.originalname);
      await tx.equipmentDocument.create({
        data: {
          id,
          organizationId: tenant.organizationId,
          listingId,
          kind,
          fileName,
          storageKey,
          mimeType: type.mime,
          sizeBytes: file!.size,
        },
      });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'listing.document_added',
        entityType: 'EquipmentListing',
        entityId: listingId,
        diff: { fileName, kind },
        meta,
      });
      return { id, kind, fileName, sizeBytes: file!.size };
    });
  }

  async removeDocument(
    tenant: TenantInfo,
    listingId: string,
    documentId: string,
    meta: RequestMeta,
  ) {
    const key = await this.prisma.forTenant(tenant, async (tx) => {
      const doc = (await tx.equipmentDocument.findFirst({
        where: { id: documentId, listingId, organizationId: tenant.organizationId },
      })) as { storageKey: string } | null;
      if (!doc) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Document not found.' });
      await tx.equipmentDocument.delete({ where: { id: documentId } });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'listing.document_removed',
        entityType: 'EquipmentListing',
        entityId: listingId,
        meta,
      });
      return doc.storageKey;
    });
    await this.storage.delete(key).catch(() => undefined);
  }

  // --- Moderation (Tasheel) ---------------------------------------------------

  moderationQueue(tenant: TenantInfo, status: ListingStatus = 'PENDING_REVIEW') {
    return this.prisma.forTenant(tenant, (tx) =>
      tx.equipmentListing.findMany({
        where: { status, deletedAt: null },
        include: {
          category: { select: { code: true, name: true } },
          organization: { select: { id: true, legalName: true } },
          images: {
            orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
            take: 1,
            select: { id: true },
          },
        },
        orderBy: { updatedAt: 'asc' },
        take: 100,
      }),
    );
  }

  async moderate(
    tenant: TenantInfo,
    id: string,
    action: 'approve' | 'reject' | 'unpublish',
    reason: string | undefined,
    meta: RequestMeta,
  ) {
    const allowed: Record<typeof action, Status[]> = {
      approve: ['PENDING_REVIEW'],
      reject: ['PENDING_REVIEW'],
      unpublish: ['PUBLISHED'],
    };
    const next: Record<typeof action, Status> = {
      approve: 'PUBLISHED',
      reject: 'REJECTED',
      unpublish: 'ARCHIVED',
    };
    if (action !== 'approve' && !reason?.trim()) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: 'A reason is required for this action.',
      });
    }
    return this.prisma.forTenant(tenant, async (tx) => {
      const listing = (await tx.equipmentListing.findUnique({
        where: { id },
      })) as ListingRow | null;
      if (!listing || listing.deletedAt) throw new NotFoundException(NOT_FOUND);
      const { count } = await tx.equipmentListing.updateMany({
        where: { id, status: { in: allowed[action] } },
        data: {
          status: next[action],
          statusReason: action === 'approve' ? null : reason!.trim(),
          ...(action === 'approve' ? { publishedAt: new Date() } : {}),
        },
      });
      if (count !== 1) {
        throw new ConflictException({
          code: 'INVALID_TRANSITION',
          message: `Cannot ${action} a listing whose status is ${listing.status}.`,
        });
      }
      await this.audit.record(tx, {
        organizationId: listing.organizationId,
        actorUserId: tenant.userId,
        action: `listing.moderation_${action}`,
        entityType: 'EquipmentListing',
        entityId: id,
        diff: { before: listing.status, after: next[action], reason },
        meta,
      });
      return { id, status: next[action] };
    });
  }

  // ---------------------------------------------------------------------------

  private async owned(tx: TenantTx, tenant: TenantInfo, id: string): Promise<ListingRow> {
    const listing = (await tx.equipmentListing.findFirst({
      where: { id, organizationId: tenant.organizationId, deletedAt: null },
    })) as ListingRow | null;
    if (!listing) throw new NotFoundException(NOT_FOUND);
    return listing;
  }

  private async setOwnStatus(
    tenant: TenantInfo,
    id: string,
    from: Status[],
    to: Status,
    action: string,
    meta: RequestMeta,
  ) {
    return this.prisma.forTenant(tenant, async (tx) => {
      const listing = await this.owned(tx, tenant, id);
      if (!from.includes(listing.status)) {
        throw new ConflictException({
          code: 'INVALID_TRANSITION',
          message: `Cannot change a listing whose status is ${listing.status}.`,
        });
      }
      await tx.equipmentListing.update({ where: { id }, data: { status: to } });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action,
        entityType: 'EquipmentListing',
        entityId: id,
        meta,
      });
      return { id, status: to };
    });
  }

  /** Validates category, title and specs; returns the columns to write. */
  private async prepare(tx: TenantTx, input: ListingInputDto) {
    const category = (await tx.equipmentCategory.findUnique({
      where: { id: input.categoryId },
    })) as {
      id: string;
      isActive: boolean;
      specSchema: SpecField[];
    } | null;
    if (!category || !category.isActive)
      throw new BadRequestException({ code: 'UNKNOWN_CATEGORY', message: 'Unknown category.' });
    if (!input.title.fr && !input.title.ar) {
      throw new BadRequestException({
        code: 'TITLE_REQUIRED',
        message: 'Provide a title in French or Arabic.',
      });
    }
    if (!input.priceOnRequest && !input.price) {
      throw new BadRequestException({
        code: 'PRICE_REQUIRED',
        message: 'Provide a price or choose "price on request".',
      });
    }
    return {
      categoryId: category.id,
      title: {
        ...(input.title.fr ? { fr: input.title.fr } : {}),
        ...(input.title.ar ? { ar: input.title.ar } : {}),
      },
      description: asJson(input.description ?? {}),
      brand: input.brand || null,
      model: input.model || null,
      year: input.year ?? null,
      condition: input.condition,
      price: input.priceOnRequest ? null : input.price!,
      priceOnRequest: input.priceOnRequest,
      priceIncludesVat: input.priceIncludesVat,
      availability: input.availability,
      leadTimeDays: input.leadTimeDays ?? null,
      deliveryWilayas: [...new Set(input.deliveryWilayas)].sort(),
      warrantyMonths: input.warrantyMonths ?? null,
      specs: asJson(validateSpecs(input.specs, category.specSchema)),
    };
  }
}
