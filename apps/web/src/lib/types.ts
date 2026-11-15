import type { Locale, OrganizationStatus, OrganizationType } from '@tasheel/shared';

export type LocalizedName = Partial<Record<Locale, string>>;

export interface Membership {
  organizationId: string;
  legalName: string;
  type: OrganizationType;
  status: OrganizationStatus;
  roles: Array<{ code: string; name: LocalizedName }>;
}

export interface Me {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    locale: Locale;
    emailVerified: boolean;
    mfaEnabled: boolean;
    mfaSetupRequired: boolean;
  };
  memberships: Membership[];
}

export interface TokenResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export interface MfaChallenge {
  mfaRequired: true;
  mfaToken: string;
  expiresIn: number;
}

export interface OrganizationProfile {
  id: string;
  type: OrganizationType;
  status: OrganizationStatus;
  statusReason: string | null;
  legalName: string;
  tradeName: string | null;
  rcNumber: string | null;
  nif: string | null;
  nis: string | null;
  articleImposition: string | null;
  wilayaCode: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  defaultLocale: Locale;
  verifiedAt: string | null;
  createdAt: string;
  permissions?: string[];
}

export interface Member {
  id: string;
  status: 'ACTIVE' | 'INVITED' | 'DISABLED';
  createdAt: string;
  user: { id: string; email: string; firstName: string; lastName: string; mfaEnabled: boolean };
  roles: Array<{ role: { code: string; name: LocalizedName } }>;
}

export interface AssignableRole {
  code: string;
  name: LocalizedName;
  permissions: string[];
  assignableByYou: boolean;
}

export interface Invitation {
  id: string;
  email: string;
  expiresAt: string;
  createdAt: string;
  role: { code: string; name: LocalizedName };
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface AdminOrganizationRow {
  id: string;
  type: OrganizationType;
  status: OrganizationStatus;
  legalName: string;
  tradeName: string | null;
  wilayaCode: string | null;
  nif: string | null;
  rcNumber: string | null;
  createdAt: string;
  verifiedAt: string | null;
  _count: { members: number };
}

export interface AdminOrganizationDetail extends OrganizationProfile {
  members: Array<{
    id: string;
    status: string;
    createdAt: string;
    user: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      emailVerifiedAt: string | null;
      mfaEnabled: boolean;
      lastLoginAt: string | null;
    };
    roles: Array<{ role: { code: string; name: LocalizedName } }>;
  }>;
}

export interface AuditEntry {
  id: string;
  organizationId: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  diff: unknown;
  ipAddress: string | null;
  createdAt: string;
}

export interface Kpis {
  organizations: Partial<Record<OrganizationType, Partial<Record<OrganizationStatus, number>>>>;
  pendingVerification: number;
  users: number;
  newOrganizations30d: number;
  generatedAt: string;
}

// --- Phase 2: marketplace -----------------------------------------------------

export interface SpecField {
  key: string;
  label: LocalizedName;
  type: 'number' | 'text' | 'select';
  unit?: string;
  options?: Array<{ value: string; label: LocalizedName }>;
}

export interface Category {
  id: string;
  code: string;
  name: LocalizedName;
  parentId: string | null;
  specSchema: SpecField[];
  listingCount: number;
}

export type ListingStatus = 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'ARCHIVED' | 'REJECTED';
export type LocalizedText = { fr?: string; ar?: string };

export interface ListingCard {
  id: string;
  reference: string;
  title: LocalizedText;
  brand: string | null;
  model: string | null;
  year: number | null;
  condition: 'NEW' | 'USED' | 'REFURBISHED';
  price: string | null;
  currency: string;
  priceOnRequest: boolean;
  priceIncludesVat: boolean;
  availability: 'IN_STOCK' | 'ON_ORDER' | 'UNAVAILABLE';
  categoryCode: string;
  categoryName: LocalizedName;
  supplierId: string;
  supplierName: string;
  supplierWilaya: string | null;
  coverImageId: string | null;
}

export interface SearchResult {
  items: ListingCard[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListingDetail {
  id: string;
  reference: string;
  title: LocalizedText;
  description: LocalizedText;
  brand: string | null;
  model: string | null;
  year: number | null;
  condition: ListingCard['condition'];
  price: string | null;
  currency: string;
  priceOnRequest: boolean;
  priceIncludesVat: boolean;
  availability: ListingCard['availability'];
  leadTimeDays: number | null;
  deliveryWilayas: string[];
  warrantyMonths: number | null;
  specs: Record<string, string | number>;
  viewCount: number;
  category: { code: string; name: LocalizedName; specSchema: SpecField[] };
  organization: {
    id: string;
    legalName: string;
    tradeName: string | null;
    wilayaCode: string | null;
  };
  images: Array<{ id: string }>;
  documents: Array<{ id: string; kind: string; fileName: string; sizeBytes: number }>;
}

export interface SupplierListing extends Omit<ListingDetail, 'organization' | 'viewCount'> {
  status: ListingStatus;
  statusReason: string | null;
  categoryId: string;
  viewCount: number;
  updatedAt: string;
  images: Array<{ id: string; sortOrder?: number }>;
  _count?: { quotationRequests: number };
}

export interface Quotation {
  id: string;
  reference: string;
  lines: Array<{ label: string; quantity: number; unitPrice: string; lineTotal: string }>;
  subtotal: string;
  vatRate: string;
  vatAmount: string;
  total: string;
  currency: string;
  validUntil: string;
  deliveryTerms: string | null;
  notes: string | null;
  status: 'ISSUED' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'WITHDRAWN';
  createdAt: string;
}

export interface QuotationRequestRow {
  id: string;
  reference: string;
  status: 'OPEN' | 'QUOTED' | 'CLOSED' | 'CANCELLED';
  quantity: number;
  message: string | null;
  deliveryWilaya: string | null;
  businessName: string;
  requesterName: string;
  createdAt: string;
  listing: {
    id: string;
    reference: string;
    title: LocalizedText;
    price?: string | null;
    organization?: { id: string; legalName: string };
  };
  quotations: Quotation[];
}
