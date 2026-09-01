export interface SchemeSource {
  schemeId: string;
  schemeName: string;
  url: string;
  domain: string;
  identityKeywords: string[];
}

export interface ExtractionMetadata {
  method: string;
  title: string | null;
  description: string | null;
  charCount: number;
  structuredFieldCount: number;
}

export interface RawSourceDocument {
  schemeId: string;
  schemeName: string;
  sourceUrl: string;
  sourceDomain: string;
  fetchedAt: string;
  extraction: ExtractionMetadata;
  extractedText: string;
}