import { BadRequestException } from '@nestjs/common';
import { EQUIPMENT_CATEGORIES } from '@tasheel/shared';
import { assertImage, assertPdf, detectType, safeFileName } from '../src/marketplace/files';
import { toPrefixTsQuery, validateSpecs } from '../src/marketplace/specs';

const file = (buf: Buffer, name = 'x') =>
  ({ buffer: buf, size: buf.length, originalname: name }) as Express.Multer.File;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
const PDF = Buffer.from('%PDF-1.7\n%…');

describe('upload checks', () => {
  it('detects the real type from the first bytes', () => {
    expect(detectType(JPEG)?.mime).toBe('image/jpeg');
    expect(detectType(PNG)?.mime).toBe('image/png');
    expect(detectType(WEBP)?.mime).toBe('image/webp');
    expect(detectType(PDF)?.mime).toBe('application/pdf');
    expect(detectType(Buffer.from('<script>alert(1)</script>'))).toBeNull();
  });

  it('accepts images only as images and PDFs only as documents', () => {
    expect(assertImage(file(PNG)).ext).toBe('png');
    expect(() => assertImage(file(PDF))).toThrow(BadRequestException);
    expect(() => assertImage(file(Buffer.from('GIF89a')))).toThrow(BadRequestException);
    expect(assertPdf(file(PDF)).ext).toBe('pdf');
    expect(() => assertPdf(file(JPEG))).toThrow(BadRequestException);
    expect(() => assertImage(undefined)).toThrow(BadRequestException);
  });

  it('refuses oversized files', () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]);
    expect(() => assertImage(file(big))).toThrow(/5 MB/);
  });

  it('sanitizes file names for Content-Disposition', () => {
    expect(safeFileName('Fiche technique "pelle"\r\n.pdf')).toBe('Fiche technique _pelle___.pdf');
    expect(safeFileName('كتيب المعدات.pdf')).toBe('كتيب المعدات.pdf');
    expect(safeFileName('///')).toBe('___');
  });
});

describe('specifications', () => {
  const construction = EQUIPMENT_CATEGORIES.find((c) => c.code === 'construction')!.specSchema;

  it('keeps known fields, converts numbers, drops empties', () => {
    expect(
      validateSpecs(
        { power_kw: '120,5', fuel: 'diesel', weight_kg: '', hours_used: 3500 },
        construction,
      ),
    ).toEqual({
      power_kw: 120.5,
      fuel: 'diesel',
      hours_used: 3500,
    });
  });

  it('rejects unknown keys, bad numbers and unlisted options', () => {
    expect(() => validateSpecs({ colour: 'red' }, construction)).toThrow(BadRequestException);
    expect(() => validateSpecs({ power_kw: -1 }, construction)).toThrow(BadRequestException);
    expect(() => validateSpecs({ power_kw: 'abc' }, construction)).toThrow(BadRequestException);
    expect(() => validateSpecs({ fuel: 'nuclear' }, construction)).toThrow(BadRequestException);
    expect(() => validateSpecs([1, 2], construction)).toThrow(BadRequestException);
  });
});

describe('search query', () => {
  it('builds a prefix tsquery from free text, in French and Arabic, without operators', () => {
    expect(toPrefixTsQuery('Pelle CAT 320')).toBe('pelle:* & cat:* & 320:*');
    expect(toPrefixTsQuery('جرار فلاحي')).toBe('جرار:* & فلاحي:*');
    expect(toPrefixTsQuery("pelle' | !(drop)")).toBe('pelle:* & drop:*');
    expect(toPrefixTsQuery('  ')).toBeNull();
    expect(toPrefixTsQuery(undefined)).toBeNull();
  });
});
