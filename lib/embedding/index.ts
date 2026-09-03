import os from "node:os";
import path from "node:path";
import { pipeline, env } from "@huggingface/transformers";
import { DATA_DIR } from "../ingestion/persist";
import {
  EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_CACHE_ENV,
  EMBEDDING_DIMENSION,
  EMBEDDING_POOLING,
  EMBEDDING_NORMALIZED,
  EMBEDDING_DTYPE,
} from "../../config/embedding";

// Local-development model cache (already populated during ingestion).
const LOCAL_MODEL_CACHE_DIR = path.join(DATA_DIR, "models");

// Vercel serverless instances have read-only project directories but expose
// writable, ephemeral storage under the OS temp directory. Transformers.js
// writes downloaded model files into `env.cacheDir`, so on Vercel we must
// point it at a writable location and accept a re-download on cold start.
const SERVERLESS_MODEL_CACHE_DIR = path.join(os.tmpdir(), "mf-faq-rag-models");

export function resolveModelCacheDir(): string {
  const override = process.env[EMBEDDING_MODEL_CACHE_ENV];
  if (override && override.trim().length > 0) {
    return override.trim();
  }
  if (process.env.VERCEL !== undefined) {
    return SERVERLESS_MODEL_CACHE_DIR;
  }
  return LOCAL_MODEL_CACHE_DIR;
}

export const MODEL_CACHE_DIR = resolveModelCacheDir();

export interface Embedder {
  embedBatch(texts: string[]): Promise<number[][]>;
}

export interface EmbedderOptions {
  modelId?: string;
  dimension?: number;
  pooling?: "mean" | "cls";
  normalized?: boolean;
  dtype?: string;
  cacheDir?: string;
  allowRemoteModels?: boolean;
  allowLocalModels?: boolean;
}

type FeatureExtractor = (
  texts: string[],
  options: { pooling: string; normalize: boolean }
) => Promise<{ tolist: () => number[][] }>;

export function configureEmbedderEnvironment(options: EmbedderOptions = {}): void {
  env.cacheDir = options.cacheDir ?? MODEL_CACHE_DIR;
  env.allowRemoteModels = options.allowRemoteModels ?? true;
  if (options.allowLocalModels !== undefined) {
    env.allowLocalModels = options.allowLocalModels;
  }
}

async function loadFeatureExtractor(options: EmbedderOptions): Promise<FeatureExtractor> {
  configureEmbedderEnvironment(options);
  const loader = pipeline as unknown as (
    task: string,
    model: string,
    modelOptions: Record<string, unknown>
  ) => Promise<FeatureExtractor>;

  const extractor = await loader("feature-extraction", options.modelId ?? EMBEDDING_MODEL_ID, {
    dtype: options.dtype ?? EMBEDDING_DTYPE,
  });
  return extractor;
}

export function createEmbedder(options: EmbedderOptions = {}): Embedder {
  const dimension = options.dimension ?? EMBEDDING_DIMENSION;
  const pooling = options.pooling ?? EMBEDDING_POOLING;
  const normalized = options.normalized ?? EMBEDDING_NORMALIZED;
  let extractorPromise: Promise<FeatureExtractor> | null = null;

  const getExtractor = (): Promise<FeatureExtractor> => {
    if (!extractorPromise) {
      extractorPromise = loadFeatureExtractor(options).catch((error) => {
        // Do not cache a rejected load so that a later request can retry
        // (e.g. re-download the model after an ephemeral cache was cleared).
        extractorPromise = null;
        throw error;
      });
    }
    return extractorPromise;
  };

  return {
    async embedBatch(texts: string[]): Promise<number[][]> {
      const extractor = await getExtractor();
      const output = await extractor(texts, { pooling, normalize: normalized });
      const vectors = output.tolist() as number[][];
      if (vectors.length !== texts.length) {
        throw new Error(
          `Embedder returned ${vectors.length} vectors for ${texts.length} inputs`
        );
      }
      return vectors.map((vector) => {
        if (vector.length !== dimension) {
          throw new Error(
            `Embedder returned ${vector.length} dimensions; expected ${dimension}`
          );
        }
        return vector.map(Number);
      });
    },
  };
}

export async function embedText(text: string, options: EmbedderOptions = {}): Promise<number[]> {
  const embedder = createEmbedder(options);
  const vectors = await embedder.embedBatch([text]);
  return vectors[0];
}

let defaultEmbedder: Embedder | null = null;

export function getDefaultEmbedder(): Embedder {
  if (!defaultEmbedder) {
    defaultEmbedder = createEmbedder();
  }
  return defaultEmbedder;
}
