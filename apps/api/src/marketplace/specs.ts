import { BadRequestException } from '@nestjs/common';
import type { SpecField } from '@tasheel/shared';

/**
 * Validates listing specifications against the category's spec schema: only known keys,
 * numbers for number fields (non-negative), listed options for select fields, short text.
 * Returns the cleaned object (empty values dropped).
 */
export function validateSpecs(
  input: unknown,
  schema: SpecField[],
): Record<string, string | number> {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException({ code: 'INVALID_SPECS', message: 'specs must be an object.' });
  }
  const fields = new Map(schema.map((f) => [f.key, f]));
  const out: Record<string, string | number> = {};

  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const field = fields.get(key);
    if (!field)
      throw new BadRequestException({
        code: 'INVALID_SPECS',
        message: `Unknown specification "${key}" for this category.`,
      });
    if (raw === '' || raw === null || raw === undefined) continue;

    if (field.type === 'number') {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
      if (!Number.isFinite(n) || n < 0 || n > 1e9) {
        throw new BadRequestException({
          code: 'INVALID_SPECS',
          message: `"${key}" must be a positive number.`,
        });
      }
      out[key] = n;
    } else if (field.type === 'select') {
      if (!field.options?.some((o) => o.value === raw)) {
        throw new BadRequestException({
          code: 'INVALID_SPECS',
          message: `"${key}" has an invalid value.`,
        });
      }
      out[key] = String(raw);
    } else {
      const s = String(raw).trim();
      if (s.length > 200)
        throw new BadRequestException({ code: 'INVALID_SPECS', message: `"${key}" is too long.` });
      if (s) out[key] = s;
    }
  }
  return out;
}

/** Builds a prefix full-text query from free text: "pelle cat" → "pelle:* & cat:*". */
export function toPrefixTsQuery(q: string | undefined): string | null {
  if (!q) return null;
  const words =
    q
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.slice(0, 8) ?? [];
  return words.length ? words.map((w) => `${w}:*`).join(' & ') : null;
}
