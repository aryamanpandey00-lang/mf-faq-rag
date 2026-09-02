import {
  openDatabase,
  closeDatabase,
} from "../lib/vectordb";
import { retrieve } from "../lib/retrieval";
import { getDefaultEmbedder } from "../lib/embedding";

async function main(): Promise<void> {
  const query = process.argv.slice(2).join(" ").trim();
  if (!query) {
    console.error("[retrieve] usage: npm run retrieve -- \"<your question>\"");
    process.exitCode = 1;
    return;
  }

  const db = await openDatabase();
  try {
    const outcome = await retrieve(db, query, {
      embed: async (text) => {
        const embedder = getDefaultEmbedder();
        const vectors = await embedder.embedBatch([text]);
        return vectors[0];
      },
    });

    console.log(`[retrieve] query: ${query}`);
    console.log(`[retrieve] results: ${outcome.results.length}`);
    for (const result of outcome.results) {
      console.log(`- ${result.schemeName}`);
      console.log(`    source_url: ${result.sourceUrl}`);
      console.log(`    similarity: ${result.similarity.toFixed(4)}`);
      console.log(`    chunk: #${result.chunkIndex} (${result.chunkId})`);
      console.log(`    last_updated: ${result.lastUpdated ?? "n/a"}`);
    }
  } finally {
    await closeDatabase(db);
  }
}

main().catch((error) => {
  console.error(
    `[retrieve] fatal error: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
