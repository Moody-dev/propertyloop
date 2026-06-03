import {
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
