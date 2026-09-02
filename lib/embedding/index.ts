import path from "node:path";
import { pipeline, env } from "@huggingface/transformers";
import { DATA_DIR } from "../ingestion/persist";
import {
  EMBEDDING_MODEL_ID,
  EMBEDDING_DIMENSION,
  EMBEDDING_POOLING,
  EMBEDDING_NORMALIZED,
  EMBEDDING_DTYPE,
} from "../../config/embedding";

export const MODEL_CACHE_DIR = path.join(DATA_DIR, "models");

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
}

type FeatureExtractor = (
  texts: string[],
  options: { pooling: string; normalize: boolean }
) => Promise<{ tolist: () => number[][] }>;

export function configureEmbedderEnvironment(options: EmbedderOptions = {}): void {
  env.cacheDir = options.cacheDir ?? MODEL_CACHE_DIR;
  env.allowRemoteModels = options.allowRemoteModels ?? true;
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
      extractorPromise = loadFeatureExtractor(options);
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
