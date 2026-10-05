import { Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PinoLogger } from 'nestjs-pino';
import type { Environment } from '../../config/environment';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');
export interface ObjectStorage {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  signedUrl(key: string): Promise<string>;
  discard(key: string): Promise<void>;
}
@Injectable()
class S3Storage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly publicClient: S3Client;
  private readonly bucket: string;
  constructor(
    config: ConfigService<Environment, true>,
    private readonly logger: PinoLogger,
  ) {
    const options = {
      region: config.get('S3_REGION', { infer: true }),
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.get('MINIO_ACCESS_KEY', { infer: true }),
        secretAccessKey: config.get('MINIO_SECRET_KEY', { infer: true }),
      },
      maxAttempts: 2,
    };
    this.client = new S3Client({
      ...options,
      endpoint: config.get('MINIO_ENDPOINT', { infer: true }),
    });
    this.publicClient = new S3Client({
      ...options,
      endpoint:
        config.get('MINIO_PUBLIC_ENDPOINT', { infer: true }) ??
        config.get('MINIO_ENDPOINT', { infer: true }),
    });
    this.bucket = config.get('MINIO_BUCKET', { infer: true });
  }
  async put(key: string, bytes: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        CacheControl: 'private, max-age=300',
      }),
      { abortSignal: AbortSignal.timeout(10000) },
    );
  }
  signedUrl(key: string) {
    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: 300 },
    );
  }
  async discard(key: string) {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }), {
        abortSignal: AbortSignal.timeout(5000),
      });
    } catch {
      this.logger.warn({ objectKey: key }, 'Object cleanup deferred; run orphan reconciliation');
    }
  }
}
@Module({
  providers: [{ provide: OBJECT_STORAGE, useClass: S3Storage }],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
