export interface Env {
  DB: D1Database;
  CRAWL_CACHE: R2Bucket;
  PIPELINE_QUEUE: Queue<PipelineMessage>;

  // secrets
  ANTHROPIC_API_KEY: string;
  RESEND_API_KEY?: string;
  CRON_TRIGGER_KEY: string;

  // plain vars (wrangler.toml)
  EMSD_EAF_EN_URL: string;
  EMSD_EAF_TC_URL: string;
  SITE_URL: string;
  SYSTEM_FROM_EMAIL: string;
  ALERT_EMAIL: string;
  EMAIL_DRY_RUN: string; // "1" until Resend domain is verified
}

export type PipelineMessage =
  | { type: "crawl" }
  | { type: "classify"; buildingId: string }
  | { type: "memo"; eafId: string }
  | { type: "digest_dispatch"; clientId: string; periodStart: string; periodEnd: string }
  | {
      type: "digest_email";
      clientId: string;
      periodStart: string;
      periodEnd: string;
      eafIds: string[];
    };

// Canonical district keys (18 HK districts)
export const DISTRICTS = [
  "central_western", "wan_chai", "eastern", "southern",
  "yau_tsim_mong", "sham_shui_po", "kowloon_city", "wong_tai_sin", "kwun_tong",
  "kwai_tsing", "tsuen_wan", "tuen_mun", "yuen_long", "north", "tai_po",
  "sha_tin", "sai_kung", "islands",
] as const;
export type District = (typeof DISTRICTS)[number];

// BEEO building-type taxonomy. NEW_SCOPE = categories entering the regime on commencement
// of the Amendment Ordinance 2025.
export const BUILDING_TYPES = [
  "commercial_office", "retail_mall", "hotel", "composite_commercial",
  "educational", "hospital_healthcare", "data_centre", "airport_terminal",
  "government", "community_cultural", "industrial", "transport_facility",
  "residential_common_area", "unknown",
] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

export const NEW_SCOPE_TYPES: ReadonlySet<string> = new Set([
  "educational", "hospital_healthcare", "data_centre", "airport_terminal",
  "government", "community_cultural", "transport_facility", "industrial",
  "residential_common_area",
]);

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function nowISO(): string {
  return new Date().toISOString();
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Queue sendBatch caps at 100 messages — chunk (Norway lesson, CodeChecking #90). */
export async function sendBatchChunked<T>(
  queue: Queue<T>,
  messages: { body: T; delaySeconds?: number }[],
): Promise<void> {
  for (let i = 0; i < messages.length; i += 100) {
    await queue.sendBatch(messages.slice(i, i + 100));
  }
}
