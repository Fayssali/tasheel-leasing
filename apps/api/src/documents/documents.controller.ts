import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { CurrentTenant, RequirePermissions, TenantScoped } from '../common/decorators';
import { requestMeta, type TenantInfo } from '../common/request-context';
import { DOCUMENT_MAX_BYTES } from '../marketplace/files';
import { DocumentsService } from './documents.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UploadDocumentDto {
  @Matches(/^[a-z0-9_-]{2,40}$/)
  typeCode: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  expiresOn?: string;

  @IsOptional()
  @IsUUID()
  replacesId?: string;
}

export class DocumentReasonDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(3, 500)
  reason?: string;
}

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @RequirePermissions('document.manage')
  vault(@CurrentTenant() t: TenantInfo) {
    return this.documents.vault(t);
  }

  @Post()
  @RequirePermissions('document.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: DOCUMENT_MAX_BYTES, files: 1 } }))
  upload(
    @CurrentTenant() t: TenantInfo,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
    @Req() req: Request,
  ) {
    return this.documents.upload(t, file, dto, requestMeta(req));
  }

  /** Owner, institutions that received it with an application, and Tasheel staff (RLS decides). */
  @Get(':id/file')
  @TenantScoped()
  async file(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const file = await this.documents.download(t, id, requestMeta(req));
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    file.body.pipe(res);
  }
}

@Controller('admin')
export class AdminDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('organizations/:id/documents')
  @RequirePermissions('admin.document.review')
  forOrganization(@CurrentTenant() t: TenantInfo, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.forOrganization(t, id);
  }

  @Post('documents/:id/accept')
  @HttpCode(200)
  @RequirePermissions('admin.document.review')
  accept(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.documents.review(t, id, 'accept', undefined, requestMeta(req));
  }

  @Post('documents/:id/reject')
  @HttpCode(200)
  @RequirePermissions('admin.document.review')
  reject(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DocumentReasonDto,
    @Req() req: Request,
  ) {
    return this.documents.review(t, id, 'reject', dto.reason, requestMeta(req));
  }
}
