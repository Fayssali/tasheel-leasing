// Mirrors the Prisma enums so the frontend can use them without depending on @prisma/client.

export const ORGANIZATION_TYPES = [
  'PLATFORM',
  'SUPPLIER',
  'FINANCIAL_INSTITUTION',
  'BUSINESS',
] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const ORGANIZATION_STATUSES = [
  'PENDING_VERIFICATION',
  'VERIFIED',
  'SUSPENDED',
  'REJECTED',
] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export const LOCALES = ['fr', 'ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Locales shipped at MVP (decision D5). English is added once strings are stable. */
export const MVP_LOCALES: readonly Locale[] = ['fr', 'ar'];

export const RTL_LOCALES: readonly Locale[] = ['ar'];

export function isRtl(locale: Locale): boolean {
  return RTL_LOCALES.includes(locale);
}
