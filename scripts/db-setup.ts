import {
  openDatabase,
  closeDatabase,
  runDbSetup,
} from "../lib/vectordb";

async function main(): Promise<void> {
  const db = await openDatabase();
  try {
    const report = await runDbSetup(db);
    console.log(`[db:setup] pgvector extension present: ${report.extensionPresent}`);
    console.log(`[db:setup] table present: ${report.tablePresent}`);
    console.log(`[db:setup] row count: ${report.rowCount}`);
    if (report.minDimensions !== null) {
      console.log(`[db:setup] vector dimensions: ${report.minDimensions}`);
    }
    console.log(`[db:setup] setup complete`);
  } finally {
    await closeDatabase(db);
  }
}

main().catch((error) => {
  console.error(
    `[db:setup] fatal error: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
