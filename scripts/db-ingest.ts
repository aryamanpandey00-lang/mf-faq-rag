import {
  openDatabase,
  closeDatabase,
  runDbIngest,
  assertIngestionHealth,
  EMBEDDINGS_FILE,
} from "../lib/vectordb";

async function main(): Promise<void> {
  const db = await openDatabase();
  try {
    const report = await runDbIngest(db, { embeddingsFile: EMBEDDINGS_FILE });

    console.log(`[db:ingest] input file: ${report.inputFile}`);
    console.log(`[db:ingest] embeddings processed: ${report.records}`);
    console.log(`[db:ingest] inserted: ${report.ingest.inserted}`);
    console.log(`[db:ingest] updated: ${report.ingest.updated}`);
    console.log(`[db:ingest] skipped: ${report.ingest.skipped}`);
    console.log(`[db:ingest] batches: ${report.ingest.batchCount}`);
    console.log(`[db:ingest] row count now: ${report.database.rowCount}`);
    console.log(`[db:ingest] unapproved URLs: ${report.database.unapprovedUrls.length}`);

    assertIngestionHealth(report);
    console.log(`[db:ingest] ingestion verified OK`);
  } finally {
    await closeDatabase(db);
  }
}

main().catch((error) => {
  console.error(
    `[db:ingest] fatal error: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
