import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Readable } from 'node:stream';

export interface StoredObject {
  body: Readable;
  contentType: string;
  contentLength?: number;
}

/**
 * Private object storage for uploaded files. The bucket is never public: files are served
 * through the API after an access check (RLS on the owning row).
 */
export abstract class Storage {
  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;
  abstract get(key: string): Promise<StoredObject>;
  abstract delete(key: string): Promise<void>;
}

/** S3-compatible storage: MinIO locally, an S3 provider (ideally hosted in Algeria) in production. */
@Injectable()
export class S3Storage extends Storage implements OnModuleInit {
  private readonly logger = new Logger(S3Storage.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    super();
    this.bucket = config.get<string>('S3_BUCKET_DOCUMENTS') ?? 'tasheel-documents';
    this.client = new S3Client({
      endpoint: config.get<string>('S3_ENDPOINT') ?? 'http://localhost:9000',
      region: config.get<string>('S3_REGION') ?? 'dz-local',
      forcePathStyle: true, // MinIO and most non-AWS providers
      credentials: {
        accessKeyId: config.get<string>('S3_ACCESS_KEY') ?? '',
        secretAccessKey: config.get<string>('S3_SECRET_KEY') ?? '',
      },
    });
  }

  /** Creates the bucket on first start in development; in production it is provisioned beforehand. */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created bucket ${this.bucket}`);
      } catch (err) {
        // Not fatal at boot: uploads will report the error. Keeps the API usable without storage.
        this.logger.warn(
          `Object storage unavailable: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: undefined,
      }),
    );
  }

  async get(key: string): Promise<StoredObject> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return {
      body: res.Body as Readable,
      contentType: res.ContentType ?? 'application/octet-stream',
      contentLength: res.ContentLength,
    };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
