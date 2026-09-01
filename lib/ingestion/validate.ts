import { APPROVED_DOMAIN, isApprovedUrl } from "../../config/sources";
import type { RawSourceDocument, SchemeSource } from "../types";
import { EXTRACTION_METHOD, type ExtractedContent } from "./extract";

export const MIN_EXTRACTED_CHARACTERS = 200;

export class SourceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceValidationError";
  }
}

export function validateSourceUrl(url: string): void {
  if (!isApprovedUrl(url)) {
    throw new SourceValidationError(`URL is not in the approved corpus: ${url}`);
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new SourceValidationError(`URL must use https: ${url}`);
  }
  if (parsed.hostname !== APPROVED_DOMAIN) {
    throw new SourceValidationError(
      `URL must resolve to approved domain "${APPROVED_DOMAIN}": ${url}`
    );
  }
}

export function buildRawDocument(
  source: SchemeSource,
  extracted: ExtractedContent,
  fetchedAt: string = new Date().toISOString()
): RawSourceDocument {
  const text = extracted.text.trim();

  if (text.length === 0) {
    throw new SourceValidationError(
      `Extracted text is empty for scheme "${source.schemeId}"`
    );
  }

  if (text.length < MIN_EXTRACTED_CHARACTERS) {
    throw new SourceValidationError(
      `Extracted text too short for scheme "${source.schemeId}": ` +
        `${text.length} characters (minimum ${MIN_EXTRACTED_CHARACTERS})`
    );
  }

  const lowercased = text.toLowerCase();
  const matchedKeyword = source.identityKeywords.find((keyword) =>
    lowercased.includes(keyword.toLowerCase())
  );
  if (!matchedKeyword) {
    throw new SourceValidationError(
      `Scheme identity not found in extracted text for "${source.schemeId}": ` +
        `expected one of [${source.identityKeywords.join(", ")}]`
    );
  }

  validateSourceUrl(source.url);

  return {
    schemeId: source.schemeId,
    schemeName: source.schemeName,
    sourceUrl: source.url,
    sourceDomain: source.domain,
    fetchedAt,
    extraction: {
      method: EXTRACTION_METHOD,
      title: extracted.title,
      description: extracted.description,
      charCount: text.length,
      structuredFieldCount: extracted.structuredFieldCount,
    },
    extractedText: text,
  };
}