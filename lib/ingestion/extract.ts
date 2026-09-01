export interface ExtractedContent {
  title: string | null;
  description: string | null;
  text: string;
  structuredFieldCount: number;
}

export const EXTRACTION_METHOD = "html-text-extractor/v1";

const SKIP_TAG_PATTERN =
  /\<\s*(script|style|noscript|template|svg|iframe|canvas)\b[^>]*\>[\s\S]*?\<\s*\/\s*\1\s*\>/gi;

const BLOCK_TAG_PATTERN =
  /\<\s*\/?(?:p|div|li|tr|section|article|h[1-6]|br|table|thead|tbody|td|th|blockquote)\s*[^>]*\>/gi;

const META_TAG_PATTERN = /\<\s*meta\b[^>]*\>/gi;

const NEXT_DATA_PATTERN =
  /\<\s*script\b[^>]*__NEXT_DATA__[^>]*\>([\s\S]*?)\<\s*\/\s*script\s*\>/i;

const STRUCTURED_DATA_MARKER = "== Structured fund data ==";

interface FactField {
  label: string;
  format?: (value: unknown) => string;
}

// Curated whitelist of factual fund attributes exposed by Groww's
// __NEXT_DATA__ payload (pageProps.mfServerSideData). These are exactly the
// short factual FAQ attributes the PRD cares about (expense ratio, SIP, exit
// load, benchmark, objective, and so on).
const FUND_FACT_FIELDS: Record<string, FactField> = {
  scheme_name: { label: "Scheme name" },
  category: { label: "Category" },
  sub_category: { label: "Sub category" },
  fund_house: { label: "Fund house" },
  fund_manager: { label: "Fund manager" },
  launch_date: { label: "Launch date" },
  aum: { label: "AUM (in crores)" },
  expense_ratio: { label: "Expense ratio (%)" },
  base_expense_ratio: { label: "Base expense ratio (%)" },
  exit_load: { label: "Exit load" },
  benchmark: { label: "Benchmark" },
  benchmark_name: { label: "Benchmark name" },
  min_investment_amount: { label: "Minimum investment", format: (v) => `Rs ${v}` },
  min_sip_investment: { label: "Minimum SIP investment", format: (v) => `Rs ${v}` },
  max_sip_investment: { label: "Maximum SIP investment", format: (v) => `Rs ${v}` },
  min_withdrawal: { label: "Minimum withdrawal", format: (v) => `Rs ${v}` },
  lock_in: { label: "Lock-in period", format: formatLockIn },
  nav: { label: "NAV", format: (v) => `Rs ${v}` },
  nav_date: { label: "NAV date" },
  plan_type: { label: "Plan type" },
  scheme_type: { label: "Scheme type" },
  isin: { label: "ISIN" },
  description: { label: "Investment objective" },
};

export function extractTextFromHtml(html: string): ExtractedContent {
  const title = extractTitle(html);
  const description = extractMetaDescription(html);
  const structured = extractStructuredFundData(html);

  let text = html;
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(SKIP_TAG_PATTERN, " ");
  text = text.replace(BLOCK_TAG_PATTERN, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  text = decodeEntities(text);
  text = normalizeWhitespace(text);

  const trailing: string[] = [];
  if (title) {
    trailing.push(`Title: ${title}`);
  }
  if (description) {
    trailing.push(`Description: ${description}`);
  }
  if (structured.block) {
    trailing.push(STRUCTURED_DATA_MARKER);
    trailing.push(structured.block);
  }

  if (trailing.length > 0) {
    text = text.length > 0 ? `${text}\n\n${trailing.join("\n")}` : trailing.join("\n");
  }

  return {
    title,
    description,
    text,
    structuredFieldCount: structured.count,
  };
}

interface StructuredFundData {
  block: string;
  count: number;
}

function extractStructuredFundData(html: string): StructuredFundData {
  const match = NEXT_DATA_PATTERN.exec(html);
  if (!match) {
    return { block: "", count: 0 };
  }

  let mfServerSideData: Record<string, unknown>;
  try {
    const payload = JSON.parse(match[1]) as {
      props?: { pageProps?: { mfServerSideData?: Record<string, unknown> } };
    };
    mfServerSideData = payload.props?.pageProps?.mfServerSideData ?? {};
  } catch {
    return { block: "", count: 0 };
  }

  if (Object.keys(mfServerSideData).length === 0) {
    return { block: "", count: 0 };
  }

  const lines: string[] = [];
  for (const [key, field] of Object.entries(FUND_FACT_FIELDS)) {
    const value = mfServerSideData[key];
    if (isEmpty(value)) {
      continue;
    }
    const formatted = field.format ? field.format(value) : formatScalar(value);
    if (formatted === "" || formatted.trim() === "") {
      continue;
    }
    lines.push(`${field.label}: ${formatted}`);
  }

  return {
    block: lines.join("\n"),
    count: lines.length,
  };
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim() === "";
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === "object") {
    return Object.values(value).every(isEmpty);
  }
  return false;
}

function formatScalar(value: unknown): string {
  if (typeof value === "number") {
    return value.toString();
  }
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  return String(value).trim();
}

function formatLockIn(value: unknown): string {
  const lockIn = value as { years?: number | null; months?: number | null; days?: number | null };
  const parts: string[] = [];
  if (lockIn.years) {
    parts.push(`${lockIn.years} year(s)`);
  }
  if (lockIn.months) {
    parts.push(`${lockIn.months} month(s)`);
  }
  if (lockIn.days) {
    parts.push(`${lockIn.days} day(s)`);
  }
  return parts.join(" ") || "";
}

function extractTitle(html: string): string | null {
  const match = /<\s*title\b[^>]*>([\s\S]*?)<\s*\/\s*title\s*>/i.exec(html);
  const title = match ? decodeEntities(match[1]).trim() : "";
  return title.length > 0 ? title : null;
}

function extractMetaDescription(html: string): string | null {
  const metaTags = html.match(META_TAG_PATTERN) ?? [];
  for (const tag of metaTags) {
    const name = getAttribute(tag, "name") ?? getAttribute(tag, "property");
    const content = getAttribute(tag, "content");
    if (name?.toLowerCase() === "description" && content) {
      return decodeEntities(content).trim();
    }
  }
  return null;
}

function getAttribute(tag: string, attribute: string): string | null {
  const pattern = new RegExp(
    `\\s${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i"
  );
  const match = pattern.exec(tag);
  if (!match) {
    return null;
  }
  return match[1] ?? match[2] ?? match[3] ?? null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      safeCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "\u2013")
    .replace(/&mdash;/g, "\u2014")
    .replace(/&hellip;/g, "\u2026");
}

function safeCodePoint(codePoint: number): string {
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return "";
  }
  return String.fromCodePoint(codePoint);
}

function normalizeWhitespace(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}