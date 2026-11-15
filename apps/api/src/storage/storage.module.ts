import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClamAvScanner, DisabledScanner, Scanner } from './scanner';
import { S3Storage, Storage } from './storage';

@Global()
@Module({
  providers: [
    { provide: Storage, useClass: S3Storage },
    {
      provide: Scanner,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<string>('SCAN_MODE') === 'clamav'
          ? new ClamAvScanner(config)
          : new DisabledScanner(),
    },
  ],
  exports: [Storage, Scanner],
})
export class StorageModule {}
