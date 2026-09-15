import { ArrayMaxSize, IsArray, IsString } from 'class-validator';

/**
 * A listing's videos in order: uploaded files already on it, and YouTube or
 * Vimeo links. The service refuses anything that is neither.
 */
export class SetListingVideosDto {
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  videoUrls: string[];
}
