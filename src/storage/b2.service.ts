import { Injectable, BadRequestException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as crypto from 'crypto';

@Injectable()
export class B2Service implements OnModuleInit {
  private s3Client: S3Client;
  private bucketName: string;
  private endpoint: string;
  private publicUrl: string;
  private accountId: string;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    this.bucketName = this.configService.get<string>('R2_BUCKET_NAME');
    const accessKeyId = this.configService.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('R2_SECRET_ACCESS_KEY');
    this.accountId = this.configService.get<string>('R2_ACCOUNT_ID');
    this.endpoint = this.configService.get<string>('R2_ENDPOINT');
    this.publicUrl = this.configService.get<string>('R2_PUBLIC_URL');

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

    // Per-route FileInterceptor enforces tighter caps (5MB profile pic,
    // 10MB photo/doc, 50MB video). Keep a generous global ceiling here as
    // a defence-in-depth check.
    const maxSize = 100 * 1024 * 1024;
    if (file.size > maxSize) {
      const sizeMb = (file.size / 1024 / 1024).toFixed(1);
      throw new BadRequestException(
        `File size ${sizeMb}MB exceeds the 100MB ceiling`,
      );
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

      // Construct public URL — prefer R2_PUBLIC_URL (e.g. https://pub-XXX.r2.dev
      // or a custom domain). The S3 endpoint requires signed requests and won't
      // load directly in <img> tags.
      const base = this.publicUrl
        ? this.publicUrl.replace(/\/$/, '')
        : `${this.endpoint}/${this.bucketName}`;
      const fileUrl = `${base}/${fullPath}`;

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

  /**
   * Mint a presigned PUT URL the browser can upload to directly. The byte
   * stream never touches our Nest server — useful for large files (videos)
   * where Render's request timeout would otherwise kill the proxied upload.
   *
   * Returns:
   *   - uploadUrl: time-limited presigned URL (must PUT with the same Content-Type)
   *   - fileUrl:   the public URL the file will be reachable at after upload
   *   - key:       the object key (in case the caller needs to delete later)
   */
  async getPresignedPutUrl(opts: {
    folder: string;
    filename: string;
    contentType: string;
    expiresIn?: number; // seconds; default 600 (10 min)
  }): Promise<{ uploadUrl: string; fileUrl: string; key: string }> {
    if (!this.s3Client || !this.bucketName) {
      throw new BadRequestException(
        'File storage service is not available. Please configure R2 credentials.',
      );
    }

    const ext = (opts.filename.split('.').pop() || 'bin').toLowerCase();
    const random = crypto.randomBytes(4).toString('hex');
    const key = `${opts.folder}/${Date.now()}-${random}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: opts.contentType,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, {
      expiresIn: opts.expiresIn ?? 600,
    });

    const base = this.publicUrl
      ? this.publicUrl.replace(/\/$/, '')
      : `${this.endpoint}/${this.bucketName}`;
    const fileUrl = `${base}/${key}`;

    return { uploadUrl, fileUrl, key };
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
