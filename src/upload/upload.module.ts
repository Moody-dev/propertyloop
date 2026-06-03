import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { AuthModule } from '../auth/auth.module';
import { UploadController } from './upload.controller';

@Module({
  imports: [StorageModule, AuthModule],
  controllers: [UploadController],
})
export class UploadModule {}
