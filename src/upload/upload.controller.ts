import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { B2Service } from '../storage/b2.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('upload')
export class UploadController {
  constructor(private readonly b2Service: B2Service) {}

  @Post('profile-picture')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  async uploadProfilePicture(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('File must be an image');
    }

    const result = await this.b2Service.uploadFile(file, 'profile-pictures');

    return {
      url: result.fileUrl,
      fileName: result.fileName,
      fileId: result.fileId,
    };
  }

  @Post('job-attachment')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }),
  )
  async uploadJobAttachment(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    const isImage = file.mimetype.startsWith('image/');
    const isVideo = file.mimetype.startsWith('video/');
    if (!isImage && !isVideo) {
      throw new BadRequestException('File must be an image or a video');
    }
    const folder = isVideo ? 'job-attachments-videos' : 'job-attachments';
    const result = await this.b2Service.uploadFile(file, folder);
    return {
      url: result.fileUrl,
      fileName: result.fileName,
      fileId: result.fileId,
      mimeType: file.mimetype,
    };
  }

  @Post('featured-property-image')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  async uploadFeaturedPropertyImage(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('File must be an image');
    }
    const result = await this.b2Service.uploadFile(file, 'featured-properties');
    return {
      url: result.fileUrl,
      fileName: result.fileName,
      fileId: result.fileId,
    };
  }

  @Post('featured-property-video')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 200 * 1024 * 1024 } }),
  )
  async uploadFeaturedPropertyVideo(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    if (!file.mimetype.startsWith('video/')) {
      throw new BadRequestException('File must be a video');
    }
    const result = await this.b2Service.uploadFile(
      file,
      'featured-properties-videos',
    );
    return {
      url: result.fileUrl,
      fileName: result.fileName,
      fileId: result.fileId,
    };
  }

  // Brand-ad creatives — advertisers are signed-in users, so require auth.
  @UseGuards(JwtAuthGuard)
  @Post('ad-image')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  async uploadAdImage(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('File must be an image');
    }
    const result = await this.b2Service.uploadFile(file, 'brand-ads');
    return {
      url: result.fileUrl,
      fileName: result.fileName,
      fileId: result.fileId,
    };
  }

  // KYC documents are sensitive — require auth (unlike the public upload routes).
  @UseGuards(JwtAuthGuard)
  @Post('kyc-document')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  async uploadKycDocument(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    const isImage = file.mimetype.startsWith('image/');
    const isPdf = file.mimetype === 'application/pdf';
    if (!isImage && !isPdf) {
      throw new BadRequestException('File must be an image or PDF');
    }
    const result = await this.b2Service.uploadFile(file, 'kyc-documents');
    return {
      url: result.fileUrl,
      fileName: result.fileName,
      fileId: result.fileId,
      mimeType: file.mimetype,
    };
  }

  // Social feed post photos — require auth (posts are user-generated).
  @UseGuards(JwtAuthGuard)
  @Post('feed-image')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  async uploadFeedImage(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('File must be an image');
    }
    const result = await this.b2Service.uploadFile(file, 'feed-images');
    return {
      url: result.fileUrl,
      fileName: result.fileName,
      fileId: result.fileId,
    };
  }

  /**
   * Presigned direct-to-R2 PUT for a chat attachment. Mobile clients use this
   * instead of the multipart route below: proxying multipart/form-data through
   * the API dropped mid-stream on mobile networks ("Network Error"), which is
   * why image attachments were failing. The bytes go straight to storage.
   */
  /**
   * Presigned direct-to-R2 PUT for a profile picture. Mobile clients must use
   * this rather than the multipart /upload/profile-picture route: proxying
   * multipart/form-data through the API drops mid-stream on mobile networks
   * ("Network Error"), the same reason chat + listing uploads went presigned.
   * Guarded — only a signed-in user sets their own avatar.
   */
  /**
   * Presigned direct-to-R2 PUT for a feed post video.
   *
   * Presigned rather than multipart like /upload/feed-image: a 50MB clip
   * proxied through Nest would hit the edge request timeout, which is the same
   * reason listing videos, chat attachments and avatars all went presigned.
   * The size is advisory (the client reports it) — the hard ceiling is the
   * 100MB check in B2Service.uploadFile plus the bucket's own limits.
   */
  @UseGuards(JwtAuthGuard)
  @Post('feed-video/presign')
  async presignFeedVideo(
    @Body() body: { filename?: string; contentType?: string; size?: number },
  ) {
    const contentType = body?.contentType ?? '';
    if (!contentType.startsWith('video/')) {
      throw new BadRequestException('File must be a video');
    }
    if (typeof body.size === 'number' && body.size > 50 * 1024 * 1024) {
      throw new BadRequestException('Video must be 50MB or smaller');
    }
    const filename = body?.filename ?? `feed-video-${Date.now()}.mp4`;
    const { uploadUrl, fileUrl } = await this.b2Service.getPresignedPutUrl({
      folder: 'feed-videos',
      filename,
      contentType,
    });
    return { uploadUrl, fileUrl };
  }

  @UseGuards(JwtAuthGuard)
  @Post('avatar/presign')
  async presignAvatar(
    @Body() body: { filename?: string; contentType?: string },
  ) {
    const contentType = body?.contentType ?? '';
    if (!contentType.startsWith('image/')) {
      throw new BadRequestException('File must be an image');
    }
    const filename = body?.filename ?? `avatar-${Date.now()}.jpg`;
    const { uploadUrl, fileUrl } = await this.b2Service.getPresignedPutUrl({
      folder: 'profile-pictures',
      filename,
      contentType,
    });
    return { uploadUrl, fileUrl };
  }

  @Post('message-attachment/presign')
  async presignMessageAttachment(
    @Body() body: { filename?: string; contentType?: string },
  ) {
    const contentType = body?.contentType ?? '';
    const isImage = contentType.startsWith('image/');
    const isPdf = contentType === 'application/pdf';
    if (!isImage && !isPdf) {
      throw new BadRequestException('File must be an image or PDF');
    }
    const filename = body?.filename ?? `attachment-${Date.now()}`;
    const { uploadUrl, fileUrl } = await this.b2Service.getPresignedPutUrl({
      folder: 'message-attachments',
      filename,
      contentType,
    });
    return { uploadUrl, fileUrl, mimeType: contentType };
  }

  @Post('message-attachment')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }),
  )
  async uploadMessageAttachment(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    const isImage = file.mimetype.startsWith('image/');
    const isPdf = file.mimetype === 'application/pdf';
    if (!isImage && !isPdf) {
      throw new BadRequestException('File must be an image or PDF');
    }
    const result = await this.b2Service.uploadFile(file, 'message-attachments');
    return {
      url: result.fileUrl,
      fileName: result.fileName,
      fileId: result.fileId,
      mimeType: file.mimetype,
    };
  }
}
