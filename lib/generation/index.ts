import type { Database } from "../vectordb/connection";
import type { RetrievalOutcome, RetrieveOptions } from "../retrieval";
import { retrieve } from "../retrieval";
import type { GeneratedAnswer, AnswerStatus, RetrievalResult } from "../types";
import {
  resolveMistralConfig,
  createMistralClient,
  MistralConfigurationError,
  MistralApiError,
  type MistralConfig,
  type MistralRequestFn,
} from "./mistral";
import {
  resolveSingleSource,
  isWithinSentenceLimit,
  INSUFFICIENT_INFORMATION_MESSAGE,
  OUT_OF_SCOPE_MESSAGE,
  INVESTMENT_ADVICE_REFUSAL_MESSAGE,
} from "./validate";

export interface GenerateAnswerOptions {
  topK?: number;
  similarityThreshold?: number;
  embed?: RetrieveOptions["embed"];
  mistralRequestFn?: MistralRequestFn;
  env?: Record<string, string | undefined>;
}

export interface GenerationResult {
  answer: GeneratedAnswer;
}

const ADVICE_KEYWORDS: readonly string[] = [
  "should i",
  "which one is better",
  "which fund should",
  "which fund is best",
  "is it a good investment",
  "invest in",
  "recommend",
  "prefer",
];

const COMPARISON_KEYWORDS: readonly string[] = [
  "compare",
  "lowest expense ratio",
  "better returns",
  "which one",
  "vs",
];

function containsAny(text: string, keywords: readonly string[]): boolean {
  const lowered = text.toLowerCase();
  return keywords.some((keyword) => lowered.includes(keyword));
}

function refusalStatus(text: string): AnswerStatus | null {
  if (containsAny(text, COMPARISON_KEYWORDS)) {
    return "out_of_scope";
  }
  if (containsAny(text, ADVICE_KEYWORDS)) {
    return "out_of_scope";
  }
  return null;
}

function makeOutOfScopeAnswer(question: string): GeneratedAnswer {
  const isComparison = containsAny(question, COMPARISON_KEYWORDS);
  const message = isComparison
    ? OUT_OF_SCOPE_MESSAGE
    : INVESTMENT_ADVICE_REFUSAL_MESSAGE;
  return {
    answer: message,
    sourceUrl: null,
    schemeId: null,
    schemeName: null,
    lastUpdated: null,
    status: "out_of_scope",
  };
}

function finalize(
  generated: string,
  results: RetrievalResult[]
): GeneratedAnswer {
  const singleSource = resolveSingleSource(results);
  if (!singleSource.valid || !singleSource.sourceUrl) {
    return {
      answer: null,
      sourceUrl: null,
      schemeId: null,
      schemeName: null,
      lastUpdated: null,
      status: "generation_error",
    };
  }

  if (!isWithinSentenceLimit(generated)) {
    return {
      answer: null,
      sourceUrl: singleSource.sourceUrl,
      schemeId: singleSource.schemeId,
      schemeName: singleSource.schemeName,
      lastUpdated: results[0]?.lastUpdated ?? null,
      status: "generation_error",
    };
  }

  const lastUpdated = results[0]?.lastUpdated ?? null;
  const clipped = generated.trim().replace(/\s+$/, "");
  const bodyWithoutModelUrls = clipped.replace(/https?:\/\/\S+/gi, "").trim();
  const answerBody = `${bodyWithoutModelUrls}\n\nSource: ${singleSource.sourceUrl}\nLast updated from sources: ${
    lastUpdated && lastUpdated.trim().length > 0
      ? `${lastUpdated.trim()}.`
      : "Date unavailable on source."
  }`;

  return {
    answer: answerBody,
    sourceUrl: singleSource.sourceUrl,
    schemeId: singleSource.schemeId,
    schemeName: singleSource.schemeName,
    lastUpdated,
    status: "answered",
  };
}

export async function generateAnswer(
  db: Database,
  rawQuestion: unknown,
  options: GenerateAnswerOptions = {}
): Promise<GenerationResult> {
  const question = typeof rawQuestion === "string" ? rawQuestion.trim() : "";

  const outOfScope = refusalStatus(question);
  if (outOfScope) {
    return { answer: makeOutOfScopeAnswer(question) };
  }

  let config: MistralConfig;
  try {
    config = resolveMistralConfig(options.env ?? process.env);
  } catch (error) {
    if (error instanceof MistralConfigurationError) {
      return {
        answer: {
          answer: "Mistral is not configured. Please set MISTRAL_API_KEY.",
          sourceUrl: null,
          schemeId: null,
          schemeName: null,
          lastUpdated: null,
          status: "configuration_error",
        },
      };
    }
    throw error;
  }

  const retrievalOutcome: RetrievalOutcome = await retrieve(db, question, {
    topK: options.topK,
    similarityThreshold: options.similarityThreshold,
    embed: options.embed,
  });

  const results = retrievalOutcome.results;

  if (results.length === 0) {
    return {
      answer: {
        answer: INSUFFICIENT_INFORMATION_MESSAGE,
        sourceUrl: null,
        schemeId: null,
        schemeName: null,
        lastUpdated: null,
        status: "insufficient_information",
      },
    };
  }

  const singleSource = resolveSingleSource(results);
  if (!singleSource.valid) {
    return {
      answer: {
        answer: OUT_OF_SCOPE_MESSAGE,
        sourceUrl: null,
        schemeId: null,
        schemeName: null,
        lastUpdated: null,
        status: "out_of_scope",
      },
    };
  }

  const client = createMistralClient(config, options.mistralRequestFn);

  try {
    const generationContext = {
      question,
      schemeName: singleSource.schemeName ?? "",
      sourceUrl: singleSource.sourceUrl ?? "",
      lastUpdated: results[0]?.lastUpdated ?? null,
      chunks: results.map((result) => ({ text: result.chunkText })),
    };

    const completion = await client.generate(generationContext);
    const final = finalize(completion.content, results);
    return { answer: final };
  } catch (error) {
    if (
      error instanceof MistralApiError ||
      error instanceof MistralConfigurationError
    ) {
      return {
        answer: {
          answer: "Sorry, I couldn't generate an answer right now. Please try again.",
          sourceUrl: singleSource.sourceUrl,
          schemeId: singleSource.schemeId,
          schemeName: singleSource.schemeName,
          lastUpdated: results[0]?.lastUpdated ?? null,
          status: "generation_error",
        },
      };
    }
    throw error;
  }
}
