/**
 * FICTIONAL marketplace demo data: 20 listings across the demo suppliers, favourites and
 * quotation requests in every state. Companies, people, products and prices are invented.
 * Photos are generated colour placeholders, uploaded to the local S3 (MinIO) when reachable.
 */
import { CreateBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import { computeQuotationTotals } from '@tasheel/shared';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';

type Cond = 'NEW' | 'USED' | 'REFURBISHED';
type Status = 'PUBLISHED' | 'DRAFT' | 'PENDING_REVIEW' | 'REJECTED';

interface DemoListing {
  supplier: string; // legal name
  category: string;
  fr: string;
  ar: string;
  descFr: string;
  brand: string;
  model: string;
  year: number;
  condition: Cond;
  price: string | null;
  leadTimeDays?: number;
  warrantyMonths?: number;
  specs: Record<string, string | number>;
  status?: Status;
  statusReason?: string;
}

const ATLAS = 'Atlas Machines Industrielles SARL (fictif)';
const SAHEL = 'Sahel Agri Équipement EURL (fictif)';
const MEDI = 'MediTech Solutions Algérie SPA (fictif)';

export const DEMO_LISTINGS: DemoListing[] = [
  {
    supplier: ATLAS,
    category: 'construction',
    fr: 'Pelle hydraulique sur chenilles 22 t',
    ar: 'حفارة هيدروليكية على جنزير 22 طن',
    descFr:
      'Pelle sur chenilles, cabine climatisée, godet 1,2 m³ fourni. Modèle fictif de démonstration.',
    brand: 'Fictiva',
    model: 'PX-220',
    year: 2025,
    condition: 'NEW',
    price: '18500000.00',
    leadTimeDays: 21,
    warrantyMonths: 12,
    specs: { power_kw: 110, weight_kg: 22000, fuel: 'diesel', bucket_m3: 1.2 },
  },
  {
    supplier: ATLAS,
    category: 'construction',
    fr: 'Chargeuse sur pneus 3 m³',
    ar: 'جرافة على عجلات 3 م³',
    descFr: 'Chargeuse reconditionnée en atelier, pneus neufs, révision complète.',
    brand: 'Fictiva',
    model: 'WL-30',
    year: 2019,
    condition: 'REFURBISHED',
    price: '14250000.00',
    leadTimeDays: 7,
    warrantyMonths: 6,
    specs: { power_kw: 125, hours_used: 6400, fuel: 'diesel', bucket_m3: 3 },
  },
  {
    supplier: ATLAS,
    category: 'construction',
    fr: 'Mini-pelle 3,5 t',
    ar: 'حفارة صغيرة 3.5 طن',
    descFr: 'Idéale pour les chantiers urbains et les travaux de réseaux.',
    brand: 'Compacto',
    model: 'MX-35',
    year: 2025,
    condition: 'NEW',
    price: '6900000.00',
    leadTimeDays: 14,
    warrantyMonths: 12,
    specs: { power_kw: 18, weight_kg: 3500, fuel: 'diesel' },
  },
  {
    supplier: ATLAS,
    category: 'construction',
    fr: 'Bétonnière autochargeuse 4 m³',
    ar: 'خلاطة خرسانة ذاتية التحميل 4 م³',
    descFr: 'Production jusqu’à 20 m³/h, pesage électronique.',
    brand: 'Betonix',
    model: 'AC-40',
    year: 2024,
    condition: 'NEW',
    price: '9800000.00',
    leadTimeDays: 30,
    specs: { power_kw: 75, fuel: 'diesel' },
  },
  {
    supplier: ATLAS,
    category: 'construction',
    fr: 'Grue à tour 8 t',
    ar: 'رافعة برجية 8 طن',
    descFr: 'Flèche 55 m, prix selon configuration et transport.',
    brand: 'Altura',
    model: 'GT-855',
    year: 2024,
    condition: 'NEW',
    price: null,
    leadTimeDays: 60,
    specs: { weight_kg: 8000, fuel: 'electric' },
  },
  {
    supplier: ATLAS,
    category: 'industrial',
    fr: 'Centre d’usinage CNC 3 axes',
    ar: 'مركز تشغيل CNC ثلاثي المحاور',
    descFr: 'Course 1000 × 600 × 600 mm, changeur 24 outils.',
    brand: 'Precisa',
    model: 'VMC-1060',
    year: 2025,
    condition: 'NEW',
    price: '21400000.00',
    leadTimeDays: 45,
    warrantyMonths: 24,
    specs: { power_kw: 15, weight_kg: 6500, voltage_v: 400 },
  },
  {
    supplier: ATLAS,
    category: 'industrial',
    fr: 'Compresseur à vis 37 kW',
    ar: 'ضاغط لولبي 37 كيلوواط',
    descFr: 'Variateur de vitesse, sécheur intégré.',
    brand: 'Aerotek',
    model: 'SV-37',
    year: 2025,
    condition: 'NEW',
    price: '3150000.00',
    leadTimeDays: 10,
    warrantyMonths: 24,
    specs: { power_kw: 37, voltage_v: 400 },
  },
  {
    supplier: ATLAS,
    category: 'industrial',
    fr: 'Chariot élévateur électrique 2,5 t',
    ar: 'رافعة شوكية كهربائية 2.5 طن',
    descFr: 'Batterie lithium, mât triplex 4,8 m.',
    brand: 'Liftco',
    model: 'E25',
    year: 2023,
    condition: 'USED',
    price: '2900000.00',
    leadTimeDays: 3,
    specs: { capacity: '2,5 t', voltage_v: 80 },
  },
  {
    supplier: ATLAS,
    category: 'industrial',
    fr: 'Ligne d’emballage sous film',
    ar: 'خط تغليف بالفيلم',
    descFr: 'Brouillon en cours de rédaction.',
    brand: 'Packline',
    model: 'FL-12',
    year: 2025,
    condition: 'NEW',
    price: null,
    specs: {},
    status: 'DRAFT',
  },

  {
    supplier: SAHEL,
    category: 'agriculture',
    fr: 'Tracteur agricole 110 ch',
    ar: 'جرار فلاحي 110 حصان',
    descFr: 'Tracteur 4 roues motrices, cabine, relevage avant.',
    brand: 'Agrisol',
    model: 'T-110',
    year: 2025,
    condition: 'NEW',
    price: '7900000.00',
    leadTimeDays: 20,
    warrantyMonths: 24,
    specs: { power_hp: 110, fuel: 'diesel' },
  },
  {
    supplier: SAHEL,
    category: 'agriculture',
    fr: 'Tracteur 75 ch d’occasion',
    ar: 'جرار 75 حصان مستعمل',
    descFr: 'Entretien suivi, 3 800 heures.',
    brand: 'Agrisol',
    model: 'T-75',
    year: 2020,
    condition: 'USED',
    price: '4100000.00',
    leadTimeDays: 2,
    specs: { power_hp: 75, hours_used: 3800, fuel: 'diesel' },
  },
  {
    supplier: SAHEL,
    category: 'agriculture',
    fr: 'Moissonneuse-batteuse 5,5 m',
    ar: 'حاصدة دارسة 5.5 م',
    descFr: 'Coupe 5,5 m, trémie 7 000 l.',
    brand: 'Harvestra',
    model: 'MB-55',
    year: 2024,
    condition: 'NEW',
    price: '32500000.00',
    leadTimeDays: 50,
    warrantyMonths: 12,
    specs: { power_hp: 260, working_width_m: 5.5, fuel: 'diesel' },
  },
  {
    supplier: SAHEL,
    category: 'agriculture',
    fr: 'Système d’irrigation goutte-à-goutte 10 ha',
    ar: 'نظام ري بالتقطير 10 هكتار',
    descFr: 'Kit complet avec station de filtration et programmateur.',
    brand: 'Aquadz',
    model: 'GG-10',
    year: 2025,
    condition: 'NEW',
    price: '2650000.00',
    leadTimeDays: 15,
    specs: {},
  },
  {
    supplier: SAHEL,
    category: 'agriculture',
    fr: 'Chambre froide modulaire 60 m³',
    ar: 'غرفة تبريد معيارية 60 م³',
    descFr: 'Panneaux 100 mm, groupe froid positif.',
    brand: 'Frigosud',
    model: 'CF-60',
    year: 2025,
    condition: 'NEW',
    price: '3900000.00',
    leadTimeDays: 25,
    warrantyMonths: 12,
    specs: {},
    status: 'PENDING_REVIEW',
  },
  {
    supplier: SAHEL,
    category: 'vehicles',
    fr: 'Camion benne 19 t',
    ar: 'شاحنة قلابة 19 طن',
    descFr: 'Benne acier 14 m³, 180 000 km.',
    brand: 'Trucka',
    model: 'B-19',
    year: 2022,
    condition: 'USED',
    price: '12600000.00',
    leadTimeDays: 5,
    specs: { payload_t: 19, mileage_km: 180000, fuel: 'diesel', axles: 3 },
  },
  {
    supplier: SAHEL,
    category: 'vehicles',
    fr: 'Fourgon frigorifique 3,5 t',
    ar: 'شاحنة تبريد 3.5 طن',
    descFr: 'Caisse isotherme, groupe froid −20 °C.',
    brand: 'Trucka',
    model: 'FR-35',
    year: 2025,
    condition: 'NEW',
    price: '8700000.00',
    leadTimeDays: 30,
    warrantyMonths: 24,
    specs: { payload_t: 1.2, fuel: 'diesel', axles: 2 },
  },

  {
    supplier: MEDI,
    category: 'medical',
    fr: 'Échographe portable',
    ar: 'جهاز إيكوغرافي محمول',
    descFr: 'Trois sondes, écran 15 pouces, batterie 2 h.',
    brand: 'Sonomed',
    model: 'SP-15',
    year: 2025,
    condition: 'NEW',
    price: '3450000.00',
    leadTimeDays: 15,
    warrantyMonths: 24,
    specs: { modality: 'Échographie', certification: 'CE (fictif)' },
  },
  {
    supplier: MEDI,
    category: 'medical',
    fr: 'Fauteuil dentaire complet',
    ar: 'كرسي أسنان متكامل',
    descFr: 'Unit avec éclairage LED et aspiration.',
    brand: 'Dentalia',
    model: 'DX-5',
    year: 2025,
    condition: 'NEW',
    price: '2200000.00',
    leadTimeDays: 20,
    warrantyMonths: 24,
    specs: { certification: 'CE (fictif)' },
  },
  {
    supplier: MEDI,
    category: 'renewable',
    fr: 'Centrale solaire 100 kWc',
    ar: 'محطة شمسية 100 كيلوواط ذروة',
    descFr: 'Modules, onduleurs et structure, étude incluse.',
    brand: 'Helios DZ',
    model: 'PV-100',
    year: 2025,
    condition: 'NEW',
    price: '13800000.00',
    leadTimeDays: 40,
    warrantyMonths: 120,
    specs: { peak_power_kwp: 100, technology: 'Monocristallin' },
  },
  {
    supplier: MEDI,
    category: 'it-telecom',
    fr: 'Baie serveurs 42U équipée',
    ar: 'خزانة خوادم 42U مجهزة',
    descFr: 'Retiré en attendant des photos plus nettes.',
    brand: 'Datanord',
    model: 'R-42',
    year: 2024,
    condition: 'NEW',
    price: '5600000.00',
    specs: { units: 42 },
    status: 'REJECTED',
    statusReason: 'Photos floues : merci de les remplacer avant de republier.',
  },
];

const PALETTE: Record<string, [number, number, number]> = {
  construction: [214, 162, 52],
  industrial: [60, 110, 160],
  agriculture: [90, 140, 80],
  vehicles: [120, 120, 130],
  medical: [70, 150, 170],
  renewable: [230, 180, 40],
  'it-telecom': [80, 80, 140],
  other: [150, 150, 150],
};

/** 640×480 PNG with a vertical gradient: a neutral placeholder, clearly not a product photo. */
export function placeholderPng([r, g, b]: [number, number, number], shade: number): Buffer {
  const w = 640;
  const h = 480;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const f = 0.75 + (0.35 * y) / h - shade * 0.08;
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      const o = row + 1 + x * 3;
      raw[o] = Math.min(255, r * f);
      raw[o + 1] = Math.min(255, g * f);
      raw[o + 2] = Math.min(255, b * f);
    }
  }
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const byte of buf) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function storage(): { s3: S3Client; bucket: string } | null {
  if (!process.env.S3_ENDPOINT) return null;
  return {
    s3: new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? 'dz-local',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? '',
        secretAccessKey: process.env.S3_SECRET_KEY ?? '',
      },
    }),
    bucket: process.env.S3_BUCKET_DOCUMENTS ?? 'tasheel-documents',
  };
}

async function nextRef(prisma: PrismaClient, prefix: 'EQ' | 'QR' | 'QT'): Promise<string> {
  const seq = {
    EQ: 'equipment_listing_ref_seq',
    QR: 'quotation_request_ref_seq',
    QT: 'quotation_ref_seq',
  }[prefix];
  const rows = (await prisma.$queryRawUnsafe(`SELECT nextval('${seq}') AS n`)) as Array<{
    n: bigint;
  }>;
  return `${prefix}-${new Date().getFullYear()}-${String(rows[0]!.n).padStart(6, '0')}`;
}

const isoDay = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** orgs: legal name → { id, adminUserId }. Skips if the demo suppliers already have listings. */
export async function seedDemoMarketplace(
  prisma: PrismaClient,
  orgs: Map<string, { id: string; userId: string; name: string }>,
): Promise<string> {
  const supplierIds = [ATLAS, SAHEL, MEDI].map((n) => orgs.get(n)!.id);
  if (
    (await prisma.equipmentListing.count({ where: { organizationId: { in: supplierIds } } })) > 0
  ) {
    return 'marketplace demo already present (skipped)';
  }
  const categories = new Map(
    (await prisma.equipmentCategory.findMany()).map((c: { code: string; id: string }) => [
      c.code,
      c.id,
    ]),
  );
  const store = storage();
  let uploaded = 0;
  let storageError: string | null = null;
  if (store) {
    // The API creates the bucket on start; the seed may run first.
    await store.s3.send(new CreateBucketCommand({ Bucket: store.bucket })).catch(() => undefined);
  }
  const listingIds: string[] = [];

  for (const [i, d] of DEMO_LISTINGS.entries()) {
    const org = orgs.get(d.supplier)!;
    const id = randomUUID();
    const status = d.status ?? 'PUBLISHED';
    await prisma.equipmentListing.create({
      data: {
        id,
        organizationId: org.id,
        reference: await nextRef(prisma, 'EQ'),
        categoryId: categories.get(d.category)!,
        title: { fr: d.fr, ar: d.ar },
        description: { fr: d.descFr },
        brand: d.brand,
        model: d.model,
        year: d.year,
        condition: d.condition,
        price: d.price,
        priceOnRequest: d.price === null,
        leadTimeDays: d.leadTimeDays ?? null,
        warrantyMonths: d.warrantyMonths ?? null,
        specs: d.specs,
        status,
        statusReason: d.statusReason ?? null,
        publishedAt: status === 'PUBLISHED' ? new Date(Date.now() - (20 - i) * 3_600_000) : null,
        viewCount: status === 'PUBLISHED' ? 15 + ((i * 37) % 180) : 0,
        createdById: org.userId,
      },
    });
    listingIds.push(id);

    if (store && !storageError && status !== 'DRAFT') {
      for (let k = 0; k < 2; k++) {
        const imageId = randomUUID();
        const key = `org/${org.id}/listings/${id}/images/${imageId}.png`;
        const body = placeholderPng(PALETTE[d.category] ?? PALETTE.other!, k);
        try {
          await store.s3.send(
            new PutObjectCommand({
              Bucket: store.bucket,
              Key: key,
              Body: body,
              ContentType: 'image/png',
            }),
          );
        } catch (err) {
          storageError = err instanceof Error ? err.message : String(err);
          break;
        }
        await prisma.equipmentImage.create({
          data: {
            id: imageId,
            organizationId: org.id,
            listingId: id,
            storageKey: key,
            mimeType: 'image/png',
            sizeBytes: body.length,
            sortOrder: k,
          },
        });
        uploaded++;
      }
    }
  }

  // Quotation requests in every state, from the demo businesses.
  const biz = (n: string) => orgs.get(n)!;
  const flows: Array<{
    business: string;
    listing: number;
    quantity: number;
    message?: string;
    outcome: 'OPEN' | 'QUOTED' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED';
  }> = [
    {
      business: 'Tassili Agro Transformation EURL (fictif)',
      listing: 9,
      quantity: 2,
      message: 'Deux tracteurs pour la campagne de printemps, livraison à Oran.',
      outcome: 'QUOTED',
    },
    {
      business: 'Tassili Agro Transformation EURL (fictif)',
      listing: 15,
      quantity: 1,
      outcome: 'OPEN',
    },
    {
      business: 'Djurdjura Travaux Publics SPA (fictif)',
      listing: 0,
      quantity: 1,
      message: 'Chantier de Tizi Ouzou, mise en service souhaitée.',
      outcome: 'ACCEPTED',
    },
    {
      business: 'Djurdjura Travaux Publics SPA (fictif)',
      listing: 1,
      quantity: 1,
      outcome: 'DECLINED',
    },
    {
      business: 'Clinique Les Palmiers SARL (fictif)',
      listing: 16,
      quantity: 2,
      message: 'Pour le service des urgences.',
      outcome: 'QUOTED',
    },
    {
      business: 'Oasis Froid Industriel SARL (fictif)',
      listing: 6,
      quantity: 1,
      outcome: 'CANCELLED',
    },
  ];
  for (const f of flows) {
    const listing = DEMO_LISTINGS[f.listing]!;
    const supplier = orgs.get(listing.supplier)!;
    const b = biz(f.business);
    const requestId = randomUUID();
    const requestStatus = {
      OPEN: 'OPEN',
      QUOTED: 'QUOTED',
      ACCEPTED: 'CLOSED',
      DECLINED: 'QUOTED',
      CANCELLED: 'CANCELLED',
    }[f.outcome];
    await prisma.quotationRequest.create({
      data: {
        id: requestId,
        reference: await nextRef(prisma, 'QR'),
        organizationId: b.id,
        supplierOrgId: supplier.id,
        listingId: listingIds[f.listing]!,
        requestedById: b.userId,
        businessName: b.name,
        requesterName: 'Contact démo',
        quantity: f.quantity,
        message: f.message ?? null,
        status: requestStatus,
      },
    });
    if (f.outcome === 'OPEN' || f.outcome === 'CANCELLED') continue;
    // Prices and the VAT rate below are fictional supplier inputs, not platform settings.
    const totals = computeQuotationTotals(
      [
        {
          label: `${listing.brand} ${listing.model}`,
          quantity: f.quantity,
          unitPrice: listing.price ?? '1000000.00',
        },
        { label: 'Transport et mise en service', quantity: 1, unitPrice: '250000.00' },
      ],
      '19',
    );
    await prisma.quotation.create({
      data: {
        id: randomUUID(),
        reference: await nextRef(prisma, 'QT'),
        organizationId: supplier.id,
        businessOrgId: b.id,
        requestId,
        listingId: listingIds[f.listing]!,
        issuedById: supplier.userId,
        lines: totals.lines as unknown as object[],
        subtotal: totals.subtotal,
        vatRate: '19',
        vatAmount: totals.vatAmount,
        total: totals.total,
        validUntil: new Date(`${isoDay(f.outcome === 'QUOTED' ? 20 : 10)}T00:00:00Z`),
        deliveryTerms: 'Livraison sur site sous 3 semaines (démo)',
        status:
          f.outcome === 'ACCEPTED' ? 'ACCEPTED' : f.outcome === 'DECLINED' ? 'DECLINED' : 'ISSUED',
        decidedAt: f.outcome === 'ACCEPTED' || f.outcome === 'DECLINED' ? new Date() : null,
      },
    });
  }

  // A few favourites.
  const tassili = biz('Tassili Agro Transformation EURL (fictif)');
  for (const i of [9, 11, 12]) {
    await prisma.favourite.create({
      data: { organizationId: tassili.id, userId: tassili.userId, listingId: listingIds[i]! },
    });
  }

  const photos = store
    ? storageError
      ? `photos skipped (storage unreachable: ${storageError})`
      : `${uploaded} placeholder photos`
    : 'photos skipped (S3_ENDPOINT not set)';
  return `${DEMO_LISTINGS.length} listings, ${flows.length} quotation requests, 3 favourites, ${photos}`;
}
