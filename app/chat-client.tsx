"use client";

import { useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import type { GeneratedAnswer } from "@/lib/types";

const EXAMPLE_QUESTIONS = [
  "What is the expense ratio of HDFC Large Cap Fund Direct Growth?",
  "What is the lock-in period for HDFC ELSS Tax Saver Fund?",
  "What is the minimum SIP investment for HDFC Small Cap Fund?",
];

function formatLastUpdated(lastUpdated: string | null): string {
  if (lastUpdated && lastUpdated.trim().length > 0) {
    return lastUpdated.trim();
  }
  return "Date unavailable on source.";
}

export default function ChatClient() {
  const [input, setInput] = useState("");
  const [answer, setAnswer] = useState<GeneratedAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitQuestion(question: string): Promise<void> {
    const trimmed = question.trim();
    if (!trimmed || loading) {
      return;
    }

    setInput("");
    setAnswer(null);
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(
          payload?.error ?? "Something went wrong. Please try again."
        );
        return;
      }

      const data = (await response.json()) as GeneratedAnswer;
      setAnswer(data);
    } catch {
      setError("Sorry, we couldn't reach the answer service. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submitQuestion(input);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitQuestion(input);
    }
  }

  const inputDisabled = loading;
  const canSubmit = input.trim().length > 0 && !loading;

  return (
    <div className="w-full">
      <section className="mb-6">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Ask a factual question about one of the supported HDFC mutual funds.
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {EXAMPLE_QUESTIONS.map((question) => (
            <li key={question}>
              <button
                type="button"
                onClick={() => void submitQuestion(question)}
                disabled={loading}
                className="w-full rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-left text-sm text-emerald-900 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100 dark:hover:bg-emerald-900"
              >
                {question}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 sm:flex-row"
      >
        <input
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder='Ask about HDFC mutual funds, e.g. "What is the expense ratio of HDFC Large Cap?"'
          disabled={inputDisabled}
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-3 text-zinc-900 placeholder-zinc-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-lg bg-emerald-600 px-6 py-3 font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Searching..." : "Ask"}
        </button>
      </form>

      {loading && (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
          Getting answer...
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {error}
        </div>
      )}

      {answer && (
        <section
          aria-live="polite"
          className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          {answer.status === "answered" ? (
            <>
              {answer.schemeName && (
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                  {answer.schemeName}
                </p>
              )}
              {answer.answer && (
                <p className="whitespace-pre-line text-zinc-800 dark:text-zinc-100">
                  {answer.answer}
                </p>
              )}
              <div className="mt-4 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                {answer.sourceUrl && (
                  <p className="mb-1">
                    Source:{" "}
                    <a
                      href={answer.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-emerald-700 underline hover:text-emerald-800 dark:text-emerald-400"
                    >
                      {answer.sourceUrl}
                    </a>
                  </p>
                )}
                <p>Last updated from sources: {formatLastUpdated(answer.lastUpdated)}</p>
              </div>
            </>
          ) : answer.status === "out_of_scope" ? (
            <p className="text-zinc-800 dark:text-zinc-100">
              {answer.answer ?? "That question is outside the scope of this assistant."}
            </p>
          ) : answer.status === "insufficient_information" ? (
            <p className="text-zinc-800 dark:text-zinc-100">
              {answer.answer ??
                "I couldn't find enough information in the supported sources to answer that question."}
            </p>
          ) : (
            <p className="text-zinc-800 dark:text-zinc-100">
              {answer.answer ??
                "Sorry, I couldn't get an answer right now. Please try again in a moment."}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
