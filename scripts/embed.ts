import { runEmbedding } from "../lib/embedding/pipeline";
import {
  persistEmbeddings,
  persistEmbeddingRunMetadata,
  buildRunMetadata,
  EMBEDDINGS_FILE,
} from "../lib/embedding/persist";
import { validateNormalization, validateCorpusUrls } from "../lib/embedding/validate";
import { EMBEDDING_MODEL_ID, EMBEDDING_DIMENSION, EMBEDDING_NORMALIZED } from "../config/embedding";

async function main(): Promise<void> {
  const result = await runEmbedding({
    onProgress: (done, total) => {
      process.stdout.write(`\r[embed] embedded ${done}/${total} chunks`);
    },
  });
  process.stdout.write("\n");

  if (result.records.length === 0) {
    console.error("[embed] no embeddings were generated");
    process.exitCode = 1;
    return;
  }

  validateNormalization(result.records);
  validateCorpusUrls(result.records);

  persistEmbeddings(result.records);
  persistEmbeddingRunMetadata(
    buildRunMetadata(
      result.chunks.length,
      result.records.length,
      EMBEDDING_DIMENSION,
      EMBEDDING_NORMALIZED
    )
  );

  console.log(`[embed] input chunks: ${result.chunks.length}`);
  console.log(`[embed] embeddings generated: ${result.records.length}`);
  console.log(`[embed] model: ${EMBEDDING_MODEL_ID}`);
  console.log(`[embed] dimensions: ${EMBEDDING_DIMENSION}`);
  console.log(`[embed] normalized: ${EMBEDDING_NORMALIZED}`);
  console.log(`[embed] output: ${EMBEDDINGS_FILE}`);
  console.log(`[embed] failures: 0`);
}

main().catch((error) => {
  console.error(
    `[embed] fatal error: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
