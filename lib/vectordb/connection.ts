import { Client } from "@neondatabase/serverless";
import { DB_ENV_VAR } from "../../config/database";

export class VectordbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VectordbError";
  }
}

export class DbConnectionError extends VectordbError {
  constructor(message: string) {
    super(message);
    this.name = "DbConnectionError";
  }
}

export interface QueryRow {
  [column: string]: unknown;
}

export interface Database {
  query<T extends QueryRow = QueryRow>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[] }>;
  connect(): Promise<void>;
  end(): Promise<void>;
}

export function getDatabaseUrl(
  env: Record<string, string | undefined> = process.env
): string {
  const url = env[DB_ENV_VAR];
  if (!url || url.trim() === "") {
    throw new DbConnectionError(
      `Missing required environment variable ${DB_ENV_VAR}. ` +
        `Create a .env.local with ${DB_ENV_VAR}=<your Neon connection string>. ` +
        `See .env.example for the format.`
    );
  }
  return url.trim();
}

export function redactConnectionString(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "REDACTED";
    }
    return parsed.toString();
  } catch {
    return "(unparseable)";
  }
}

interface NeonLikeClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  connect(): Promise<void>;
  end(): Promise<void>;
}

export type ClientFactory = (connectionString: string) => NeonLikeClient;

export function createNeonDatabase(
  url?: string,
  clientFactory: ClientFactory = (connectionString) => new Client(connectionString)
): Database {
  const connectionString = url ?? getDatabaseUrl();
  const client = clientFactory(connectionString);
  return {
    async query<T extends QueryRow = QueryRow>(sql: string, params?: unknown[]) {
      try {
        const result = await client.query(sql, params);
        return { rows: result.rows as T[] };
      } catch (error) {
        throw new VectordbError(
          `Database query failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
    async connect() {
      try {
        await client.connect();
      } catch (error) {
        const redacted = redactConnectionString(connectionString);
        throw new DbConnectionError(
          `Could not connect to Neon database (${redacted}): ` +
            `${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
    async end() {
      await client.end();
    },
  };
}
