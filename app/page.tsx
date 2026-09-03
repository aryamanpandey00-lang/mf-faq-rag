import ChatClient from "./chat-client";

export default function Home() {
  return (
    <main className="flex w-full flex-1 justify-center bg-zinc-50 px-4 py-10 dark:bg-black">
      <div className="w-full max-w-2xl">
        <header className="mb-6 text-center sm:text-left">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Mutual Fund FAQ Assistant
          </h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Ask factual questions about the supported HDFC mutual funds. Answers
            come from the approved Groww source pages only.
          </p>
        </header>

        <ChatClient />

        <footer className="mt-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
          Facts-only. No investment advice.
        </footer>
      </div>
    </main>
  );
}
