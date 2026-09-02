import {
  openDatabase,
  closeDatabase,
  runDbCheck,
  assertHealthyDatabase,
  EMBEDDINGS_FILE,
} from "../lib/vectordb";

async function main(): Promise<void> {
  const db = await openDatabase();
  try {
    const report = await runDbCheck(db, { embeddingsFile: EMBEDDINGS_FILE });

    assertHealthyDatabase(report.database);

    console.log(`[db:check] pgvector extension present: ${report.database.extensionPresent}`);
    console.log(`[db:check] table present: ${report.database.tablePresent}`);
    console.log(`[db:check] row count: ${report.database.rowCount}`);
    console.log(`[db:check] duplicate chunk_ids: ${report.database.duplicateChunkIds}`);
    console.log(`[db:check] vector dimensions: min=${report.database.minDimensions} max=${report.database.maxDimensions}`);
    console.log(`[db:check] models: ${report.database.distinctModels.join(", ")}`);
    console.log(`[db:check] schemes: ${report.database.distinctUrls.length}`);
    console.log(`[db:check] missing schemes: ${report.database.missingSchemes.length}`);
    console.log(`[db:check] unapproved URLs: ${report.database.unapprovedUrls.length}`);

    if (report.integrity) {
      console.log(`[db:check] integrity checked: ${report.integrity.checked}`);
      console.log(`[db:check] integrity mismatches: ${report.integrity.mismatches.length}`);
      if (report.integrity.mismatches.length > 0) {
        for (const mismatch of report.integrity.mismatches) {
          console.error(`[db:check] mismatch: ${mismatch}`);
        }
        process.exitCode = 1;
      }
    }

    if (report.database.duplicateChunkIds > 0) {
      process.exitCode = 1;
    }
    if (report.database.missingSchemes.length > 0) {
      process.exitCode = 1;
    }
    if (report.database.unapprovedUrls.length > 0) {
      process.exitCode = 1;
    }

    console.log(`[db:check] check complete`);
  } finally {
    await closeDatabase(db);
  }
}

main().catch((error) => {
  console.error(
    `[db:check] fatal error: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
