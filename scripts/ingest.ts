import { runIngest } from "../lib/ingestion";
import type { IngestReport } from "../lib/ingestion";

async function main(): Promise<void> {
  const report = await runIngest({
    logger: (message) => console.log(`[ingest] ${message}`),
  });

  printReport(report);
  process.exitCode = report.failed > 0 ? 1 : 0;
}

function printReport(report: IngestReport): void {
  for (const { source, outcome } of report.results) {
    if (outcome.kind === "success") {
      console.log(
        `  OK    ${source.schemeId}: ${outcome.document.extraction.charCount} characters -> ${outcome.filePath}`
      );
    } else {
      console.log(`  FAIL  ${source.schemeId}: ${outcome.error}`);
    }
  }

  console.log(
    `Ingested ${report.attempted} sources: ${report.succeeded} succeeded, ${report.failed} failed.`
  );

  const failures = report.results.filter(
    (result) => result.outcome.kind === "failure"
  );
  for (const { source, outcome } of failures) {
    if (outcome.kind === "failure") {
      console.log(`FAILED SOURCE: ${source.schemeId} (${source.url})`);
      console.log(`  reason: ${outcome.error}`);
    }
  }
}

main().catch((error) => {
  console.error(`[ingest] fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});