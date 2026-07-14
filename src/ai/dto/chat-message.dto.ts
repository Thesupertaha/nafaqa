import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ChatMessageDto {
  @IsOptional()
  @IsUUID()
  chatId?: string; // omit to start a new chat thread

  @IsString()
  @MaxLength(2000)
  message!: string;
}
