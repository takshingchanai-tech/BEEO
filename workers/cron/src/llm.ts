// Claude API helpers (raw fetch — no SDK dependency in the Worker bundle).
// Models per build plan: claude-haiku-4-5 for classification, claude-sonnet-4-6 for memos.

const API_URL = "https://api.anthropic.com/v1/messages";

interface ClaudeParams {
  apiKey: string;
  model: string;
  maxTokens: number;
  system?: { text: string; cache?: boolean }[];
  user: string;
  jsonSchema?: Record<string, unknown>;
}

export async function claude(p: ClaudeParams): Promise<string> {
  const body: Record<string, unknown> = {
    model: p.model,
    max_tokens: p.maxTokens,
    messages: [{ role: "user", content: p.user }],
  };
  if (p.system) {
    body.system = p.system.map((s) => ({
      type: "text",
      text: s.text,
      ...(s.cache ? { cache_control: { type: "ephemeral" } } : {}),
    }));
  }
  if (p.jsonSchema) {
    body.output_config = { format: { type: "json_schema", schema: p.jsonSchema } };
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": p.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`claude ${p.model} -> HTTP ${res.status}: ${detail.slice(0, 500)}`);
  }
  const data = (await res.json()) as {
    content: { type: string; text?: string }[];
    stop_reason: string;
  };
  if (data.stop_reason === "refusal") throw new Error("claude refusal");
  const text = data.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error(`claude ${p.model} -> empty response (stop: ${data.stop_reason})`);
  return text;
}
