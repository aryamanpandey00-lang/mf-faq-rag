import type { SchemeSource } from "../lib/types";

export const APPROVED_DOMAIN = "groww.in";

export const APPROVED_SOURCES: readonly SchemeSource[] = [
  {
    schemeId: "hdfc-large-cap",
    schemeName: "HDFC Large Cap Fund Direct Growth",
    url: "https://groww.in/mutual-funds/hdfc-large-cap-fund-direct-growth",
    domain: APPROVED_DOMAIN,
    identityKeywords: ["large cap"],
  },
  {
    schemeId: "hdfc-flexi-cap",
    schemeName: "HDFC Flexi Cap Fund Direct Growth",
    url: "https://groww.in/mutual-funds/hdfc-equity-fund-direct-growth",
    domain: APPROVED_DOMAIN,
    identityKeywords: ["flexi cap"],
  },
  {
    schemeId: "hdfc-elss",
    schemeName: "HDFC ELSS Tax Saver Fund Direct Plan Growth",
    url: "https://groww.in/mutual-funds/hdfc-elss-tax-saver-fund-direct-plan-growth",
    domain: APPROVED_DOMAIN,
    identityKeywords: ["elss", "tax saver"],
  },
  {
    schemeId: "hdfc-small-cap",
    schemeName: "HDFC Small Cap Fund Direct Growth",
    url: "https://groww.in/mutual-funds/hdfc-small-cap-fund-direct-growth",
    domain: APPROVED_DOMAIN,
    identityKeywords: ["small cap"],
  },
  {
    schemeId: "hdfc-balanced-advantage",
    schemeName: "HDFC Balanced Advantage Fund Direct Growth",
    url: "https://groww.in/mutual-funds/hdfc-balanced-advantage-fund-direct-growth",
    domain: APPROVED_DOMAIN,
    identityKeywords: ["balanced advantage"],
  },
];

export const APPROVED_URLS: ReadonlySet<string> = new Set(
  APPROVED_SOURCES.map((source) => source.url)
);

export function isApprovedUrl(url: string): boolean {
  return APPROVED_URLS.has(url);
}

export function getSourceByUrl(url: string): SchemeSource | undefined {
  return APPROVED_SOURCES.find((source) => source.url === url);
}

export function getSourceBySchemeId(schemeId: string): SchemeSource | undefined {
  return APPROVED_SOURCES.find((source) => source.schemeId === schemeId);
}