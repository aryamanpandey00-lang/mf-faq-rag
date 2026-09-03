import { isApprovedUrl, getSourceByUrl } from "../../config/sources";
import type { RetrievalResult } from "../types";

export const MAX_ANSWER_SENTENCES = 3;

export function containsOnlyApprovedSources(
  results: RetrievalResult[]
): boolean {
  return results.every((result) => isApprovedUrl(result.sourceUrl));
}

export function distinctSourceUrls(results: RetrievalResult[]): string[] {
  return [...new Set(results.map((result) => result.sourceUrl))];
}

export interface SingleSourceOutcome {
  sourceUrl: string | null;
  schemeName: string | null;
  schemeId: string | null;
  valid: boolean;
}

export function resolveSingleSource(
  results: RetrievalResult[]
): SingleSourceOutcome {
  if (results.length === 0) {
    return { sourceUrl: null, schemeName: null, schemeId: null, valid: false };
  }

  const urls = distinctSourceUrls(results);
  if (urls.length !== 1) {
    return { sourceUrl: null, schemeName: null, schemeId: null, valid: false };
  }

  const sourceUrl = urls[0];
  if (!isApprovedUrl(sourceUrl)) {
    return { sourceUrl: null, schemeName: null, schemeId: null, valid: false };
  }

  const scheme = getSourceByUrl(sourceUrl);
  if (!scheme) {
    return { sourceUrl: null, schemeName: null, schemeId: null, valid: false };
  }

  return {
    sourceUrl,
    schemeName: scheme.schemeName,
    schemeId: scheme.schemeId,
    valid: true,
  };
}

export function lastUpdatedLine(lastUpdated: string | null): string {
  if (lastUpdated && lastUpdated.trim().length > 0) {
    return `Last updated from sources: ${lastUpdated.trim()}.`;
  }
  return "Last updated from sources: Date unavailable on source.";
}

const SENTENCE_BOUNDARY = /(?<=[.!?])\s+(?=[A-Z0-9"'(])/;

export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  const parts = trimmed.split(SENTENCE_BOUNDARY).filter((part) => part.trim().length > 0);
  return parts.length;
}

export function isWithinSentenceLimit(answer: string): boolean {
  return countSentences(answer) <= MAX_ANSWER_SENTENCES;
}

export function buildFinalAnswer(
  answer: string,
  sourceUrl: string,
  lastUpdated: string | null
): string {
  const lastUpdatedText = lastUpdatedLine(lastUpdated);
  return `${answer.trim()}\n\nSource: ${sourceUrl}\n${lastUpdatedText}`;
}

export const INSUFFICIENT_INFORMATION_MESSAGE =
  "I couldn't find enough information in the supported sources to answer that question.";

export const OUT_OF_SCOPE_MESSAGE =
  "I can only provide factual information about one supported scheme at a time. This question appears to require information from multiple sources, which I cannot combine into a single answer.";

export const INVESTMENT_ADVICE_REFUSAL_MESSAGE =
  "I provide factual information about mutual funds only and do not offer investment advice or recommendations.";
