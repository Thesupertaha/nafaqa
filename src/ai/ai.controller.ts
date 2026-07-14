import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AiService } from './ai.service';
import { ChatMessageDto } from './dto/chat-message.dto';

@UseGuards(JwtAuthGuard)
@Controller({ path: 'ai/chat', version: '1' })
export class AiController {
  constructor(private readonly aiService: AiService) {}

  // Throttled distinctly from the global default — bounds per-user LLM
  // call volume, both for cost control and per the Security Review's
  // OWASP API4 (Unrestricted Resource Consumption) mitigation.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  send(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChatMessageDto) {
    return this.aiService.handleMessage(user.userId, dto.chatId, dto.message);
  }
}
