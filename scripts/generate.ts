import {
  openDatabase,
  closeDatabase,
  loadLocalEnv,
} from "../lib/vectordb";
import { getDefaultEmbedder } from "../lib/embedding";
import { generateAnswer } from "../lib/generation";
import { MISTRAL_API_KEY_ENV_VAR } from "../config/mistral";
import { isApprovedUrl } from "../config/sources";
import { countSentences } from "../lib/generation/validate";

const SMOKE_QUESTION =
  "HDFC ELSS Tax Saver Fund tax saving under Section 80C";

function safeResult(prefix: string, line: string): string {
  return line
    .split("\n")
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => `${prefix}  ${chunk}`)
    .join("\n");
}

async function main(): Promise<void> {
  loadLocalEnv();

  if (!process.env[MISTRAL_API_KEY_ENV_VAR]) {
    console.error(
      `[generate] error: ${MISTRAL_API_KEY_ENV_VAR} is not set in .env.local. ` +
        `Add MISTRAL_API_KEY=<your key> to .env.local and re-run.`
    );
    process.exitCode = 1;
    return;
  }

  const db = await openDatabase();
  try {
    const result = await generateAnswer(db, SMOKE_QUESTION, {
      embed: async (text) => {
        const embedder = getDefaultEmbedder();
        const vectors = await embedder.embedBatch([text]);
        return vectors[0];
      },
    });

    const answer = result.answer;

    console.log(`[generate] question: ${SMOKE_QUESTION}`);
    console.log(`[generate] status: ${answer.status}`);

    if (answer.answer) {
      console.log("[generate] answer:");
      console.log(safeResult("[generate]", answer.answer));
    }

    console.log(`[generate] schemeName: ${answer.schemeName ?? "n/a"}`);
    console.log(`[generate] sourceUrl: ${answer.sourceUrl ?? "n/a"}`);
    console.log(
      `[generate] lastUpdated: ${answer.lastUpdated ?? "Date unavailable on source."}`
    );

    const body = answer.answer?.split("\n\n")[0] ?? "";
    console.log(`[generate] sentenceCount: ${countSentences(body)}`);

    if (answer.status !== "answered") {
      process.exitCode = 1;
      return;
    }

    if (!answer.sourceUrl || !isApprovedUrl(answer.sourceUrl)) {
      console.error("[generate] error: no approved source URL was attached");
      process.exitCode = 1;
      return;
    }

    if (!answer.schemeName) {
      console.error("[generate] error: scheme name missing from result");
      process.exitCode = 1;
      return;
    }

    if (countSentences(body) > 3) {
      console.error(
        `[generate] error: answer body exceeds 3 sentences (${countSentences(body)})`
      );
      process.exitCode = 1;
      return;
    }

    console.log("[generate] smoke test passed (answered with one approved source).");
  } finally {
    await closeDatabase(db);
  }
}

main().catch((error) => {
  console.error(
    `[generate] fatal error: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
