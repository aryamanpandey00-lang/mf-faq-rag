import { runChunking, type ChunkingRunReport } from "../lib/chunking";
import { persistChunks, CHUNKS_FILE } from "../lib/chunking/persist";

function main(): void {
  const report = runChunking();
  printReport(report);
  process.exitCode = report.failures.length > 0 ? 1 : 0;
}

function printReport(report: ChunkingRunReport): void {
  console.log(`[chunk] raw documents found: ${report.rawDocumentsFound}`);

  for (const result of report.results) {
    console.log(
      `  OK    ${result.source.schemeId}: ${result.chunks.length} chunks`
    );
  }
  for (const failure of report.failures) {
    console.log(`  FAIL  ${failure.source.schemeId}: ${failure.error}`);
  }

  console.log(`[chunk] schemes processed: ${report.schemesProcessed.length}`);
  console.log(`[chunk] total chunks: ${report.totalChunks}`);

  for (const [schemeId, count] of Object.entries(report.perSchemeCounts)) {
    console.log(`[chunk]   ${schemeId}: ${count}`);
  }

  if (report.failures.length === 0) {
    const fileReport = persistChunks(
      report.results.flatMap((result) => result.chunks)
    );
    console.log(`[chunk] output: ${CHUNKS_FILE} (${fileReport.chunkCount} chunks)`);
    console.log(`[chunk] done.`);
  } else {
    console.log(`[chunk] ${report.failures.length} failure(s); output not written.`);
  }
}

main();
