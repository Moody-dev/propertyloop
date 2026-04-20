import { Injectable, BadRequestException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import * as crypto from 'crypto';

@Injectable()
export class B2Service implements OnModuleInit {
  private s3Client: S3Client;
  private bucketName: string;
  private endpoint: string;
  private accountId: string;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    this.bucketName = this.configService.get<string>('R2_BUCKET_NAME');
    const accessKeyId = this.configService.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('R2_SECRET_ACCESS_KEY');
    this.accountId = this.configService.get<string>('R2_ACCOUNT_ID');
    this.endpoint = this.configService.get<string>('R2_ENDPOINT');

    if (!accessKeyId || !secretAccessKey || !this.bucketName || !this.accountId || !this.endpoint) {
      console.warn('R2 credentials not configured. File uploads will be disabled.');
      return;
    }

    try {
      this.s3Client = new S3Client({
        region: 'auto',
        endpoint: this.endpoint,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
      console.log('R2 storage initialized successfully');
    } catch (error: any) {
      console.warn(`R2 initialization failed: ${error.message}. File uploads will be disabled.`);
    }
  }

  async uploadFile(
    file: any,
    folderPath: string,
  ): Promise<{ fileName: string; fileId: string; fileUrl: string }> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    if (!this.s3Client || !this.bucketName) {
      throw new BadRequestException('File storage service is not available. Please configure R2 credentials.');
    }

    // Validate file size (max 50MB)
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException('File size exceeds 50MB limit');
    }

    // Generate unique filename
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    const ext = file.originalname.split('.').pop();
    const fileName = `${timestamp}-${random}.${ext}`;
    const fullPath = `${folderPath}/${fileName}`;

    try {
      // Upload file to R2
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: fullPath,
          Body: file.buffer,
          ContentType: file.mimetype,
        }),
      );

      // Construct public URL
      const fileUrl = `${this.endpoint}/${this.bucketName}/${fullPath}`;

      return {
        fileName: fullPath,
        fileId: fullPath, // R2 uses the key as the file ID
        fileUrl,
      };
    } catch (error: any) {
      throw new BadRequestException(
        `File upload failed: ${error.message || 'Unknown error'}`,
      );
    }
  }

  async deleteFile(fileName: string): Promise<void> {
    if (!this.s3Client || !this.bucketName) {
      console.warn('R2 not initialized. Cannot delete file.');
      return;
    }

    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: fileName,
        }),
      );
    } catch (error: any) {
      console.error(`Failed to delete file ${fileName}:`, error);
    }
  }
}
