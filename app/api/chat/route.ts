import { openDatabase, closeDatabase } from "@/lib/vectordb";
import { getDefaultEmbedder } from "@/lib/embedding";
import { generateAnswer } from "@/lib/generation";
import { validateQuery } from "@/lib/retrieval/validate";
import { RetrievalError } from "@/lib/retrieval/validate";
import type { GeneratedAnswer } from "@/lib/types";

export const runtime = "nodejs";

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

interface ChatBody {
  question?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  if (typeof body.question !== "string") {
    return jsonError("A 'question' string field is required.", 400);
  }

  let question: string;
  try {
    question = validateQuery(body.question);
  } catch (error) {
    if (error instanceof RetrievalError) {
      return jsonError("Please provide a valid, non-empty question.", 400);
    }
    return jsonError("Please provide a valid question.", 400);
  }

  let db;
  try {
    db = await openDatabase();
  } catch {
    return jsonError("Sorry, the answer service is temporarily unavailable.", 500);
  }

  try {
    const result = await generateAnswer(db, question, {
      embed: async (text: string) => {
        const embedder = getDefaultEmbedder();
        const vectors = await embedder.embedBatch([text]);
        return vectors[0];
      },
    });

    const answer: GeneratedAnswer = result.answer;
    return Response.json(answer);
  } catch {
    const fallback: GeneratedAnswer = {
      answer:
        "Sorry, I couldn't get an answer right now. Please try again in a moment.",
      sourceUrl: null,
      schemeId: null,
      schemeName: null,
      lastUpdated: null,
      status: "generation_error",
    };
    return Response.json(fallback, { status: 200 });
  } finally {
    if (db) {
      await closeDatabase(db);
    }
  }
}
