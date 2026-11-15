import { BadRequestException } from '@nestjs/common';

/**
 * Upload checks. The declared Content-Type is ignored: the type is decided from the file's
 * first bytes, so a script renamed .jpg is refused. Antivirus scanning of documents arrives
 * with the Documents module (Phase 3); listings accept only images and PDFs meanwhile.
 */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;
export const MAX_IMAGES_PER_LISTING = 10;
export const MAX_DOCUMENTS_PER_LISTING = 5;

export interface DetectedType {
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  ext: 'jpg' | 'png' | 'webp' | 'pdf';
}

export function detectType(buf: Buffer): DetectedType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return { mime: 'image/jpeg', ext: 'jpg' };
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  if (buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-')
    return { mime: 'application/pdf', ext: 'pdf' };
  return null;
}

export function assertImage(file: Express.Multer.File | undefined): DetectedType {
  if (!file)
    throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'A file is required.' });
  if (file.size > IMAGE_MAX_BYTES)
    throw new BadRequestException({
      code: 'FILE_TOO_LARGE',
      message: 'Images are limited to 5 MB.',
    });
  const type = detectType(file.buffer);
  if (!type || type.mime === 'application/pdf') {
    throw new BadRequestException({
      code: 'FILE_TYPE_NOT_ALLOWED',
      message: 'Images must be JPEG, PNG or WebP.',
    });
  }
  return type;
}

export function assertPdf(file: Express.Multer.File | undefined): DetectedType {
  if (!file)
    throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'A file is required.' });
  if (file.size > DOCUMENT_MAX_BYTES)
    throw new BadRequestException({
      code: 'FILE_TOO_LARGE',
      message: 'Documents are limited to 15 MB.',
    });
  const type = detectType(file.buffer);
  if (type?.mime !== 'application/pdf')
    throw new BadRequestException({
      code: 'FILE_TYPE_NOT_ALLOWED',
      message: 'Documents must be PDF files.',
    });
  return type;
}

/** Keeps a readable, safe file name for the Content-Disposition header. */
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .trim()
    .slice(0, 120);
  return cleaned || 'document.pdf';
}
