import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { CurrentTenant, Public, RequirePermissions } from '../common/decorators';
import { requestMeta, type TenantInfo } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogueService } from './catalogue.service';
import { DOCUMENT_MAX_BYTES, IMAGE_MAX_BYTES } from './files';
import { ListingsService } from './listings.service';
import {
  DocumentKindDto,
  FavouriteDto,
  ListingInputDto,
  ListingStatusQueryDto,
  ReasonDto,
  ReorderDto,
  SearchQueryDto,
  SettingValueDto,
} from './marketplace.dto';
import { SettingsService } from './settings.service';

// ---------------------------------------------------------------------------
// Public marketplace — no account needed
// ---------------------------------------------------------------------------

@Public()
@Controller('marketplace')
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class MarketplaceController {
  constructor(private readonly catalogue: CatalogueService) {}

  @Get('categories')
  categories() {
    return this.catalogue.categories();
  }

  @Get('listings')
  search(@Query() query: SearchQueryDto) {
    return this.catalogue.search(query);
  }

  @Get('listings/:reference')
  detail(@Param('reference') reference: string) {
    if (!/^EQ-\d{4}-\d{6}$/.test(reference))
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Listing not found.' });
    return this.catalogue.detail(reference);
  }

  @Get('suppliers/:id')
  supplier(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalogue.supplier(id);
  }

  @Get('images/:id')
  async image(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.catalogue.file('image', id);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    file.body.pipe(res);
  }

  @Get('documents/:id')
  async document(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.catalogue.file('document', id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName ?? 'document.pdf')}`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    file.body.pipe(res);
  }
}

// ---------------------------------------------------------------------------
// Supplier catalogue
// ---------------------------------------------------------------------------

@Controller('supplier/listings')
export class SupplierListingsController {
  constructor(
    private readonly listings: ListingsService,
    private readonly catalogue: CatalogueService,
  ) {}

  @Get()
  @RequirePermissions('listing.manage')
  list(@CurrentTenant() t: TenantInfo, @Query() q: ListingStatusQueryDto) {
    return this.listings.list(t, q.status);
  }

  @Post()
  @RequirePermissions('listing.manage')
  create(@CurrentTenant() t: TenantInfo, @Body() dto: ListingInputDto, @Req() req: Request) {
    return this.listings.create(t, dto, requestMeta(req));
  }

  @Get(':id')
  @RequirePermissions('listing.manage')
  get(@CurrentTenant() t: TenantInfo, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.get(t, id);
  }

  @Put(':id')
  @RequirePermissions('listing.manage')
  update(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ListingInputDto,
    @Req() req: Request,
  ) {
    return this.listings.update(t, id, dto, requestMeta(req));
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions('listing.manage')
  submit(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.listings.submit(t, id, requestMeta(req));
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('listing.manage')
  archive(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.listings.archive(t, id, requestMeta(req));
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions('listing.manage')
  restore(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.listings.restore(t, id, requestMeta(req));
  }

  @Post(':id/images')
  @RequirePermissions('listing.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMAGE_MAX_BYTES, files: 1 } }))
  addImage(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.listings.addImage(t, id, file, requestMeta(req));
  }

  @Get(':id/images/:imageId')
  @RequirePermissions('listing.manage')
  async image(
    @CurrentTenant() t: TenantInfo,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Res() res: Response,
  ) {
    const file = await this.catalogue.file('image', imageId, t);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    file.body.pipe(res);
  }

  @Delete(':id/images/:imageId')
  @HttpCode(204)
  @RequirePermissions('listing.manage')
  async removeImage(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.listings.removeImage(t, id, imageId, requestMeta(req));
  }

  @Patch(':id/images/order')
  @RequirePermissions('listing.manage')
  reorder(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderDto,
  ) {
    return this.listings.reorderImages(t, id, dto.imageIds);
  }

  @Post(':id/documents')
  @RequirePermissions('listing.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: DOCUMENT_MAX_BYTES, files: 1 } }))
  addDocument(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: DocumentKindDto,
    @Req() req: Request,
  ) {
    return this.listings.addDocument(t, id, file, dto.kind ?? 'BROCHURE', requestMeta(req));
  }

  @Delete(':id/documents/:documentId')
  @HttpCode(204)
  @RequirePermissions('listing.manage')
  async removeDocument(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.listings.removeDocument(t, id, documentId, requestMeta(req));
  }
}

// ---------------------------------------------------------------------------
// Favourites (businesses)
// ---------------------------------------------------------------------------

@Controller('favourites')
export class FavouritesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('favourite.manage')
  list(@CurrentTenant() t: TenantInfo) {
    return this.prisma.forTenant(t, (tx) =>
      tx.favourite.findMany({
        where: {
          organizationId: t.organizationId,
          userId: t.userId,
          listing: { status: 'PUBLISHED', deletedAt: null },
        },
        select: {
          id: true,
          createdAt: true,
          listing: {
            select: {
              id: true,
              reference: true,
              title: true,
              price: true,
              currency: true,
              priceOnRequest: true,
              organization: { select: { id: true, legalName: true } },
              images: {
                orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
                take: 1,
                select: { id: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  @Post()
  @RequirePermissions('favourite.manage')
  async add(@CurrentTenant() t: TenantInfo, @Body() dto: FavouriteDto) {
    return this.prisma.forTenant(t, async (tx) => {
      const listing = await tx.equipmentListing.findFirst({
        where: { id: dto.listingId, status: 'PUBLISHED', deletedAt: null },
      });
      if (!listing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Listing not found.' });
      return tx.favourite.upsert({
        where: { userId_listingId: { userId: t.userId, listingId: dto.listingId } },
        update: {},
        create: { organizationId: t.organizationId, userId: t.userId, listingId: dto.listingId },
        select: { id: true, listingId: true },
      });
    });
  }

  @Delete(':listingId')
  @HttpCode(204)
  @RequirePermissions('favourite.manage')
  async remove(
    @CurrentTenant() t: TenantInfo,
    @Param('listingId', ParseUUIDPipe) listingId: string,
  ): Promise<void> {
    await this.prisma.forTenant(t, (tx) =>
      tx.favourite.deleteMany({ where: { userId: t.userId, listingId } }),
    );
  }
}

// ---------------------------------------------------------------------------
// Moderation and marketplace settings (Tasheel)
// ---------------------------------------------------------------------------

@Controller('admin')
export class MarketplaceAdminController {
  constructor(
    private readonly listings: ListingsService,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('listings')
  @RequirePermissions('admin.listing.moderate')
  queue(@CurrentTenant() t: TenantInfo, @Query() q: ListingStatusQueryDto) {
    return this.listings.moderationQueue(t, q.status ?? 'PENDING_REVIEW');
  }

  @Post('listings/:id/approve')
  @HttpCode(200)
  @RequirePermissions('admin.listing.moderate')
  approve(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.listings.moderate(t, id, 'approve', undefined, requestMeta(req));
  }

  @Post('listings/:id/reject')
  @HttpCode(200)
  @RequirePermissions('admin.listing.moderate')
  reject(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @Req() req: Request,
  ) {
    return this.listings.moderate(t, id, 'reject', dto.reason, requestMeta(req));
  }

  @Post('listings/:id/unpublish')
  @HttpCode(200)
  @RequirePermissions('admin.listing.moderate')
  unpublish(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @Req() req: Request,
  ) {
    return this.listings.moderate(t, id, 'unpublish', dto.reason, requestMeta(req));
  }

  @Get('settings/marketplace')
  @RequirePermissions('admin.listing.moderate')
  async getSettings() {
    return { moderation: await this.settings.moderationEnabled() };
  }

  @Put('settings/marketplace/moderation')
  @RequirePermissions('admin.settings.manage')
  async setModeration(
    @CurrentTenant() t: TenantInfo,
    @Body() dto: SettingValueDto,
    @Req() req: Request,
  ) {
    await this.prisma.forTenant(t, async (tx) => {
      await this.settings.setModeration(tx, dto.enabled, t.userId);
      await this.audit.record(tx, {
        organizationId: t.organizationId,
        actorUserId: t.userId,
        action: 'settings.marketplace_moderation_changed',
        entityType: 'PlatformSetting',
        entityId: 'marketplace.moderation',
        diff: { enabled: dto.enabled },
        meta: requestMeta(req),
      });
    });
    return { moderation: dto.enabled };
  }
}
