import type { OrganizationType } from './organization';

/**
 * Permission catalogue — the single source of truth.
 * Seeded into the `permissions` table; checked by the API permission guard.
 * Phase 1 covers M0; later phases append their permissions here.
 */
export interface PermissionDef {
  code: string;
  description: string;
  allowedOrgTypes: readonly OrganizationType[];
}

const ALL: readonly OrganizationType[] = [
  'PLATFORM',
  'SUPPLIER',
  'FINANCIAL_INSTITUTION',
  'BUSINESS',
];

export const PERMISSIONS = [
  // Organization & members (every organization type)
  { code: 'organization.read', description: 'View own organization profile', allowedOrgTypes: ALL },
  {
    code: 'organization.update',
    description: 'Edit own organization profile',
    allowedOrgTypes: ALL,
  },
  { code: 'member.read', description: 'List members of own organization', allowedOrgTypes: ALL },
  { code: 'member.invite', description: 'Invite users to own organization', allowedOrgTypes: ALL },
  { code: 'member.manage', description: 'Change roles or disable members', allowedOrgTypes: ALL },
  { code: 'role.manage', description: 'Create and edit custom roles', allowedOrgTypes: ALL },
  { code: 'audit.read', description: 'Read own organization audit log', allowedOrgTypes: ALL },

  // Marketplace (Phase 2)
  {
    code: 'listing.manage',
    description: 'Create, edit, publish and archive equipment listings',
    allowedOrgTypes: ['SUPPLIER'],
  },
  {
    code: 'quotation.respond',
    description: 'Read quotation requests and issue quotations',
    allowedOrgTypes: ['SUPPLIER'],
  },
  {
    code: 'quotation.request',
    description: 'Request quotations and accept or decline them',
    allowedOrgTypes: ['BUSINESS'],
  },
  {
    code: 'favourite.manage',
    description: 'Save equipment to favourites',
    allowedOrgTypes: ['BUSINESS'],
  },

  // Financing (Phase 3)
  {
    code: 'document.manage',
    description: "Upload and manage the organization's documents",
    allowedOrgTypes: ['BUSINESS', 'SUPPLIER', 'FINANCIAL_INSTITUTION'],
  },
  {
    code: 'application.manage',
    description: 'Create, submit and follow financing applications; decide on offers',
    allowedOrgTypes: ['BUSINESS'],
  },
  {
    code: 'product.manage',
    description: 'Configure financing products and their criteria',
    allowedOrgTypes: ['FINANCIAL_INSTITUTION'],
  },
  {
    code: 'application.review',
    description: 'Review received applications, request information, decline',
    allowedOrgTypes: ['FINANCIAL_INSTITUTION'],
  },
  {
    code: 'offer.issue',
    description: 'Issue and withdraw financing offers',
    allowedOrgTypes: ['FINANCIAL_INSTITUTION'],
  },

  // Platform administration (Tasheel only)
  {
    code: 'admin.organization.read',
    description: 'View all organizations',
    allowedOrgTypes: ['PLATFORM'],
  },
  {
    code: 'admin.organization.verify',
    description: 'Verify, reject or suspend organizations',
    allowedOrgTypes: ['PLATFORM'],
  },
  {
    code: 'admin.settings.manage',
    description: 'Edit platform settings',
    allowedOrgTypes: ['PLATFORM'],
  },
  {
    code: 'admin.support_session',
    description: 'Open a time-boxed support session on a tenant',
    allowedOrgTypes: ['PLATFORM'],
  },
  {
    code: 'admin.listing.moderate',
    description: 'Review, approve or reject equipment listings',
    allowedOrgTypes: ['PLATFORM'],
  },
  {
    code: 'admin.audit.read',
    description: 'Read the audit log of every organization',
    allowedOrgTypes: ['PLATFORM'],
  },
  { code: 'admin.kpi.read', description: 'View platform KPIs', allowedOrgTypes: ['PLATFORM'] },
  {
    code: 'admin.billing.manage',
    description: 'Configure commission rules and billing, issue invoices and credit notes',
    allowedOrgTypes: ['PLATFORM'],
  },
  {
    code: 'billing.read',
    description: "View the organization's commissions and invoices",
    allowedOrgTypes: ['SUPPLIER', 'FINANCIAL_INSTITUTION'],
  },
  {
    code: 'admin.document.review',
    description: 'Review organization verification documents',
    allowedOrgTypes: ['PLATFORM'],
  },
] as const satisfies readonly PermissionDef[];

export type PermissionCode = (typeof PERMISSIONS)[number]['code'];

export interface SystemRoleDef {
  code: string;
  organizationType: OrganizationType;
  name: { fr: string; ar: string; en: string };
  permissions: readonly PermissionCode[];
}

const ORG_ADMIN_PERMS: readonly PermissionCode[] = [
  'organization.read',
  'organization.update',
  'member.read',
  'member.invite',
  'member.manage',
  'role.manage',
  'audit.read',
];

const ORG_MEMBER_PERMS: readonly PermissionCode[] = ['organization.read', 'member.read'];

/** System roles, seeded with organization_id = NULL. Business permissions are added per phase. */
export const SYSTEM_ROLES: readonly SystemRoleDef[] = [
  {
    code: 'platform_super_admin',
    organizationType: 'PLATFORM',
    name: { fr: 'Super administrateur', ar: 'مدير عام', en: 'Super admin' },
    permissions: [
      ...ORG_ADMIN_PERMS,
      'admin.organization.read',
      'admin.organization.verify',
      'admin.settings.manage',
      'admin.support_session',
      'admin.audit.read',
      'admin.kpi.read',
      'admin.listing.moderate',
      'admin.document.review',
      'admin.billing.manage',
    ],
  },
  {
    code: 'platform_ops_agent',
    organizationType: 'PLATFORM',
    name: { fr: 'Agent opérations', ar: 'عون العمليات', en: 'Operations agent' },
    permissions: [
      ...ORG_MEMBER_PERMS,
      'admin.organization.read',
      'admin.organization.verify',
      'admin.kpi.read',
      'admin.listing.moderate',
      'admin.document.review',
    ],
  },
  {
    code: 'supplier_admin',
    organizationType: 'SUPPLIER',
    name: { fr: 'Administrateur fournisseur', ar: 'مسؤول المورد', en: 'Supplier admin' },
    permissions: [
      ...ORG_ADMIN_PERMS,
      'listing.manage',
      'quotation.respond',
      'document.manage',
      'billing.read',
    ],
  },
  {
    code: 'supplier_member',
    organizationType: 'SUPPLIER',
    name: { fr: 'Commercial', ar: 'مندوب مبيعات', en: 'Sales rep' },
    permissions: [...ORG_MEMBER_PERMS, 'listing.manage', 'quotation.respond', 'document.manage'],
  },
  {
    code: 'institution_admin',
    organizationType: 'FINANCIAL_INSTITUTION',
    name: { fr: "Administrateur de l'établissement", ar: 'مسؤول المؤسسة', en: 'Institution admin' },
    permissions: [
      ...ORG_ADMIN_PERMS,
      'product.manage',
      'application.review',
      'offer.issue',
      'document.manage',
      'billing.read',
    ],
  },
  {
    code: 'institution_analyst',
    organizationType: 'FINANCIAL_INSTITUTION',
    name: { fr: 'Analyste crédit', ar: 'محلل ائتمان', en: 'Credit analyst' },
    // Analysts review and ask for information; offers are issued by the institution admin.
    permissions: [...ORG_MEMBER_PERMS, 'application.review'],
  },
  {
    code: 'business_admin',
    organizationType: 'BUSINESS',
    name: { fr: "Administrateur de l'entreprise", ar: 'مسؤول المؤسسة', en: 'Business admin' },
    permissions: [
      ...ORG_ADMIN_PERMS,
      'quotation.request',
      'favourite.manage',
      'document.manage',
      'application.manage',
    ],
  },
  {
    code: 'business_member',
    organizationType: 'BUSINESS',
    name: { fr: 'Collaborateur', ar: 'متعاون', en: 'Member' },
    permissions: [
      ...ORG_MEMBER_PERMS,
      'quotation.request',
      'favourite.manage',
      'document.manage',
      'application.manage',
    ],
  },
];
