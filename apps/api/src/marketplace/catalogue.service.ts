import { Injectable, NotFoundException } from '@nestjs/common';
import { sql, sqlJoin, type Sql, type TenantContext } from '@tasheel/db';
import { PrismaService } from '../prisma/prisma.service';
import { Storage, type StoredObject } from '../storage/storage';
import type { SearchQueryDto } from './marketplace.dto';
import { toPrefixTsQuery } from './specs';

/** Anonymous visitor context: RLS then shows only public rows (published listings, verified suppliers). */
const PUBLIC: TenantContext = { organizationId: null, userId: null };

export interface ListingCard {
  id: string;
  reference: string;
  title: { fr?: string; ar?: string };
  brand: string | null;
  model: string | null;
  year: number | null;
  condition: string;
  price: string | null;
  currency: string;
  priceOnRequest: boolean;
  priceIncludesVat: boolean;
  availability: string;
  publishedAt: string | null;
  categoryCode: string;
  categoryName: Record<string, string>;
  supplierId: string;
  supplierName: string;
  supplierWilaya: string | null;
  coverImageId: string | null;
}

/** Public marketplace: search, equipment pages, supplier pages, file delivery. */
@Injectable()
export class CatalogueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: Storage,
  ) {}

  async categories() {
    return this.prisma.forTenant(PUBLIC, async (tx) => {
      const [categories, counts] = await Promise.all([
        tx.equipmentCategory.findMany({
          where: { isActive: true },
          select: {
            id: true,
            code: true,
            name: true,
            parentId: true,
            specSchema: true,
            sortOrder: true,
          },
          orderBy: { sortOrder: 'asc' },
        }),
        tx.equipmentListing.groupBy({
          by: ['categoryId'],
          where: { status: 'PUBLISHED', deletedAt: null },
          _count: { _all: true },
        }),
      ]);
      const byId = new Map(
        (counts as Array<{ categoryId: string; _count: { _all: number } }>).map((c) => [
          c.categoryId,
          c._count._all,
        ]),
      );
      return (categories as Array<{ id: string }>).map((c) => ({
        ...c,
        listingCount: byId.get(c.id) ?? 0,
      }));
    });
  }

  /**
   * Full-text + filter search over published listings of verified suppliers. Raw SQL for the
   * tsvector match and rank; every value is a bound parameter (Prisma.sql), never concatenated.
   */
  async search(
    query: SearchQueryDto,
  ): Promise<{ items: ListingCard[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 24;
    const tsq = toPrefixTsQuery(query.q);

    const conds: Sql[] = [
      sql`l.status = 'PUBLISHED'`,
      sql`l.deleted_at IS NULL`,
      sql`o.status = 'VERIFIED'`,
      sql`o.deleted_at IS NULL`,
    ];
    if (tsq) conds.push(sql`l.search_vector @@ to_tsquery('simple', unaccent(${tsq}))`);
    if (query.category) {
      conds.push(sql`c.id IN (SELECT id FROM equipment_categories WHERE code = ${query.category}
        OR parent_id = (SELECT id FROM equipment_categories WHERE code = ${query.category}))`);
    }
    if (query.condition) conds.push(sql`l.condition = ${query.condition}::"EquipmentCondition"`);
    if (query.wilaya)
      conds.push(
        sql`(cardinality(l.delivery_wilayas) = 0 OR ${query.wilaya} = ANY(l.delivery_wilayas))`,
      );
    if (query.minPrice) conds.push(sql`l.price >= ${query.minPrice}::numeric`);
    if (query.maxPrice) conds.push(sql`l.price <= ${query.maxPrice}::numeric`);
    if (query.supplierId) conds.push(sql`l.organization_id = ${query.supplierId}::uuid`);

    const sort = query.sort ?? (tsq ? 'relevance' : 'newest');
    const order =
      sort === 'price_asc'
        ? sql`l.price ASC NULLS LAST, l.published_at DESC`
        : sort === 'price_desc'
          ? sql`l.price DESC NULLS LAST, l.published_at DESC`
          : sort === 'relevance' && tsq
            ? sql`ts_rank(l.search_vector, to_tsquery('simple', unaccent(${tsq}))) DESC, l.published_at DESC`
            : sql`l.published_at DESC NULLS LAST, l.id`;

    const rows = (await this.prisma.forTenant(
      PUBLIC,
      (tx) =>
        tx.$queryRaw`
        SELECT l.id, l.reference, l.title, l.brand, l.model, l.year, l.condition::text AS condition,
               l.price::text AS price, l.currency, l.price_on_request AS "priceOnRequest",
               l.price_includes_vat AS "priceIncludesVat", l.availability::text AS availability,
               l.published_at AS "publishedAt", c.code AS "categoryCode", c.name AS "categoryName",
               o.id AS "supplierId", o.legal_name AS "supplierName", o.wilaya_code AS "supplierWilaya",
               (SELECT i.id FROM equipment_images i WHERE i.listing_id = l.id ORDER BY i.sort_order, i.created_at LIMIT 1) AS "coverImageId",
               count(*) OVER() AS total
        FROM equipment_listings l
        JOIN organizations o ON o.id = l.organization_id
        JOIN equipment_categories c ON c.id = l.category_id
        WHERE ${sqlJoin(conds, ' AND ')}
        ORDER BY ${order}
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    )) as Array<ListingCard & { total: bigint }>;

    const total = rows.length ? Number(rows[0]!.total) : 0;
    return { items: rows.map(({ total: _t, ...card }) => card), total, page, pageSize };
  }

  /** Equipment page. Counts a view (published listings only, through a narrow DB function). */
  async detail(reference: string) {
    return this.prisma.forTenant(PUBLIC, async (tx) => {
      const listing = (await tx.equipmentListing.findFirst({
        where: {
          reference,
          status: 'PUBLISHED',
          deletedAt: null,
          organization: { status: 'VERIFIED' },
        },
        select: {
          id: true,
          reference: true,
          title: true,
          description: true,
          brand: true,
          model: true,
          year: true,
          condition: true,
          price: true,
          currency: true,
          priceOnRequest: true,
          priceIncludesVat: true,
          availability: true,
          leadTimeDays: true,
          deliveryWilayas: true,
          warrantyMonths: true,
          specs: true,
          publishedAt: true,
          viewCount: true,
          category: { select: { code: true, name: true, specSchema: true } },
          organization: {
            select: { id: true, legalName: true, tradeName: true, wilayaCode: true },
          },
          images: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true } },
          documents: {
            orderBy: { createdAt: 'asc' },
            select: { id: true, kind: true, fileName: true, sizeBytes: true },
          },
        },
      })) as ({ id: string } & Record<string, unknown>) | null;
      if (!listing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Listing not found.' });
      await tx.$executeRaw`SELECT app_count_listing_view(${listing.id}::uuid)`;
      return listing;
    });
  }

  async supplier(id: string) {
    const supplier = await this.prisma.forTenant(PUBLIC, (tx) =>
      tx.organization.findFirst({
        where: { id, type: 'SUPPLIER', status: 'VERIFIED', deletedAt: null },
        // Public profile only: never identifiers, contacts or members.
        select: { id: true, legalName: true, tradeName: true, wilayaCode: true, verifiedAt: true },
      }),
    );
    if (!supplier)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Supplier not found.' });
    return supplier;
  }

  /**
   * Streams an image or document. With ctx = PUBLIC only files of published listings are
   * reachable; a supplier's own context also reaches its drafts (editor previews).
   */
  async file(
    kind: 'image' | 'document',
    id: string,
    ctx: TenantContext = PUBLIC,
  ): Promise<StoredObject & { fileName?: string; isPublic: boolean }> {
    const row = (await this.prisma.forTenant(ctx, (tx) =>
      kind === 'image'
        ? tx.equipmentImage.findUnique({
            where: { id },
            select: { storageKey: true, mimeType: true, listing: { select: { status: true } } },
          })
        : tx.equipmentDocument.findUnique({
            where: { id },
            select: {
              storageKey: true,
              mimeType: true,
              fileName: true,
              listing: { select: { status: true } },
            },
          }),
    )) as {
      storageKey: string;
      mimeType: string;
      fileName?: string;
      listing: { status: string };
    } | null;
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'File not found.' });
    const object = await this.storage.get(row.storageKey);
    return {
      ...object,
      contentType: row.mimeType,
      fileName: row.fileName,
      isPublic: row.listing.status === 'PUBLISHED',
    };
  }
}
