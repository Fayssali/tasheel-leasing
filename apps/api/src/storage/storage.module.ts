import { Global, Module } from '@nestjs/common';
import { S3Storage, Storage } from './storage';

@Global()
@Module({
  providers: [{ provide: Storage, useClass: S3Storage }],
  exports: [Storage],
})
export class StorageModule {}
