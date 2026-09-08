import { Injectable, BadRequestException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as crypto from 'crypto';
import {
  isHeicBuffer,
  heicBufferToJpeg,
  jpegFilename,
  HEIC_SNIFF_BYTES,
} from '../media/heic';

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
        // Cloudflare R2 does not understand AWS SDK v3's "always-on"
        // request checksum behaviour. With the default ("WHEN_SUPPORTED")
        // the SDK signs every PutObject URL with x-amz-checksum-crc32 and
        // x-amz-sdk-checksum-algorithm headers, and R2 then resets the
        // connection mid-stream once the body bytes start flowing.
        // Switching to WHEN_REQUIRED only adds checksums when the caller
        // explicitly asks for one, which is what R2 (and most other S3-
        // compatible services) actually want.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
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

    // iPhone photos arrive as HEIC, which only Safari can render. Convert
    // before the bytes are stored so nothing unviewable ever lands in the
    // bucket. Detection reads the magic bytes, not the name or mime type —
    // iOS routinely presents a HEIC as "photo.jpg" with Content-Type
    // image/jpeg, which is how unviewable images got stored in the first place.
    let body: Buffer = file.buffer;
    let contentType: string = file.mimetype;
    let originalName: string = file.originalname;
    if (isHeicBuffer(body)) {
      try {
        body = await heicBufferToJpeg(body);
        contentType = 'image/jpeg';
        originalName = jpegFilename(originalName);
      } catch (err: any) {
        throw new BadRequestException(
          `Could not process this HEIC image: ${err.message || 'conversion failed'}`,
        );
      }
    }

    // Generate unique filename
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    const ext = originalName.split('.').pop();
    const fileName = `${timestamp}-${random}.${ext}`;
    const fullPath = `${folderPath}/${fileName}`;

    try {
      // Upload file to R2
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: fullPath,
          Body: body,
          ContentType: contentType,
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

  /** The public base URL objects are reachable at (no trailing slash). */
  getPublicBaseUrl(): string {
    return this.publicUrl
      ? this.publicUrl.replace(/\/$/, '')
      : `${this.endpoint}/${this.bucketName}`;
  }

  /**
   * Read an object's raw bytes straight from R2 (server-side GetObject), used
   * by the watermark proxy. Returns the buffer plus its stored content-type.
   *
   * `rangeBytes` fetches only a leading slice (an HTTP Range request), which is
   * how format sniffing avoids pulling whole multi-megabyte photos down just to
   * read their first few bytes.
   */
  async getObjectBuffer(
    key: string,
    rangeBytes?: number,
  ): Promise<{ buffer: Buffer; contentType?: string }> {
    if (!this.s3Client || !this.bucketName) {
      throw new BadRequestException('File storage service is not available.');
    }
    const res = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        ...(rangeBytes && { Range: `bytes=0-${rangeBytes - 1}` }),
      }),
    );
    const body = res.Body as
      | { transformToByteArray?: () => Promise<Uint8Array> }
      | undefined;
    if (!body?.transformToByteArray) {
      throw new BadRequestException('Object stream unavailable');
    }
    const bytes = await body.transformToByteArray();
    return { buffer: Buffer.from(bytes), contentType: res.ContentType };
  }

  /**
   * Rewrites any HEIC objects among `urlsOrKeys` as JPEG, in place under the
   * same key — so the caller's stored URLs keep working untouched.
   *
   * Presigned uploads (listing photos, vendor portfolios) go straight from the
   * browser to R2, so uploadFile's conversion never sees them. Callers invoke
   * this right after persisting the URLs to catch those.
   *
   * Best-effort by design: it is called fire-and-forget after a save that has
   * already succeeded, so a failure here must never surface to the user. The
   * backfill script re-runs the same conversion over anything missed.
   */
  async normalizeHeicObjects(urlsOrKeys: (string | null | undefined)[]): Promise<number> {
    if (!this.s3Client || !this.bucketName) return 0;

    const base = this.getPublicBaseUrl().replace(/\/$/, '');
    const keys = (urlsOrKeys ?? [])
      .filter((u): u is string => !!u)
      .map((u) => {
        const bare = u.split('?')[0];
        return base && bare.startsWith(base + '/') ? bare.slice(base.length + 1) : bare;
      })
      // Only our own keys; anything absolute is someone else's host.
      .filter((k) => k && !/^https?:\/\//i.test(k) && !k.includes('..'));

    // Sniff the container from a 32-byte Range request rather than downloading
    // each object in full. Almost every upload is already a JPEG, so pulling
    // whole photos down to read twelve bytes moved megabytes per listing save
    // to decide, nearly always, that there was nothing to do. The sniffs are
    // cheap enough to run together.
    const sniffs = await Promise.all(
      keys.map(async (key) => {
        try {
          const { buffer } = await this.getObjectBuffer(key, HEIC_SNIFF_BYTES);
          return isHeicBuffer(buffer) ? key : null;
        } catch (err: any) {
          console.warn(`HEIC sniff skipped for ${key}: ${err.message}`);
          return null;
        }
      }),
    );
    const heicKeys = sniffs.filter((k): k is string => k !== null);
    if (heicKeys.length === 0) return 0;

    // Conversions run one at a time on purpose. Decoding a 12MP HEIC holds the
    // raw bitmap in memory — roughly 36MB before sharp re-encodes it — so a
    // gallery uploaded entirely from an iPhone would otherwise decode every
    // photo at once and could exhaust the container.
    let converted = 0;
    for (const key of heicKeys) {
      try {
        const { buffer } = await this.getObjectBuffer(key);
        const jpeg = await heicBufferToJpeg(buffer);
        await this.s3Client.send(
          new PutObjectCommand({
            Bucket: this.bucketName,
            Key: key,
            Body: jpeg,
            ContentType: 'image/jpeg',
          }),
        );
        converted++;
        console.log(`Converted HEIC upload to JPEG: ${key}`);
      } catch (err: any) {
        console.warn(`HEIC normalize skipped for ${key}: ${err.message}`);
      }
    }
    return converted;
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
