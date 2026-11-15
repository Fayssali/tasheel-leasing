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
