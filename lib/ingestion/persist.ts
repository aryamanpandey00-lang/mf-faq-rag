import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RawSourceDocument } from "../types";

export const DATA_DIR = path.resolve(process.cwd(), "data");
export const DATA_RAW_DIR = path.join(DATA_DIR, "raw");

export interface PersistDocumentResult {
  filePath: string;
}

export function rawDocumentFileName(document: RawSourceDocument): string {
  return `${document.schemeId}.json`;
}

export function persistRawDocument(
  document: RawSourceDocument,
  rawDir: string = DATA_RAW_DIR
): PersistDocumentResult {
  mkdirSync(rawDir, { recursive: true });
  const filePath = path.join(rawDir, rawDocumentFileName(document));
  writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return { filePath };
}