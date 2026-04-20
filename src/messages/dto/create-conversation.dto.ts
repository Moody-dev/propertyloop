import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ConversationParticipantRole } from '../../../generated/prisma/client';

export class CreateConversationDto {
  /** The other user to start a conversation with */
  @IsString()
  @IsNotEmpty()
  recipientId: string;

  /** Role of the recipient in this conversation */
  @IsEnum(ConversationParticipantRole)
  @IsNotEmpty()
  recipientRole: ConversationParticipantRole;

  /** Role of the sender (current user) */
  @IsEnum(ConversationParticipantRole)
  @IsNotEmpty()
  senderRole: ConversationParticipantRole;

  /** Optional first message */
  @IsString()
  @IsOptional()
  text?: string;

  /** Optional context — what the conversation is about */
  @IsString()
  @IsOptional()
  listingId?: string;

  @IsString()
  @IsOptional()
  productId?: string;
}
