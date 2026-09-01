import type { Fetcher } from "./fetch";
import { fetchSourceHtml } from "./fetch";
import { extractTextFromHtml } from "./extract";
import { persistRawDocument } from "./persist";
import { buildRawDocument } from "./validate";
import type { RawSourceDocument, SchemeSource } from "../types";

export interface LoadSourceOptions {
  fetcher?: Fetcher;
  rawDir?: string;
}

export type SourceLoadOutcome =
  | { kind: "success"; document: RawSourceDocument; filePath: string }
  | { kind: "failure"; error: string };

export async function loadSource(
  source: SchemeSource,
  options: LoadSourceOptions = {}
): Promise<SourceLoadOutcome> {
  try {
    const html = await fetchSourceHtml(source, { fetcher: options.fetcher });
    const extracted = extractTextFromHtml(html);
    const document = buildRawDocument(source, extracted);
    const { filePath } = persistRawDocument(document, options.rawDir);
    return { kind: "success", document, filePath };
  } catch (error) {
    return {
      kind: "failure",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}