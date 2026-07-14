import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { nanoid } from 'nanoid';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';
import { AiExtractionValidatorService, RawExtraction } from './ai-extraction-validator.service';
import { buildSystemPrompt, wrapUserContent, EXTRACTION_FUNCTION_SCHEMA } from './prompts/system-prompt';
import { AppConfig } from '../config/configuration';

@Injectable()
export class AiService {
  private readonly logger = new Logger('AiService');
  private readonly client: OpenAI;

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionsService: TransactionsService,
    private readonly validator: AiExtractionValidatorService,
    configService: ConfigService<AppConfig, true>,
  ) {
    const openaiConfig = configService.get('openai', { infer: true });
    this.client = new OpenAI({ apiKey: openaiConfig.apiKey, baseURL: openaiConfig.baseUrl });
  }

  /**
   * handleMessage
   *
   * This is the ONLY path in the whole backend that talks to the LLM
   * provider — per the Security Review's Section 5/11 hard rule, the
   * mobile client never holds this credential and never calls the provider
   * directly. Every extraction, regardless of confidence, is validated
   * (AiExtractionValidatorService) before anything reaches the database.
   */
  async handleMessage(userId: string, chatId: string | undefined, message: string) {
    const chat = await this.getOrCreateChat(userId, chatId);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const categories = await this.prisma.category.findMany({
      where: { OR: [{ isSystem: true }, { userId }] },
    });

    await this.prisma.aiChatMessage.create({
      data: { chatId: chat.id, role: 'user', content: message },
    });

    const injectionSuspected = this.validator.screenForInjection(message);

    const raw = await this.callModel(user.preferredCountryCode ?? 'EG', categories, message);

    const validated = this.validator.validate(
      raw,
      categories.map((c: { id: string; nameEn: string; nameAr: string }) => ({
        id: c.id,
        nameEn: c.nameEn,
        nameAr: c.nameAr,
      })),
      injectionSuspected,
    );

    let createdTransaction = null as Awaited<ReturnType<TransactionsService['create']>> | null;
    let responseText: string;

    if (validated.intent === 'LOG_EXPENSE') {
      if (
        (validated.confidenceBucket === 'HIGH' || validated.confidenceBucket === 'MEDIUM') &&
        validated.amount &&
        validated.currencyCode
      ) {
        createdTransaction = await this.transactionsService.create(userId, {
          amount: validated.amount,
          currencyCode: validated.currencyCode,
          categoryId: validated.categoryId ?? undefined,
          merchantRaw: validated.merchant ?? undefined,
          description: validated.notes ?? undefined,
          transactionType: 'debit',
          sourceType: 'chat',
          occurredAt: new Date().toISOString(),
          idempotencyKey: nanoid(),
        });
        responseText = this.formatConfirmation(
          createdTransaction,
          user.preferredLanguage,
          validated.confidenceBucket === 'MEDIUM',
        );
      } else {
        responseText = this.buildClarifyingQuestion(validated);
      }
    } else if (validated.intent === 'CHITCHAT_OR_UNSUPPORTED') {
      responseText =
        user.preferredLanguage === 'ar'
          ? 'أقدر أساعدك في تسجيل أو البحث عن مصروفاتك. جرب تقولي مثلاً "دفعت ٥٠ جنيه مواصلات".'
          : "I can help you log or search your expenses — try something like 'spent 50 EGP on transport'.";
    } else {
      // SEARCH_QUERY / SUMMARY_REQUEST / EDIT_TRANSACTION / DELETE_TRANSACTION
      // route to their own dedicated handlers in a full implementation
      // (AI System Design Sections 10-13); represented here as a clear,
      // honest "not yet available in this endpoint" response rather than a
      // silent no-op, since a stubbed success response would be misleading.
      responseText =
        user.preferredLanguage === 'ar'
          ? 'هذا النوع من الطلبات (تعديل، حذف، بحث، أو ملخص) قيد التطوير في هذا الإصدار.'
          : 'Editing, deleting, searching, and summaries are handled by their own endpoints in the full app — this chat endpoint currently handles logging new expenses.';
    }

    await this.prisma.aiChatMessage.create({
      data: {
        chatId: chat.id,
        role: 'assistant',
        content: responseText,
        extractedPayload: JSON.parse(JSON.stringify(validated)),
        resultingTransactionId: createdTransaction?.id,
      },
    });

    return {
      chatId: chat.id,
      response: responseText,
      transaction: createdTransaction,
      confidenceBucket: validated.confidenceBucket,
      injectionSuspected,
    };
  }

  private async getOrCreateChat(userId: string, chatId?: string) {
    if (chatId) {
      const existing = await this.prisma.aiChat.findFirst({ where: { id: chatId, userId } });
      if (existing) return existing;
    }
    return this.prisma.aiChat.create({ data: { userId } });
  }

  private async callModel(
    market: string,
    categories: { nameEn: string }[],
    message: string,
  ): Promise<RawExtraction> {
    const systemPrompt = buildSystemPrompt({
      userMarket: market,
      categoryNames: categories.map((c) => c.nameEn),
    });

    try {
      const completion = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0, // deterministic extraction, not creative generation
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: wrapUserContent(message) },
        ],
        tools: [{ type: 'function', function: EXTRACTION_FUNCTION_SCHEMA }],
        tool_choice: { type: 'function', function: { name: 'extract_expense_data' } },
      });

      const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
      if (!toolCall) throw new Error('Model did not return a structured tool call');

      const parsed = JSON.parse(toolCall.function.arguments);
      return this.coerceRawExtraction(parsed);
    } catch (error) {
      this.logger.error('LLM extraction call failed, falling back to manual entry', error as Error);
      // Fallback per AI System Design Section 8: never fail silently — a
      // failed LLM call becomes a LOW-confidence "please clarify" result,
      // which the frontend renders as a manual-entry prompt.
      return {
        intent: 'LOG_EXPENSE',
        amount: null,
        currency: null,
        merchant: null,
        category_hint: null,
        date_expression: null,
        payment_method_hint: null,
        location: null,
        notes: null,
        target_reference: null,
        confidence: 0,
        ambiguity_flags: ['llm_unavailable'],
      };
    }
  }

  private coerceRawExtraction(parsed: unknown): RawExtraction {
    const p = parsed as Partial<RawExtraction>;
    return {
      intent: p.intent ?? 'CHITCHAT_OR_UNSUPPORTED',
      amount: typeof p.amount === 'number' ? p.amount : null,
      currency: p.currency ?? null,
      merchant: p.merchant ?? null,
      category_hint: p.category_hint ?? null,
      date_expression: p.date_expression ?? null,
      payment_method_hint: p.payment_method_hint ?? null,
      location: p.location ?? null,
      notes: p.notes ?? null,
      target_reference: p.target_reference ?? null,
      confidence: typeof p.confidence === 'number' ? p.confidence : 0,
      ambiguity_flags: Array.isArray(p.ambiguity_flags) ? p.ambiguity_flags : [],
    };
  }

  private formatConfirmation(
    transaction: { amount: unknown; currencyCode: string },
    language: string,
    needsReview = false,
  ): string {
    const reviewSuffix = needsReview
      ? language === 'ar'
        ? ' (تحقق من التفاصيل)'
        : ' (please double-check the details)'
      : '';
    return language === 'ar'
      ? `تم تسجيل ${transaction.amount} ${transaction.currencyCode}${reviewSuffix}`
      : `Logged ${transaction.amount} ${transaction.currencyCode}${reviewSuffix}`;
  }

  private buildClarifyingQuestion(validated: {
    amount: number | null;
    currencyCode: string | null;
  }): string {
    if (validated.amount === null) return 'How much did you spend?';
    if (validated.currencyCode === null) return 'What currency was that in?';
    return "I couldn't confidently log that — could you rephrase with the amount and currency?";
  }
}
