import { Module } from '@nestjs/common';
import { StorageModule } from './storage.module';
import { FileCleanupService } from './file-cleanup.service';
@Module({
  imports: [StorageModule],
  providers: [FileCleanupService],
  exports: [FileCleanupService],
})
export class FileCleanupModule {}
