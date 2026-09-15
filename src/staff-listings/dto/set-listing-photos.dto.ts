import { ArrayMaxSize, IsArray, IsString } from 'class-validator';

/** A listing's photos in display order. The first one is the cover. */
export class SetListingPhotosDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  images: string[];
}
