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

// --- Phase 3: documents and financing -------------------------------------------

export type DocState = 'MISSING' | 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

export interface DocumentType {
  code: string;
  name: LocalizedName;
  ownerTypes: string[];
  requiredForVerification: string[];
  requiredForApplication: boolean;
  hasExpiry: boolean;
}

export interface VaultDocument {
  id: string;
  typeCode: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  scanStatus: 'PENDING' | 'CLEAN' | 'INFECTED' | 'NOT_SCANNED';
  reviewStatus: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  reviewReason: string | null;
  expiresOn: string | null;
  createdAt: string;
}

export interface Vault {
  types: DocumentType[];
  documents: VaultDocument[];
  checklist: {
    verification: Array<{ typeCode: string; state: DocState }>;
    application: Array<{ typeCode: string; state: DocState }>;
  };
}

export type ProductType = 'LEASING' | 'IJARA';

export interface FinancingProduct {
  id: string;
  name: LocalizedName;
  description: LocalizedName;
  productType: ProductType;
  minAmount: string;
  maxAmount: string;
  minDurationMonths: number;
  maxDurationMonths: number;
  minDownPaymentPct: string;
  categoryCodes: string[];
  wilayaCodes: string[];
  minYearsInBusiness: number;
  indicativeRateMin: string;
  indicativeRateMax: string;
  requiredDocumentTypes: string[];
  isActive: boolean;
  _count?: { submissions: number; offers: number };
}

export type ApplicationStatus = 'DRAFT' | 'SUBMITTED' | 'OFFER_ACCEPTED' | 'WITHDRAWN' | 'CLOSED';
export type SubmissionStatus =
  'SENT' | 'UNDER_REVIEW' | 'INFO_REQUESTED' | 'OFFER_MADE' | 'DECLINED' | 'WITHDRAWN' | 'CLOSED';
export type OfferStatus = 'ISSUED' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'WITHDRAWN';

export interface CompanyProfile {
  yearsInBusiness?: number;
  employees?: number;
  annualRevenue?: string;
  sector?: string;
}

export interface EquipmentSnapshot {
  quotationReference: string;
  listingReference: string;
  title: LocalizedText;
  brand: string | null;
  model: string | null;
  year: number | null;
  condition: string;
  supplierName: string | null;
}

export interface Offer {
  id: string;
  organizationId: string;
  submissionId: string;
  reference: string;
  financedAmount: string;
  downPayment: string;
  durationMonths: number;
  ratePct: string;
  residualValue: string;
  feesAmount: string;
  installmentAmount: string;
  totalCost: string;
  validUntil: string;
  conditions: string | null;
  status: OfferStatus;
  createdAt: string;
}

export interface TimelineEvent {
  id: string;
  organizationId: string;
  kind: string;
  note: string | null;
  createdAt: string;
}

export interface Submission {
  id: string;
  institutionOrgId: string;
  institutionName?: string;
  status: SubmissionStatus;
  matchScore: number | null;
  declineReason: string | null;
  createdAt: string;
  product: { id: string; name: LocalizedName; productType: ProductType } | null;
  events: TimelineEvent[];
}

export interface Application {
  id: string;
  reference: string;
  status: ApplicationStatus;
  quotationId: string;
  categoryCode: string;
  equipmentAmount: string;
  downPayment: string;
  financedAmount: string;
  durationMonths: number;
  preferredType: ProductType | null;
  purpose: string | null;
  companyProfile: CompanyProfile;
  businessSnapshot: {
    legalName?: string;
    tradeName?: string | null;
    nif?: string | null;
    rcNumber?: string | null;
    nis?: string | null;
    wilayaCode?: string | null;
    address?: string | null;
  };
  equipmentSnapshot: EquipmentSnapshot;
  submittedAt: string | null;
  createdAt: string;
}

export interface ApplicationDetail extends Application {
  documents: Array<{
    document: Pick<
      VaultDocument,
      'id' | 'typeCode' | 'title' | 'fileName' | 'reviewStatus' | 'scanStatus' | 'expiresOn'
    >;
  }>;
  submissions: Submission[];
  offers: Offer[];
}

export interface ProductMatch {
  productId: string;
  institutionOrgId: string;
  institutionName: string;
  name: LocalizedName;
  productType: ProductType;
  indicativeRateMin: string;
  indicativeRateMax: string;
  requiredDocumentTypes: string[];
  indicative: true;
  score: number;
  checks: Array<{ criterion: string; met: boolean }>;
  installmentRange: { min: string; max: string };
}

export interface InboxRow {
  id: string;
  status: SubmissionStatus;
  matchScore: number | null;
  createdAt: string;
  application: Pick<
    Application,
    | 'reference'
    | 'status'
    | 'equipmentAmount'
    | 'downPayment'
    | 'financedAmount'
    | 'durationMonths'
    | 'categoryCode'
    | 'businessSnapshot'
    | 'equipmentSnapshot'
    | 'submittedAt'
  >;
  product: { id: string; name: LocalizedName; productType: ProductType } | null;
}

export interface ReviewDetail {
  id: string;
  status: SubmissionStatus;
  declineReason: string | null;
  application: Application & { documents: Array<{ document: VaultDocument }> };
  product: FinancingProduct | null;
  events: TimelineEvent[];
  offers: Offer[];
}

// --- Phase 4: billing ------------------------------------------------------------

export type CommissionTrigger = 'QUOTATION_ACCEPTED' | 'OFFER_ACCEPTED';

export interface CommissionRule {
  id: string;
  name: LocalizedName;
  trigger: CommissionTrigger;
  payerOrgId: string | null;
  basis: 'PERCENT' | 'FIXED';
  ratePct: string | null;
  fixedAmount: string | null;
  minAmount: string | null;
  maxAmount: string | null;
  categoryCodes: string[];
  validFrom: string;
  validTo: string | null;
  isActive: boolean;
  _count?: { commissions: number };
}

export interface Commission {
  id: string;
  organizationId: string;
  organizationName?: string;
  trigger: CommissionTrigger;
  sourceType: 'Quotation' | 'Offer';
  sourceReference: string;
  baseAmount: string;
  ratePct: string | null;
  amount: string;
  status: 'ACCRUED' | 'INVOICED' | 'CANCELLED';
  invoiceId: string | null;
  invoice?: { id?: string; number: string | null; status: string } | null;
  rule?: { name: LocalizedName; basis: string };
  accruedAt: string;
}

export interface PartyIdentity {
  legalName?: string;
  tradeName?: string | null;
  address?: string | null;
  wilayaCode?: string | null;
  rcNumber?: string | null;
  nif?: string | null;
  nis?: string | null;
  articleImposition?: string | null;
  bankName?: string;
  rib?: string;
  email?: string;
  phone?: string;
}

export interface Invoice {
  id: string;
  organizationId: string;
  organizationName?: string;
  kind: 'INVOICE' | 'CREDIT_NOTE';
  number: string | null;
  status: 'DRAFT' | 'ISSUED' | 'PAID' | 'CANCELLED';
  creditedInvoiceId: string | null;
  periodStart: string;
  periodEnd: string;
  issueDate: string | null;
  dueDate: string | null;
  subtotal: string;
  vatRate: string;
  vatAmount: string;
  total: string;
  currency: string;
  issuer: PartyIdentity;
  customer: PartyIdentity;
  notes: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  createdAt: string;
  lines?: Array<{ id: string; label: string; amount: string; sortOrder: number }>;
}

export interface BillingSettings {
  issuer: Required<
    Pick<
      PartyIdentity,
      'legalName' | 'address' | 'wilayaCode' | 'rcNumber' | 'nif' | 'nis' | 'articleImposition'
    >
  > &
    Pick<PartyIdentity, 'bankName' | 'rib' | 'email' | 'phone'>;
  vatRate: string;
  paymentTermsDays: number;
  invoicePrefix: string;
  creditNotePrefix: string;
}
