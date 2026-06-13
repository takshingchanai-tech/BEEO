// Bilingual outreach memo drafting.
// Anthropic: claude-sonnet-4-6  |  OpenAI: gpt-4o
// Provider selected by env.LLM_PROVIDER ("anthropic" default, "openai" alternative).
// Hallucination guard: the prompt embeds the only statutory facts the model may cite.

import { claude, openai } from "./llm";
import { nowISO, type Env } from "./types";

const SYSTEM_PROMPT = `You draft short, professional outreach memos for Hong Kong building-services engineering firms (Registered Energy Assessors, REAs) to send to building owners or managers about upcoming statutory energy-audit deadlines.

STATUTORY FACTS YOU MAY CITE (cite nothing else — no other section numbers, no quoted ordinance text):
- The Buildings Energy Efficiency Ordinance (Cap. 610) requires owners of regulated buildings to commission an energy audit of four key central building services installations by a Registered Energy Assessor, and to display the resulting Energy Audit Form (EAF) at the building's main entrance.
- The Buildings Energy Efficiency (Amendment) Ordinance 2025 (effective 20 September 2026) extends the audit regime to additional building types and shortens the audit interval from 10 years to 5 years.
- The Building Energy Code and Energy Audit Code 2024 editions took effect on 23 August 2025 and apply to audits conducted from that date.
- Non-compliance is an offence under the Ordinance.

RULES:
- Write BOTH an English memo and a Traditional Chinese (Hong Kong usage) memo with equivalent content.
- 120-180 words each. Professional, factual, no scare tactics, no hard sell.
- State the building's name, its specific deadline date, and which code edition will govern the audit (these are provided).
- Close with a neutral call to action (arrange a preliminary assessment / request a fee proposal).
- Use a placeholder [FIRM NAME] for the sender, since different subscribers will reuse the memo.
- Do not invent contact details, fees, building facts, or legal consequences beyond the facts above.`;

const SCHEMA = {
  type: "object",
  properties: {
    memo_en: { type: "string" },
    memo_zh: { type: "string" },
  },
  required: ["memo_en", "memo_zh"],
  additionalProperties: false,
} as const;

export async function draftMemo(env: Env, eafId: string): Promise<void> {
  const row = await env.DB.prepare(`
    SELECT e.id, e.deadline_new_regime, e.expiry_published, e.code_edition,
           b.name_en, b.name_zh, b.address_en, b.address_zh, b.building_type
    FROM eaf_records e JOIN buildings b ON b.id = e.building_id
    WHERE e.id = ?
  `).bind(eafId).first<{
    id: string; deadline_new_regime: string; expiry_published: string; code_edition: string;
    name_en: string | null; name_zh: string | null; address_en: string;
    address_zh: string | null; building_type: string | null;
  }>();
  if (!row) return;

  const user = [
    `Building name (EN): ${row.name_en ?? row.address_en}`,
    `Building name (繁中): ${row.name_zh ?? row.address_zh ?? "—"}`,
    `Address (EN): ${row.address_en}`,
    `Address (繁中): ${row.address_zh ?? "—"}`,
    `Building category: ${row.building_type ?? "commercial"}`,
    `Current EAF expiry (published): ${row.expiry_published}`,
    `Computed next-audit deadline under the amended Ordinance: ${row.deadline_new_regime}`,
    `Governing code edition for the next audit: ${row.code_edition}`,
  ].join("\n");

  const provider = env.LLM_PROVIDER ?? "anthropic";
  let raw: string;

  if (provider === "openai") {
    raw = await openai({
      apiKey: env.OPENAI_API_KEY!,
      model: "gpt-4o",
      maxTokens: 2048,
      system: SYSTEM_PROMPT,
      user,
      jsonSchema: SCHEMA as unknown as Record<string, unknown>,
    });
  } else {
    raw = await claude({
      apiKey: env.ANTHROPIC_API_KEY!,
      model: "claude-sonnet-4-6",
      maxTokens: 2048,
      system: [{ text: SYSTEM_PROMPT, cache: true }],
      user,
      jsonSchema: SCHEMA as unknown as Record<string, unknown>,
    });
  }

  const out = JSON.parse(raw) as { memo_en: string; memo_zh: string };
  await env.DB.prepare(
    "UPDATE eaf_records SET memo_en=?, memo_zh=?, memo_generated_at=? WHERE id=?",
  ).bind(out.memo_en, out.memo_zh, nowISO(), eafId).run();
}
