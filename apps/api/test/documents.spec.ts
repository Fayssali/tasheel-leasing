import { ConfigService } from '@nestjs/config';
import { createServer, type Server } from 'node:net';
import type { TenantInfo } from '../src/common/request-context';
import {
  checklist,
  DocumentsService,
  type DocumentTypeRow,
} from '../src/documents/documents.service';
import { ClamAvScanner, parseClamdReply } from '../src/storage/scanner';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n');
const EICAR = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
const ORG = '0193a1b2-0000-7000-8000-0000000000aa';
const meta = { ipAddress: null, userAgent: null };
const tenant = (perms: string[] = ['document.manage'], org = ORG): TenantInfo => ({
  userId: '0193a1b2-0000-7000-8000-000000000001',
  organizationId: org,
  organizationType: 'BUSINESS',
  organizationStatus: 'VERIFIED',
  permissions: new Set(perms),
});
const file = (buffer: Buffer, originalname = 'statuts.pdf') =>
  ({ buffer, size: buffer.length, originalname }) as Express.Multer.File;

const TYPES: DocumentTypeRow[] = [
  {
    code: 'rc_extract',
    name: { fr: 'Extrait RC' },
    ownerTypes: ['BUSINESS', 'SUPPLIER'],
    requiredForVerification: ['BUSINESS'],
    requiredForApplication: false,
    hasExpiry: false,
    isActive: true,
    sortOrder: 0,
  },
  {
    code: 'tax_clearance',
    name: { fr: 'Situation fiscale' },
    ownerTypes: ['BUSINESS'],
    requiredForVerification: [],
    requiredForApplication: true,
    hasExpiry: true,
    isActive: true,
    sortOrder: 1,
  },
  {
    code: 'bank_only',
    name: { fr: 'Agrément' },
    ownerTypes: ['FINANCIAL_INSTITUTION'],
    requiredForVerification: [],
    requiredForApplication: false,
    hasExpiry: false,
    isActive: true,
    sortOrder: 2,
  },
];

describe('ClamAV adapter', () => {
  let server: Server;
  let port: number;
  beforeAll(async () => {
    // Minimal clamd: reads INSTREAM chunks until the zero-length terminator, then answers.
    server = createServer((socket) => {
      let buf = Buffer.alloc(0);
      socket.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        if (!buf.subarray(0, 10).equals(Buffer.from('zINSTREAM\0'))) return;
        let off = 10;
        const parts: Buffer[] = [];
        while (off + 4 <= buf.length) {
          const len = buf.readUInt32BE(off);
          if (len === 0) {
            const body = Buffer.concat(parts);
            socket.end(
              body.includes(Buffer.from('EICAR'))
                ? 'stream: Eicar-Test-Signature FOUND\0'
                : 'stream: OK\0',
            );
            return;
          }
          if (off + 4 + len > buf.length) return;
          parts.push(buf.subarray(off + 4, off + 4 + len));
          off += 4 + len;
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const scanner = () =>
    new ClamAvScanner(new ConfigService({ CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: String(port) }));

  it('reports clean and infected files over the INSTREAM protocol', async () => {
    await expect(scanner().scan(PDF)).resolves.toEqual({ status: 'CLEAN' });
    await expect(scanner().scan(Buffer.concat([Buffer.alloc(200_000), EICAR]))).resolves.toEqual({
      status: 'INFECTED',
      signature: 'Eicar-Test-Signature',
    });
  });

  it('refuses the upload when clamd is unreachable', async () => {
    const down = new ClamAvScanner(
      new ConfigService({ CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: '1' }),
    );
    await expect(down.scan(PDF)).rejects.toMatchObject({ response: { code: 'SCAN_UNAVAILABLE' } });
  });

  it('parses clamd replies strictly', () => {
    expect(parseClamdReply('stream: OK\0')).toEqual({ status: 'CLEAN' });
    expect(parseClamdReply('stream: Win.Test.EICAR_HDB-1 FOUND\0')).toEqual({
      status: 'INFECTED',
      signature: 'Win.Test.EICAR_HDB-1',
    });
    expect(() => parseClamdReply('INSTREAM size limit exceeded. ERROR')).toThrow();
  });
});

function setup(verdict: 'CLEAN' | 'INFECTED' | 'NOT_SCANNED' = 'CLEAN') {
  const created: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  const audits: string[] = [];
  const stored: string[] = [];
  const existing = { typeCode: 'rc_extract' };
  const tx = {
    documentType: { findMany: async () => TYPES },
    document: {
      create: async ({ data }: { data: Record<string, unknown> }) => void created.push(data),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
        void updated.push({ id: where.id, ...data }),
      findFirst: async () => existing,
      findUnique: async () => ({
        organizationId: 'other-org',
        storageKey: 'k',
        mimeType: 'application/pdf',
        fileName: 'x.pdf',
        scanStatus: 'CLEAN',
      }),
    },
  };
  const prisma = {
    forTenant: async (_: unknown, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  const service = new DocumentsService(
    prisma as never,
    { record: async (_: unknown, e: { action: string }) => void audits.push(e.action) } as never,
    {
      put: async (key: string) => void stored.push(key),
      get: async () => ({ body: null, contentType: '' }),
    } as never,
    {
      scan: async () =>
        verdict === 'INFECTED' ? { status: 'INFECTED', signature: 'Eicar' } : { status: verdict },
    } as never,
    { notifyOrg: async () => undefined } as never,
  );
  return { service, created, updated, audits, stored };
}

describe('document vault', () => {
  it('stores a clean PDF with its hash and scan result', async () => {
    const { service, created, stored, audits } = setup();
    await expect(
      service.upload(tenant(), file(PDF), { typeCode: 'rc_extract' }, meta),
    ).resolves.toMatchObject({ scanStatus: 'CLEAN' });
    expect(stored[0]).toMatch(new RegExp(`^org/${ORG}/documents/.+\\.pdf$`));
    expect(created[0]).toMatchObject({
      typeCode: 'rc_extract',
      mimeType: 'application/pdf',
      scanStatus: 'CLEAN',
      title: 'statuts.pdf',
    });
    expect(created[0]!.sha256).toHaveLength(64);
    expect(audits).toEqual(['document.uploaded']);
  });

  it('refuses an infected file, stores nothing and records the attempt', async () => {
    const { service, created, stored, audits } = setup('INFECTED');
    await expect(
      service.upload(tenant(), file(PDF), { typeCode: 'rc_extract' }, meta),
    ).rejects.toMatchObject({ response: { code: 'FILE_INFECTED' } });
    expect(stored).toHaveLength(0);
    expect(created).toHaveLength(0);
    expect(audits).toEqual(['document.infected_rejected']);
  });

  it('checks the real file type and the document types allowed for the organization', async () => {
    const { service } = setup();
    await expect(
      service.upload(
        tenant(),
        file(Buffer.from('MZ\x90\x00 executable'), 'rc.pdf'),
        { typeCode: 'rc_extract' },
        meta,
      ),
    ).rejects.toMatchObject({
      response: { code: 'FILE_TYPE_NOT_ALLOWED' },
    });
    await expect(
      service.upload(tenant(), file(PDF), { typeCode: 'bank_only' }, meta),
    ).rejects.toMatchObject({ response: { code: 'DOCUMENT_TYPE_NOT_ALLOWED' } });
    await expect(
      service.upload(
        tenant(),
        file(PDF),
        { typeCode: 'tax_clearance', expiresOn: '2020-01-01' },
        meta,
      ),
    ).rejects.toMatchObject({
      response: { code: 'DOCUMENT_EXPIRED' },
    });
  });

  it('replaces a document by superseding it, never deleting it', async () => {
    const { service, updated, audits } = setup();
    const res = await service.upload(
      tenant(),
      file(PDF),
      { typeCode: 'rc_extract', replacesId: 'old-id' },
      meta,
    );
    expect(updated).toEqual([{ id: 'old-id', supersededById: res.id }]);
    expect(audits).toEqual(['document.replaced']);
    await expect(
      service.upload(
        tenant(),
        file(PDF),
        { typeCode: 'tax_clearance', replacesId: 'old-id' },
        meta,
      ),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_REPLACEMENT' },
    });
  });

  it('lets reviewers download what RLS shows them, and records downloads by others', async () => {
    const { service, audits } = setup();
    await expect(service.download(tenant(['organization.read']), 'd1', meta)).rejects.toMatchObject(
      { response: { code: 'PERMISSION_DENIED' } },
    );
    await service.download(tenant(['application.review'], 'bank-org'), 'd1', meta);
    expect(audits).toEqual(['document.downloaded']);
  });

  it('requires a reason to reject a document', async () => {
    const { service } = setup();
    await expect(
      service.review(tenant(['admin.document.review']), 'd1', 'reject', '  ', meta),
    ).rejects.toMatchObject({ response: { code: 'REASON_REQUIRED' } });
  });

  it('builds the verification and application checklists from the database rules', () => {
    const list = checklist(
      TYPES,
      [
        { typeCode: 'rc_extract', reviewStatus: 'ACCEPTED', expiresOn: null },
        { typeCode: 'tax_clearance', reviewStatus: 'PENDING', expiresOn: new Date('2020-01-01') },
      ],
      'BUSINESS',
    );
    expect(list.verification).toEqual([{ typeCode: 'rc_extract', state: 'ACCEPTED' }]);
    expect(list.application).toEqual([{ typeCode: 'tax_clearance', state: 'EXPIRED' }]);
  });
});
