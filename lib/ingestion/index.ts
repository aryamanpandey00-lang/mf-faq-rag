import { APPROVED_SOURCES } from "../../config/sources";
import { loadSource, type LoadSourceOptions, type SourceLoadOutcome } from "./load";
import type { SchemeSource } from "../types";

export interface SourceResult {
  source: SchemeSource;
  outcome: SourceLoadOutcome;
}

export interface IngestReport {
  attempted: number;
  succeeded: number;
  failed: number;
  results: SourceResult[];
}

export interface RunIngestOptions extends LoadSourceOptions {
  logger?: (message: string) => void;
}

export async function runIngest(options: RunIngestOptions = {}): Promise<IngestReport> {
  const logger = options.logger ?? (() => undefined);
  const results: SourceResult[] = [];

  for (const source of APPROVED_SOURCES) {
    logger(`Fetching ${source.schemeId} -> ${source.url}`);
    const outcome = await loadSource(source, options);
    results.push({ source, outcome });
  }

  const succeeded = results.filter(
    (result) => result.outcome.kind === "success"
  ).length;
  const failed = results.length - succeeded;

  return {
    attempted: results.length,
    succeeded,
    failed,
    results,
  };
}