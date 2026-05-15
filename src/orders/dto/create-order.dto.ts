import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { OrderPaymentMethod } from '../../../generated/prisma/client';
import { NormalizePhone } from '../../common/phone';

export class OrderItemDto {
  @IsString() @IsNotEmpty() productId: string;
  @Type(() => Number) @IsInt() @Min(1) quantity: number;
}

export class CreateOrderDto {
  @IsString() @IsNotEmpty() @MaxLength(120) recipientName: string;
  @NormalizePhone() @IsString() @IsNotEmpty() @MaxLength(40) phone: string;
  @IsString() @IsNotEmpty() @MaxLength(240) address: string;
  @IsString() @IsNotEmpty() @MaxLength(60) city: string;
  @IsString() @IsOptional() @MaxLength(500) notes?: string;

  @IsEnum(OrderPaymentMethod) payMethod: OrderPaymentMethod;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
}
