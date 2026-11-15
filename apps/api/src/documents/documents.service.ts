import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { TenantTx } from '@tasheel/db';
import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta, TenantInfo } from '../common/request-context';
import { Notifier } from '../mail/notifier';
import { detectType, DOCUMENT_MAX_BYTES, safeFileName } from '../marketplace/files';
import { PrismaService } from '../prisma/prisma.service';
import { Scanner } from '../storage/scanner';
import { Storage, type StoredObject } from '../storage/storage';

export interface UploadInput {
  typeCode: string;
  title?: string;
  expiresOn?: string; // YYYY-MM-DD
  replacesId?: string;
}

export interface DocumentTypeRow {
  code: string;
  name: Record<string, string>;
  ownerTypes: string[];
  requiredForVerification: string[];
  requiredForApplication: boolean;
  hasExpiry: boolean;
  isActive: boolean;
  sortOrder: number;
}

const NOT_FOUND = { code: 'NOT_FOUND', message: 'Document not found.' };
const DOC_SELECT = {
  id: true,
  typeCode: true,
  title: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  scanStatus: true,
  reviewStatus: true,
  reviewReason: true,
  reviewedAt: true,
  expiresOn: true,
  createdAt: true,
} as const;

/** Who may download a document reachable under RLS: its owner, a reviewing institution, Tasheel staff. */
const DOWNLOAD_PERMISSIONS = ['document.manage', 'application.review', 'admin.document.review'];

/**
 * Organization document vault. Files are type-checked from their bytes, scanned for viruses
 * before storage (infected files are refused and never stored), kept private and served only
 * through the API under RLS. Documents are never deleted: a new upload supersedes the old one.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: Storage,
    private readonly scanner: Scanner,
    private readonly notifier: Notifier,
  ) {}

  async types(tenant: TenantInfo) {
    const rows = (await this.prisma.forTenant(tenant, (tx) =>
      tx.documentType.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    )) as DocumentTypeRow[];
    return rows.filter((t) => t.ownerTypes.includes(tenant.organizationType));
  }

  /** Current documents (latest version of each upload) and the checklists that apply to the organization. */
  async vault(tenant: TenantInfo) {
    const [types, documents] = await Promise.all([
      this.types(tenant),
      this.prisma.forTenant(tenant, (tx) =>
        tx.document.findMany({
          where: { organizationId: tenant.organizationId, supersededById: null },
          select: DOC_SELECT,
          orderBy: { createdAt: 'desc' },
        }),
      ) as Promise<Array<{ typeCode: string; reviewStatus: string; expiresOn: Date | null }>>,
    ]);
    return { types, documents, checklist: checklist(types, documents, tenant.organizationType) };
  }

  async upload(
    tenant: TenantInfo,
    file: Express.Multer.File | undefined,
    input: UploadInput,
    meta: RequestMeta,
  ) {
    if (!file)
      throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'A file is required.' });
    if (file.size > DOCUMENT_MAX_BYTES) {
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: 'Documents are limited to 15 MB.',
      });
    }
    const detected = detectType(file.buffer);
    if (!detected || detected.mime === 'image/webp') {
      throw new BadRequestException({
        code: 'FILE_TYPE_NOT_ALLOWED',
        message: 'Documents must be PDF, JPEG or PNG files.',
      });
    }
    const type = (await this.types(tenant)).find((t) => t.code === input.typeCode);
    if (!type)
      throw new BadRequestException({
        code: 'DOCUMENT_TYPE_NOT_ALLOWED',
        message: 'This document type is not available for your organization.',
      });
    let expiresOn: Date | null = null;
    if (input.expiresOn) {
      expiresOn = new Date(`${input.expiresOn}T00:00:00Z`);
      if (
        Number.isNaN(expiresOn.getTime()) ||
        expiresOn < new Date(new Date().toISOString().slice(0, 10))
      ) {
        throw new BadRequestException({
          code: 'DOCUMENT_EXPIRED',
          message: 'The expiry date has already passed.',
        });
      }
    }

    const verdict = await this.scanner.scan(file.buffer);
    if (verdict.status === 'INFECTED') {
      await this.prisma.forTenant(tenant, (tx) =>
        this.audit.record(tx, {
          organizationId: tenant.organizationId,
          actorUserId: tenant.userId,
          action: 'document.infected_rejected',
          entityType: 'Document',
          entityId: null,
          diff: { signature: verdict.signature, fileName: safeFileName(file.originalname) },
          meta,
        }),
      );
      throw new UnprocessableEntityException({
        code: 'FILE_INFECTED',
        message: 'The antivirus flagged this file. It was not stored.',
      });
    }

    const id = uuidv7();
    const storageKey = `org/${tenant.organizationId}/documents/${id}.${detected.ext}`;
    await this.storage.put(storageKey, file.buffer, detected.mime);
    const fileName = safeFileName(file.originalname || `document.${detected.ext}`);
    await this.prisma.forTenant(tenant, async (tx) => {
      if (input.replacesId) {
        const old = (await tx.document.findFirst({
          where: {
            id: input.replacesId,
            organizationId: tenant.organizationId,
            supersededById: null,
          },
          select: { typeCode: true },
        })) as { typeCode: string } | null;
        if (!old || old.typeCode !== input.typeCode) {
          throw new BadRequestException({
            code: 'INVALID_REPLACEMENT',
            message: 'Only a current document of the same type can be replaced.',
          });
        }
      }
      await tx.document.create({
        data: {
          id,
          organizationId: tenant.organizationId,
          typeCode: input.typeCode,
          title: input.title?.trim() || fileName,
          fileName,
          mimeType: detected.mime,
          sizeBytes: file.size,
          sha256: createHash('sha256').update(file.buffer).digest('hex'),
          storageKey,
          scanStatus: verdict.status,
          expiresOn,
          uploadedById: tenant.userId,
        },
      });
      if (input.replacesId)
        await tx.document.update({ where: { id: input.replacesId }, data: { supersededById: id } });
      await this.audit.record(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: input.replacesId ? 'document.replaced' : 'document.uploaded',
        entityType: 'Document',
        entityId: id,
        diff: {
          typeCode: input.typeCode,
          scan: verdict.status,
          replaces: input.replacesId ?? null,
        },
        meta,
      });
    });
    return { id, scanStatus: verdict.status };
  }

  /** Streams a document reachable under RLS. Downloads by another organization are audited. */
  async download(
    tenant: TenantInfo,
    id: string,
    meta: RequestMeta,
  ): Promise<StoredObject & { fileName: string }> {
    if (!DOWNLOAD_PERMISSIONS.some((p) => tenant.permissions.has(p))) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'You do not have permission for this action.',
      });
    }
    const doc = await this.prisma.forTenant(tenant, async (tx) => {
      const row = (await tx.document.findUnique({
        where: { id },
        select: {
          organizationId: true,
          storageKey: true,
          mimeType: true,
          fileName: true,
          scanStatus: true,
        },
      })) as {
        organizationId: string;
        storageKey: string;
        mimeType: string;
        fileName: string;
        scanStatus: string;
      } | null;
      if (!row) throw new NotFoundException(NOT_FOUND);
      if (row.organizationId !== tenant.organizationId) {
        // Recorded in the downloader's own log (audit rows are written in one's own name).
        await this.audit.record(tx, {
          organizationId: tenant.organizationId,
          actorUserId: tenant.userId,
          action: 'document.downloaded',
          entityType: 'Document',
          entityId: id,
          diff: { owner: row.organizationId },
          meta,
        });
      }
      return row;
    });
    if (doc.scanStatus === 'PENDING' || doc.scanStatus === 'INFECTED') {
      throw new UnprocessableEntityException({
        code: 'FILE_NOT_AVAILABLE',
        message: 'This file is not available.',
      });
    }
    const object = await this.storage.get(doc.storageKey);
    return { ...object, contentType: doc.mimeType, fileName: doc.fileName };
  }

  // --- Tasheel staff: verification papers ---------------------------------------

  async forOrganization(tenant: TenantInfo, organizationId: string) {
    return this.prisma.forTenant(tenant, async (tx) => {
      const org = (await tx.organization.findUnique({
        where: { id: organizationId },
        select: { type: true },
      })) as { type: string } | null;
      if (!org)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Organization not found.' });
      const types = (
        (await tx.documentType.findMany({
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        })) as DocumentTypeRow[]
      ).filter((t) => t.ownerTypes.includes(org.type));
      const documents = (await tx.document.findMany({
        where: { organizationId, supersededById: null },
        select: DOC_SELECT,
        orderBy: { createdAt: 'desc' },
      })) as Array<{ typeCode: string; reviewStatus: string; expiresOn: Date | null }>;
      return { types, documents, checklist: checklist(types, documents, org.type) };
    });
  }

  async review(
    tenant: TenantInfo,
    id: string,
    decision: 'accept' | 'reject',
    reason: string | undefined,
    meta: RequestMeta,
  ) {
    if (decision === 'reject' && !reason?.trim()) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: 'A reason is required to reject a document.',
      });
    }
    const result = await this.prisma.forTenant(tenant, async (tx: TenantTx) => {
      const doc = (await tx.document.findUnique({
        where: { id },
        select: {
          organizationId: true,
          title: true,
          supersededById: true,
          type: { select: { name: true } },
        },
      })) as {
        organizationId: string;
        title: string;
        supersededById: string | null;
        type: { name: Record<string, string> };
      } | null;
      if (!doc) throw new NotFoundException(NOT_FOUND);
      if (doc.supersededById)
        throw new BadRequestException({
          code: 'DOCUMENT_SUPERSEDED',
          message: 'A newer version of this document exists.',
        });
      await tx.document.update({
        where: { id },
        data: {
          reviewStatus: decision === 'accept' ? 'ACCEPTED' : 'REJECTED',
          reviewReason: decision === 'reject' ? reason!.trim() : null,
          reviewedById: tenant.userId,
          reviewedAt: new Date(),
        },
      });
      await this.audit.record(tx, {
        organizationId: doc.organizationId,
        actorUserId: tenant.userId,
        action: decision === 'accept' ? 'document.accepted' : 'document.rejected',
        entityType: 'Document',
        entityId: id,
        diff: { reason: reason?.trim() ?? null },
        meta,
      });
      return doc;
    });
    if (decision === 'reject') {
      void this.notifier.notifyOrg(
        result.organizationId,
        'document.manage',
        'email.documentRejected',
        (locale) => ({
          document: result.type.name[locale] ?? result.type.name.fr ?? result.title,
          reason: reason!.trim(),
        }),
        '/app/documents',
      );
    }
    return { id, reviewStatus: decision === 'accept' ? 'ACCEPTED' : 'REJECTED' };
  }
}

/** Per required type: the current document's state (missing, pending, accepted, rejected, expired). */
export function checklist(
  types: DocumentTypeRow[],
  documents: Array<{ typeCode: string; reviewStatus: string; expiresOn: Date | null }>,
  orgType: string,
) {
  const today = new Date(new Date().toISOString().slice(0, 10));
  const state = (code: string) => {
    const doc = documents.find((d) => d.typeCode === code);
    if (!doc) return 'MISSING';
    if (doc.expiresOn && new Date(doc.expiresOn) < today) return 'EXPIRED';
    return doc.reviewStatus;
  };
  return {
    verification: types
      .filter((t) => t.requiredForVerification.includes(orgType))
      .map((t) => ({ typeCode: t.code, state: state(t.code) })),
    application: types
      .filter((t) => t.requiredForApplication)
      .map((t) => ({ typeCode: t.code, state: state(t.code) })),
  };
}
