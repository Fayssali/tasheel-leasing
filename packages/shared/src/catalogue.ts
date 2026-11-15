/**
 * Equipment categories (Phase 0 specification, section 2.B) with the technical fields each
 * one asks for. Seeded as reference data; Tasheel can extend them later from the database.
 */
export interface SpecField {
  key: string;
  label: { fr: string; ar: string; en: string };
  type: 'number' | 'text' | 'select';
  unit?: string;
  options?: Array<{ value: string; label: { fr: string; ar: string; en: string } }>;
}

export interface CategoryDef {
  code: string;
  name: { fr: string; ar: string; en: string };
  specSchema: SpecField[];
}

const L = (fr: string, ar: string, en: string) => ({ fr, ar, en });
const power: SpecField = {
  key: 'power_kw',
  label: L('Puissance', 'القدرة', 'Power'),
  type: 'number',
  unit: 'kW',
};
const weight: SpecField = {
  key: 'weight_kg',
  label: L('Poids', 'الوزن', 'Weight'),
  type: 'number',
  unit: 'kg',
};
const hours: SpecField = {
  key: 'hours_used',
  label: L("Heures d'utilisation", 'ساعات الاستعمال', 'Hours used'),
  type: 'number',
  unit: 'h',
};
const fuel: SpecField = {
  key: 'fuel',
  label: L('Énergie', 'الطاقة', 'Energy'),
  type: 'select',
  options: [
    { value: 'diesel', label: L('Diesel', 'ديزل', 'Diesel') },
    { value: 'petrol', label: L('Essence', 'بنزين', 'Petrol') },
    { value: 'electric', label: L('Électrique', 'كهربائي', 'Electric') },
    { value: 'hybrid', label: L('Hybride', 'هجين', 'Hybrid') },
    { value: 'gas', label: L('GPL / GNC', 'غاز', 'LPG / CNG') },
  ],
};

export const EQUIPMENT_CATEGORIES: CategoryDef[] = [
  {
    code: 'industrial',
    name: L('Machines industrielles', 'الآلات الصناعية', 'Industrial machinery'),
    specSchema: [
      power,
      weight,
      {
        key: 'capacity',
        label: L('Capacité de production', 'الطاقة الإنتاجية', 'Production capacity'),
        type: 'text',
      },
      { key: 'voltage_v', label: L('Tension', 'الجهد', 'Voltage'), type: 'number', unit: 'V' },
    ],
  },
  {
    code: 'construction',
    name: L('BTP et travaux publics', 'البناء والأشغال العمومية', 'Construction and public works'),
    specSchema: [
      power,
      weight,
      hours,
      fuel,
      {
        key: 'bucket_m3',
        label: L('Capacité du godet', 'سعة الدلو', 'Bucket capacity'),
        type: 'number',
        unit: 'm³',
      },
    ],
  },
  {
    code: 'agriculture',
    name: L('Machines agricoles', 'الآلات الفلاحية', 'Agricultural machinery'),
    specSchema: [
      { key: 'power_hp', label: L('Puissance', 'القدرة', 'Power'), type: 'number', unit: 'ch' },
      hours,
      fuel,
      {
        key: 'working_width_m',
        label: L('Largeur de travail', 'عرض العمل', 'Working width'),
        type: 'number',
        unit: 'm',
      },
    ],
  },
  {
    code: 'vehicles',
    name: L(
      'Véhicules utilitaires et camions',
      'المركبات النفعية والشاحنات',
      'Commercial vehicles and trucks',
    ),
    specSchema: [
      {
        key: 'payload_t',
        label: L('Charge utile', 'الحمولة', 'Payload'),
        type: 'number',
        unit: 't',
      },
      {
        key: 'mileage_km',
        label: L('Kilométrage', 'المسافة المقطوعة', 'Mileage'),
        type: 'number',
        unit: 'km',
      },
      fuel,
      { key: 'axles', label: L("Nombre d'essieux", 'عدد المحاور', 'Axles'), type: 'number' },
    ],
  },
  {
    code: 'medical',
    name: L(
      'Équipements médicaux et hospitaliers',
      'المعدات الطبية والاستشفائية',
      'Medical and hospital equipment',
    ),
    specSchema: [
      {
        key: 'certification',
        label: L('Certification (CE, FDA…)', 'الشهادة', 'Certification (CE, FDA…)'),
        type: 'text',
      },
      {
        key: 'modality',
        label: L('Modalité / usage', 'الاستعمال', 'Modality / use'),
        type: 'text',
      },
      power,
    ],
  },
  {
    code: 'it-telecom',
    name: L(
      'Informatique et télécommunications',
      'الإعلام الآلي والاتصالات',
      'IT and telecommunications',
    ),
    specSchema: [
      { key: 'units', label: L("Nombre d'unités", 'عدد الوحدات', 'Units'), type: 'number' },
      { key: 'configuration', label: L('Configuration', 'التكوين', 'Configuration'), type: 'text' },
    ],
  },
  {
    code: 'renewable',
    name: L('Énergies renouvelables', 'الطاقات المتجددة', 'Renewable energy'),
    specSchema: [
      {
        key: 'peak_power_kwp',
        label: L('Puissance crête', 'القدرة القصوى', 'Peak power'),
        type: 'number',
        unit: 'kWc',
      },
      {
        key: 'storage_kwh',
        label: L('Stockage', 'التخزين', 'Storage'),
        type: 'number',
        unit: 'kWh',
      },
      { key: 'technology', label: L('Technologie', 'التكنولوجيا', 'Technology'), type: 'text' },
    ],
  },
  {
    code: 'other',
    name: L(
      'Autres équipements professionnels',
      'معدات مهنية أخرى',
      'Other professional equipment',
    ),
    specSchema: [power, weight],
  },
];
