export const EMBEDDING_MODEL_ID =
  "sentence-transformers/all-MiniLM-L6-v2";

// Server-only environment variable override for the Transformers.js model
// cache directory. Used to select a writable/ephemeral location (e.g. /tmp)
// in read-only serverless runtimes such as Vercel.
export const EMBEDDING_MODEL_CACHE_ENV = "MODEL_CACHE_DIR";

export const EMBEDDING_DIMENSION = 384;

export const EMBEDDING_BATCH_SIZE = 16;

export const EMBEDDING_POOLING = "mean";

export const EMBEDDING_NORMALIZED = true;

export const EMBEDDING_DTYPE = "fp32";
