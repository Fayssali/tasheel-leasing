/**
 * Document types seeded as reference data (table document_types). Which organizations
 * provide them and when they are required lives in the database and can be changed there;
 * the code only reads it.
 */
import type { OrganizationType } from './organization';

export interface DocumentTypeDef {
  code: string;
  name: { fr: string; ar: string; en: string };
  ownerTypes: OrganizationType[];
  requiredForVerification: OrganizationType[];
  requiredForApplication: boolean;
  hasExpiry: boolean;
}

const L = (fr: string, ar: string, en: string) => ({ fr, ar, en });
const COMPANIES: OrganizationType[] = ['BUSINESS', 'SUPPLIER', 'FINANCIAL_INSTITUTION'];
const CLIENTS: OrganizationType[] = ['BUSINESS', 'SUPPLIER'];

export const DOCUMENT_TYPES: DocumentTypeDef[] = [
  {
    code: 'rc_extract',
    name: L(
      'Extrait du registre du commerce',
      'مستخرج السجل التجاري',
      'Commercial register extract',
    ),
    ownerTypes: COMPANIES,
    requiredForVerification: CLIENTS,
    requiredForApplication: false,
    hasExpiry: false,
  },
  {
    code: 'nif_certificate',
    name: L('Attestation NIF', 'شهادة رقم التعريف الجبائي', 'Tax ID (NIF) certificate'),
    ownerTypes: COMPANIES,
    requiredForVerification: CLIENTS,
    requiredForApplication: false,
    hasExpiry: false,
  },
  {
    code: 'nis_certificate',
    name: L(
      'Avis d’identification NIS',
      'إشعار رقم التعريف الإحصائي',
      'Statistical ID (NIS) notice',
    ),
    ownerTypes: COMPANIES,
    requiredForVerification: [],
    requiredForApplication: false,
    hasExpiry: false,
  },
  {
    code: 'articles_of_association',
    name: L('Statuts de la société', 'القانون الأساسي للشركة', 'Articles of association'),
    ownerTypes: COMPANIES,
    requiredForVerification: CLIENTS,
    requiredForApplication: false,
    hasExpiry: false,
  },
  {
    code: 'legal_rep_id',
    name: L(
      'Pièce d’identité du représentant légal',
      'وثيقة هوية الممثل القانوني',
      'Legal representative ID',
    ),
    ownerTypes: COMPANIES,
    requiredForVerification: CLIENTS,
    requiredForApplication: false,
    hasExpiry: true,
  },
  {
    code: 'tax_clearance',
    name: L(
      'Extrait de rôle / situation fiscale',
      'مستخرج الجدول / الوضعية الجبائية',
      'Tax clearance certificate',
    ),
    ownerTypes: CLIENTS,
    requiredForVerification: [],
    requiredForApplication: true,
    hasExpiry: true,
  },
  {
    code: 'cnas_clearance',
    name: L(
      'Attestation de mise à jour CNAS',
      'شهادة التحيين لدى CNAS',
      'Social security (CNAS) clearance',
    ),
    ownerTypes: CLIENTS,
    requiredForVerification: [],
    requiredForApplication: true,
    hasExpiry: true,
  },
  {
    code: 'financial_statements',
    name: L(
      'États financiers (bilan, TCR) des derniers exercices',
      'القوائم المالية (الميزانية، حساب النتائج) للسنوات الأخيرة',
      'Financial statements (latest years)',
    ),
    ownerTypes: CLIENTS,
    requiredForVerification: [],
    requiredForApplication: true,
    hasExpiry: false,
  },
  {
    code: 'bank_statements',
    name: L(
      'Relevés bancaires (6 derniers mois)',
      'كشوف الحساب البنكي (آخر 6 أشهر)',
      'Bank statements (last 6 months)',
    ),
    ownerTypes: CLIENTS,
    requiredForVerification: [],
    requiredForApplication: false,
    hasExpiry: false,
  },
  {
    code: 'other',
    name: L('Autre document', 'وثيقة أخرى', 'Other document'),
    ownerTypes: COMPANIES,
    requiredForVerification: [],
    requiredForApplication: false,
    hasExpiry: false,
  },
];
