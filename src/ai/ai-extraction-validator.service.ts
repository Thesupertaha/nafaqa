import { Injectable } from '@nestjs/common';

export interface RawExtraction {
  intent: string;
  amount: number | null;
  currency: string | null;
  merchant: string | null;
  category_hint: string | null;
  date_expression: string | null;
  payment_method_hint: string | null;
  location: string | null;
  notes: string | null;
  target_reference: string | null;
  confidence: number;
  ambiguity_flags: string[];
}

export interface CategoryRef {
  id: string;
  nameEn: string;
  nameAr: string;
}

export type ConfidenceBucket = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ValidatedExtraction {
  intent: string;
  amount: number | null;
  currencyCode: string | null;
  merchant: string | null;
  categoryId: string | null;
  categoryMatchWasAmbiguous: boolean;
  dateExpression: string | null;
  paymentMethodHint: string | null;
  location: string | null;
  notes: string | null;
  targetReference: string | null;
  confidenceBucket: ConfidenceBucket;
  rawModelConfidence: number;
  injectionSuspected: boolean;
}

const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |the )?(previous|prior|above) instructions/i,
  /disregard (all |the )?(previous|prior|above)/i,
  /system\s*:/i,
  /you are now/i,
  /new instructions?:/i,
  /override (the )?(confidence|category|rules?)/i,
  /<\/?(user_content|system|assistant)>/i, // attempts to break out of our own delimiter
];

const VALID_CURRENCY_CODES = new Set(['EGP', 'AED', 'SAR', 'USD', 'EUR']);

@Injectable()
export class AiExtractionValidatorService {
  /**
   * screenForInjection
   *
   * Deterministic pre-screen run BEFORE the LLM call, per Security Review
   * Section 10. Never blocks a message outright (a legitimate merchant name
   * could coincidentally match a pattern) — flags it so the resulting
   * extraction is forced into LOW confidence regardless of what the model
   * itself reports.
   */
  screenForInjection(rawMessage: string): boolean {
    return INJECTION_PATTERNS.some((pattern) => pattern.test(rawMessage));
  }

  /**
   * validate
   *
   * Treats the LLM's raw output as untrusted input, exactly like any
   * user-submitted API payload (AI System Design Section 9): currency must
   * exist in our reference table, category_hint is fuzzy-matched against
   * this user's REAL categories (never invented), and the final confidence
   * bucket is a composite of model confidence, field completeness, and
   * grounding match quality — not the model's self-report alone.
   */
  validate(
    raw: RawExtraction,
    userCategories: CategoryRef[],
    injectionSuspected: boolean,
  ): ValidatedExtraction {
    const currencyCode = this.resolveCurrency(raw.currency);
    const { categoryId, wasAmbiguous } = this.resolveCategory(raw.category_hint, userCategories);

    const fieldsComplete =
      raw.intent !== 'LOG_EXPENSE' || (raw.amount !== null && raw.amount > 0 && currencyCode !== null);

    const confidenceBucket = this.computeConfidenceBucket({
      modelConfidence: raw.confidence,
      fieldsComplete,
      categoryResolvedCleanly: raw.category_hint === null || (categoryId !== null && !wasAmbiguous),
      ambiguityFlagCount: raw.ambiguity_flags.length,
      injectionSuspected,
    });

    return {
      intent: raw.intent,
      amount: raw.amount !== null && raw.amount > 0 ? raw.amount : null,
      currencyCode,
      merchant: this.sanitizeFreeText(raw.merchant),
      categoryId,
      categoryMatchWasAmbiguous: wasAmbiguous,
      dateExpression: raw.date_expression,
      paymentMethodHint: raw.payment_method_hint,
      location: this.sanitizeFreeText(raw.location),
      notes: this.sanitizeFreeText(raw.notes),
      targetReference: raw.target_reference,
      confidenceBucket,
      rawModelConfidence: raw.confidence,
      injectionSuspected,
    };
  }

  private resolveCurrency(currency: string | null): string | null {
    if (!currency) return null;
    const upper = currency.toUpperCase();
    return VALID_CURRENCY_CODES.has(upper) ? upper : null;
  }

  /**
   * resolveCategory
   *
   * Simple, dependency-free fuzzy matching (token-overlap scoring) against
   * the user's REAL category names — the model never supplies a category
   * ID directly (AI System Design Section 4's "hints, not IDs" rule), so
   * this function is the only place a category_id is ever assigned from AI
   * input.
   */
  private resolveCategory(
    hint: string | null,
    categories: CategoryRef[],
  ): { categoryId: string | null; wasAmbiguous: boolean } {
    if (!hint) return { categoryId: null, wasAmbiguous: false };

    const normalizedHint = hint.toLowerCase().trim();
    const scored = categories
      .map((category) => ({
        category,
        score: Math.max(
          this.tokenOverlapScore(normalizedHint, category.nameEn.toLowerCase()),
          this.tokenOverlapScore(normalizedHint, category.nameAr.toLowerCase()),
        ),
      }))
      .filter((entry) => entry.score > 0.3)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return { categoryId: null, wasAmbiguous: false };

    const top = scored[0];
    const runnerUp = scored[1];
    const isAmbiguous = runnerUp !== undefined && runnerUp.score >= top.score - 0.05;

    return { categoryId: isAmbiguous ? null : top.category.id, wasAmbiguous: isAmbiguous };
  }

  private tokenOverlapScore(a: string, b: string): number {
    if (a === b) return 1;
    if (b.includes(a) || a.includes(b)) return 0.85;

    const tokensA = new Set(a.split(/\s+/));
    const tokensB = new Set(b.split(/\s+/));
    const intersection = [...tokensA].filter((t) => tokensB.has(t));
    const union = new Set([...tokensA, ...tokensB]);
    return union.size === 0 ? 0 : intersection.length / union.size;
  }

  private computeConfidenceBucket(params: {
    modelConfidence: number;
    fieldsComplete: boolean;
    categoryResolvedCleanly: boolean;
    ambiguityFlagCount: number;
    injectionSuspected: boolean;
  }): ConfidenceBucket {
    // An injection-flagged message is NEVER auto-saved, full stop —
    // regardless of how confident the model claims to be.
    if (params.injectionSuspected) return 'LOW';
    if (!params.fieldsComplete) return 'LOW';
    if (params.ambiguityFlagCount > 1) return 'LOW';

    if (
      params.modelConfidence >= 0.85 &&
      params.categoryResolvedCleanly &&
      params.ambiguityFlagCount === 0
    ) {
      return 'HIGH';
    }

    if (params.modelConfidence >= 0.6) return 'MEDIUM';
    return 'LOW';
  }

  private sanitizeFreeText(value: string | null): string | null {
    if (!value) return null;
    // Basic length cap + strip control characters — these fields are
    // display-only and never used in downstream query/logic construction
    // (AI System Design Section 9), but capped defensively regardless.
    // eslint-disable-next-line no-control-regex
    return value.replace(/[\x00-\x1F\x7F]/g, '').slice(0, 256);
  }
}
