// LLM provider helpers (raw fetch — no SDK dependency in the Worker bundle).
// Supported providers: "anthropic" (default), "openai".
// Models: claude-haiku-4-5 / gpt-4o-mini for classification;
//         claude-sonnet-4-6 / gpt-4o for memos.

// ── Anthropic ──────────────────────────────────────────────────────────────

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

  const res = await fetch("https://api.anthropic.com/v1/messages", {
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

// ── OpenAI ─────────────────────────────────────────────────────────────────

interface OpenAIParams {
  apiKey: string;
  model: string;
  maxTokens: number;
  system?: string;
  user: string;
  jsonSchema?: Record<string, unknown>;
}

export async function openai(p: OpenAIParams): Promise<string> {
  const messages: { role: string; content: string }[] = [];
  if (p.system) messages.push({ role: "system", content: p.system });
  messages.push({ role: "user", content: p.user });

  const body: Record<string, unknown> = {
    model: p.model,
    max_tokens: p.maxTokens,
    messages,
  };
  if (p.jsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "output", schema: p.jsonSchema, strict: true },
    };
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${p.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`openai ${p.model} -> HTTP ${res.status}: ${detail.slice(0, 500)}`);
  }
  const data = (await res.json()) as {
    choices: { message: { content: string | null }; finish_reason: string }[];
  };
  const text = data.choices[0]?.message?.content;
  if (!text) throw new Error(`openai ${p.model} -> empty response`);
  return text;
}
