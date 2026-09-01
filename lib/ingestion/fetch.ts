import { isApprovedUrl } from "../../config/sources";
import type { SchemeSource } from "../types";

export type Fetcher = typeof globalThis.fetch;

export interface FetchHtmlOptions {
  timeoutMs?: number;
  fetcher?: Fetcher;
}

export class FetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchError";
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

const USER_AGENT =
  "mf-faq-rag-ingest/0.1 (local data loading; https://groww.in approved sources)";

export async function fetchSourceHtml(
  source: SchemeSource,
  options: FetchHtmlOptions = {}
): Promise<string> {
  if (!isApprovedUrl(source.url)) {
    throw new FetchError(`Refusing to fetch unapproved URL: ${source.url}`);
  }

  const fetcher = options.fetcher ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(source.url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-IN,en;q=0.9",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    if (response.url) {
      const finalUrl = new URL(response.url);
      if (finalUrl.hostname !== source.domain) {
        throw new FetchError(
          `Redirected off approved domain "${source.domain}": ${finalUrl.hostname}`
        );
      }
    }

    if (!response.ok) {
      throw new FetchError(`HTTP ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType !== "" && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new FetchError(`Unexpected content type: ${contentType}`);
    }

    return await response.text();
  } catch (error) {
    if (error instanceof FetchError) {
      throw error;
    }
    if (isAbortError(error)) {
      throw new FetchError(`Request timed out after ${timeoutMs}ms`);
    }
    throw new FetchError(`Network error: ${errorMessage(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}