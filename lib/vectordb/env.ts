import { readFileSync } from "node:fs";
import path from "node:path";

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const equals = line.indexOf("=");
    if (equals === -1) {
      continue;
    }
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    if (key) {
      result[key] = value;
    }
  }
  return result;
}

export function loadLocalEnv(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): void {
  const candidates = [".env.local", ".env"];
  for (const fileName of candidates) {
    const filePath = path.join(cwd, fileName);
    try {
      const content = readFileSync(filePath, "utf8");
      const parsed = parseEnvFile(content);
      for (const [key, value] of Object.entries(parsed)) {
        if (env[key] === undefined) {
          env[key] = value;
        }
      }
    } catch {
      // file does not exist or is unreadable; skip
    }
  }
}
