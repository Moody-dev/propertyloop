import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { B2Service } from '../storage/b2.service';

@Controller('upload')
export class UploadController {
  constructor(private readonly b2Service: B2Service) {}

  @Post('profile-picture')
  @UseInterceptors(FileInterceptor('file'))
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
}
