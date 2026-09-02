export interface ChunkingOptions {
  targetSize?: number;
}

export const DEFAULT_CHUNK_TARGET_SIZE = 600;

export function buildChunks(
  sentences: string[],
  options: ChunkingOptions = { targetSize: DEFAULT_CHUNK_TARGET_SIZE }
): string[][] {
  const target = options.targetSize ?? DEFAULT_CHUNK_TARGET_SIZE;
  const chunks: string[][] = [];
  let current: string[] = [];

  const pushChunk = (group: string[]): void => {
    if (group.length > 0) {
      chunks.push(group);
    }
  };

  for (const sentence of sentences) {
    const sentenceLength = sentence.length + 1;

    if (sentenceLength > target) {
      pushChunk(current);
      current = [];
      const pieces = splitLongSentence(sentence, target);
      for (const piece of pieces) {
        pushChunk([piece]);
      }
      continue;
    }

    const currentLength = current.reduce((sum, s) => sum + s.length + 1, 0);
    if (current.length > 1 && currentLength + sentenceLength > target) {
      const overlap = current[current.length - 1];
      pushChunk(current);
      current = [overlap];
    }

    current.push(sentence);
  }

  pushChunk(current);
  return chunks;
}

function splitLongSentence(sentence: string, target: number): string[] {
  const pieces: string[] = [];
  let remaining = sentence;
  while (remaining.length > target) {
    const windowStart = Math.max(0, target - 80);
    const lastSpace = remaining.lastIndexOf(" ", target);
    const cut = lastSpace > windowStart && lastSpace > 0 ? lastSpace : target;
    const piece = remaining.slice(0, cut).trim();
    if (piece.length > 0) {
      pieces.push(piece);
    }
    remaining = remaining.slice(cut).trim();
  }
  if (remaining.length > 0) {
    pieces.push(remaining);
  }
  return pieces;
}
