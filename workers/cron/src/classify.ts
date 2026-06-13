// Building classification with structured output.
// Anthropic: claude-haiku-4-5  |  OpenAI: gpt-4o-mini
// Provider selected by env.LLM_PROVIDER ("anthropic" default, "openai" alternative).

import { claude, openai } from "./llm";
import { BUILDING_TYPES, DISTRICTS, NEW_SCOPE_TYPES, nowISO, type Env } from "./types";

const SYSTEM_PROMPT = `You classify Hong Kong buildings for compliance with the Buildings Energy Efficiency Ordinance (Cap. 610, "BEEO") and its 2025 Amendment.

You receive a building's bilingual name and address from the official EMSD Energy Audit Form register. Classify it.

Categories (choose exactly one):
- commercial_office: office towers, business centres
- retail_mall: shopping centres, retail podiums, markets
- hotel: hotels, serviced apartments operated as hotels
- composite_commercial: mixed residential+commercial buildings (commercial portion is regulated)
- educational: schools, universities, kindergartens, training institutes
- hospital_healthcare: hospitals, clinics, elderly care homes, medical centres
- data_centre: data centres, telecom exchanges
- airport_terminal: airport passenger/cargo terminals
- government: government-owned office or service buildings
- community_cultural: community halls, libraries, museums, performance venues, sports centres
- industrial: factories, industrial buildings, godowns/warehouses
- transport_facility: railway stations, bus termini, ferry piers
- residential_common_area: purely residential estates (only common areas regulated)
- unknown: cannot determine from the information given

District: assign one of the 18 Hong Kong districts from the address. Hong Kong Island: central_western, wan_chai, eastern, southern. Kowloon: yau_tsim_mong, sham_shui_po, kowloon_city, wong_tai_sin, kwun_tong. New Territories: kwai_tsing, tsuen_wan, tuen_mun, yuen_long, north, tai_po, sha_tin, sai_kung, islands.

Confidence: 0 to 1. Use < 0.7 when the name/address is genuinely ambiguous.
Be conservative: prefer "unknown" with low confidence over guessing a specific category.`;

const SCHEMA = {
  type: "object",
  properties: {
    building_type: { type: "string", enum: [...BUILDING_TYPES] },
    district: { type: "string", enum: [...DISTRICTS, "unknown"] },
    confidence: { type: "number" },
    reasoning: { type: "string" },
  },
  required: ["building_type", "district", "confidence", "reasoning"],
  additionalProperties: false,
} as const;

export async function classifyBuilding(env: Env, buildingId: string): Promise<void> {
  const b = await env.DB.prepare(
    "SELECT id, name_en, name_zh, address_en, address_zh FROM buildings WHERE id = ?",
  ).bind(buildingId).first<{
    id: string; name_en: string | null; name_zh: string | null;
    address_en: string; address_zh: string | null;
  }>();
  if (!b) return;

  const user = [
    `Name (EN): ${b.name_en ?? "—"}`,
    `Name (繁中): ${b.name_zh ?? "—"}`,
    `Address (EN): ${b.address_en}`,
    `Address (繁中): ${b.address_zh ?? "—"}`,
  ].join("\n");

  const provider = env.LLM_PROVIDER ?? "anthropic";
  let raw: string;

  if (provider === "openai") {
    raw = await openai({
      apiKey: env.OPENAI_API_KEY!,
      model: "gpt-4o-mini",
      maxTokens: 1024,
      system: SYSTEM_PROMPT,
      user,
      jsonSchema: SCHEMA as unknown as Record<string, unknown>,
    });
  } else {
    raw = await claude({
      apiKey: env.ANTHROPIC_API_KEY!,
      model: "claude-haiku-4-5",
      maxTokens: 1024,
      system: [{ text: SYSTEM_PROMPT, cache: true }],
      user,
      jsonSchema: SCHEMA as unknown as Record<string, unknown>,
    });
  }

  const out = JSON.parse(raw) as {
    building_type: string; district: string; confidence: number; reasoning: string;
  };
  const type = out.confidence < 0.7 ? "unknown" : out.building_type;

  await env.DB.prepare(`
    UPDATE buildings SET building_type=?, district=?, is_new_scope=?,
      classification_confidence=?, classification_raw=?, classified_at=?
    WHERE id=?
  `).bind(
    type,
    out.district === "unknown" ? null : out.district,
    NEW_SCOPE_TYPES.has(type) ? 1 : 0,
    out.confidence,
    raw,
    nowISO(),
    buildingId,
  ).run();
}
