import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentTenant, RequirePermissions } from '../common/decorators';
import { requestMeta, type TenantInfo } from '../common/request-context';
import { ApplicationsService } from './applications.service';
import {
  ApplicationDto,
  ApplicationUpdateDto,
  DocumentIdsDto,
  InfoReplyDto,
  NoteDto,
  OfferDto,
  ProductDto,
  ReasonDto,
  SubmissionStatusQueryDto,
  SubmitDto,
} from './financing.dto';
import { ProductsService } from './products.service';
import { ReviewService } from './review.service';

/** Institution: its financing products. */
@Controller('institution/products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions('product.manage')
  list(@CurrentTenant() t: TenantInfo) {
    return this.products.list(t);
  }

  @Get('document-types')
  @RequirePermissions('product.manage')
  documentTypes(@CurrentTenant() t: TenantInfo) {
    return this.products.documentTypes(t);
  }

  @Post()
  @RequirePermissions('product.manage')
  create(@CurrentTenant() t: TenantInfo, @Body() dto: ProductDto, @Req() req: Request) {
    return this.products.create(t, dto, requestMeta(req));
  }

  @Put(':id')
  @RequirePermissions('product.manage')
  update(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProductDto,
    @Req() req: Request,
  ) {
    return this.products.update(t, id, dto, requestMeta(req));
  }
}

/** Business: applications. */
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get()
  @RequirePermissions('application.manage')
  list(@CurrentTenant() t: TenantInfo) {
    return this.applications.list(t);
  }

  @Get('eligible-quotations')
  @RequirePermissions('application.manage')
  eligible(@CurrentTenant() t: TenantInfo) {
    return this.applications.eligibleQuotations(t);
  }

  @Post()
  @RequirePermissions('application.manage')
  create(@CurrentTenant() t: TenantInfo, @Body() dto: ApplicationDto, @Req() req: Request) {
    return this.applications.create(t, dto, requestMeta(req));
  }

  @Get(':id')
  @RequirePermissions('application.manage')
  get(@CurrentTenant() t: TenantInfo, @Param('id', ParseUUIDPipe) id: string) {
    return this.applications.get(t, id);
  }

  @Put(':id')
  @RequirePermissions('application.manage')
  update(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplicationUpdateDto,
    @Req() req: Request,
  ) {
    return this.applications.update(t, id, dto, requestMeta(req));
  }

  @Post(':id/documents')
  @HttpCode(200)
  @RequirePermissions('application.manage')
  attach(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DocumentIdsDto,
    @Req() req: Request,
  ) {
    return this.applications.attach(t, id, dto.documentIds, requestMeta(req));
  }

  @Delete(':id/documents/:documentId')
  @RequirePermissions('application.manage')
  detach(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Req() req: Request,
  ) {
    return this.applications.detach(t, id, documentId, requestMeta(req));
  }

  /** Indicative only: fit with each institution's published criteria and an installment range. */
  @Get(':id/matches')
  @RequirePermissions('application.manage')
  matches(@CurrentTenant() t: TenantInfo, @Param('id', ParseUUIDPipe) id: string) {
    return this.applications.matches(t, id);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions('application.manage')
  submit(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitDto,
    @Req() req: Request,
  ) {
    return this.applications.submit(t, id, dto.productIds, requestMeta(req));
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  @RequirePermissions('application.manage')
  withdraw(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.applications.withdraw(t, id, requestMeta(req));
  }

  @Post('submissions/:submissionId/reply')
  @HttpCode(200)
  @RequirePermissions('application.manage')
  reply(
    @CurrentTenant() t: TenantInfo,
    @Param('submissionId', ParseUUIDPipe) id: string,
    @Body() dto: InfoReplyDto,
    @Req() req: Request,
  ) {
    return this.applications.replyToInfoRequest(
      t,
      id,
      dto.note,
      dto.documentIds ?? [],
      requestMeta(req),
    );
  }

  @Post('offers/:offerId/accept')
  @HttpCode(200)
  @RequirePermissions('application.manage')
  accept(
    @CurrentTenant() t: TenantInfo,
    @Param('offerId', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.applications.decideOffer(t, id, 'accept', requestMeta(req));
  }

  @Post('offers/:offerId/decline')
  @HttpCode(200)
  @RequirePermissions('application.manage')
  decline(
    @CurrentTenant() t: TenantInfo,
    @Param('offerId', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.applications.decideOffer(t, id, 'decline', requestMeta(req));
  }
}

/** Institution: applications received. */
@Controller('institution/applications')
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Get()
  @RequirePermissions('application.review')
  inbox(@CurrentTenant() t: TenantInfo, @Query() q: SubmissionStatusQueryDto) {
    return this.review.inbox(t, q.status);
  }

  @Get(':submissionId')
  @RequirePermissions('application.review')
  detail(@CurrentTenant() t: TenantInfo, @Param('submissionId', ParseUUIDPipe) id: string) {
    return this.review.detail(t, id);
  }

  @Post(':submissionId/request-info')
  @HttpCode(200)
  @RequirePermissions('application.review')
  requestInfo(
    @CurrentTenant() t: TenantInfo,
    @Param('submissionId', ParseUUIDPipe) id: string,
    @Body() dto: NoteDto,
    @Req() req: Request,
  ) {
    return this.review.requestInfo(t, id, dto.note, requestMeta(req));
  }

  @Post(':submissionId/decline')
  @HttpCode(200)
  @RequirePermissions('application.review')
  decline(
    @CurrentTenant() t: TenantInfo,
    @Param('submissionId', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @Req() req: Request,
  ) {
    return this.review.decline(t, id, dto.reason, requestMeta(req));
  }

  @Post(':submissionId/offers')
  @RequirePermissions('application.review', 'offer.issue')
  offer(
    @CurrentTenant() t: TenantInfo,
    @Param('submissionId', ParseUUIDPipe) id: string,
    @Body() dto: OfferDto,
    @Req() req: Request,
  ) {
    return this.review.issueOffer(t, id, dto, requestMeta(req));
  }

  @Post('offers/:offerId/withdraw')
  @HttpCode(200)
  @RequirePermissions('application.review', 'offer.issue')
  withdrawOffer(
    @CurrentTenant() t: TenantInfo,
    @Param('offerId', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.review.withdrawOffer(t, id, requestMeta(req));
  }
}
