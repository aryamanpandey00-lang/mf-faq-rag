export const TERMINAL_PUNCTUATION = /[.!?]/;
const SENTENCE_SPLIT_PATTERN = /(?<=[.!?])\s+/;

export function segmentText(text: string): string[] {
  const sentences: string[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    splitLineIntoSentences(trimmed, sentences);
  }
  return sentences;
}

function splitLineIntoSentences(line: string, out: string[]): void {
  const parts = line.split(SENTENCE_SPLIT_PATTERN);
  let current = "";
  for (const part of parts) {
    const next = current.length > 0 ? `${current} ${part}` : part;
    if (TERMINAL_PUNCTUATION.test(next)) {
      out.push(next.trim());
      current = "";
    } else {
      current = next;
    }
  }
  if (current.length > 0) {
    out.push(current.trim());
  }
}
