/**
 * Workflow statuses as string-literal unions. They mirror the database enums exactly, so they
 * are assignable to Prisma's generated enum types without depending on the generated client.
 */
export type ListingStatus = 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'ARCHIVED' | 'REJECTED';
export type QuotationRequestStatus = 'OPEN' | 'QUOTED' | 'CLOSED' | 'CANCELLED';
export type SubmissionStatus =
  'SENT' | 'UNDER_REVIEW' | 'INFO_REQUESTED' | 'OFFER_MADE' | 'DECLINED' | 'WITHDRAWN' | 'CLOSED';
