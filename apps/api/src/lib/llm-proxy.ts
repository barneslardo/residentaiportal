import { config } from "../config.js";
import type { ToolDef } from "../tools/types.js";

export type ChatMessage = { role: string; content: string };

export type ToolTrace = {
  tool: string;
  allowed: boolean;
  requiredScopes: string[];
  durationMs: number;
  denyReason?: string;
};

export type RunToolFn = (
  name: string,
  input: Record<string, unknown>
) => Promise<{ result: unknown; allowed: boolean; requiredScopes: string[]; durationMs: number }>;

const MAX_ROUNDS = 8;

function openAiStyleTools(tools: readonly ToolDef[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

type OpenAiChoice = {
  finish_reason?: string;
  message?: {
    content?: string;
    tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  };
};

/** OpenAI-compatible loop — used for both xAI Grok and OpenAI. */
async function runOpenAiCompatibleLoop(opts: {
  endpoint: string;
  apiKey: string;
  label: string;
  systemPrompt: string;
  messages: ChatMessage[];
  model: string;
  tools: readonly ToolDef[];
  runTool: RunToolFn;
  trace: ToolTrace[];
}): Promise<string> {
  const tools = openAiStyleTools(opts.tools);
  const loopMessages: Array<Record<string, unknown>> = [
    { role: "system", content: opts.systemPrompt },
    ...opts.messages,
  ];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const resp = await fetch(opts.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: loopMessages,
        ...(tools.length ? { tools } : {}),
        max_tokens: 4096,
      }),
    });
    if (!resp.ok) throw new Error(`${opts.label} error ${resp.status}: ${await resp.text()}`);

    const data = (await resp.json()) as { choices?: OpenAiChoice[] };
    const choice = data.choices?.[0];
    if (choice?.finish_reason !== "tool_calls" || !choice.message?.tool_calls?.length) {
      return choice?.message?.content || "I don't have a response for that.";
    }

    loopMessages.push(choice.message as Record<string, unknown>);
    for (const call of choice.message.tool_calls) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(call.function.arguments) as Record<string, unknown>;
      } catch {
        /* model emitted malformed JSON — let the tool's schema validation answer */
      }
      const outcome = await opts.runTool(call.function.name, input);
      opts.trace.push({
        tool: call.function.name,
        allowed: outcome.allowed,
        requiredScopes: outcome.requiredScopes,
        durationMs: outcome.durationMs,
        denyReason:
          !outcome.allowed && typeof outcome.result === "object" && outcome.result !== null
            ? ((outcome.result as { error?: string }).error ?? undefined)
            : undefined,
      });
      loopMessages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(outcome.result),
      });
    }
  }
  return "I hit the tool-call limit on that one. Try asking for a smaller piece of it.";
}

type AnthropicBlock = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
};

async function runAnthropicLoop(opts: {
  apiKey: string;
  systemPrompt: string;
  messages: ChatMessage[];
  model: string;
  tools: readonly ToolDef[];
  runTool: RunToolFn;
  trace: ToolTrace[];
}): Promise<string> {
  const tools = opts.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
  const loopMessages: Array<Record<string, unknown>> = opts.messages.filter((m) => m.role !== "system");

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: 4096,
        system: opts.systemPrompt,
        ...(tools.length ? { tools } : {}),
        messages: loopMessages,
      }),
    });
    if (!resp.ok) throw new Error(`Anthropic error ${resp.status}: ${await resp.text()}`);

    const data = (await resp.json()) as { stop_reason?: string; content?: AnthropicBlock[] };
    const blocks = data.content ?? [];
    if (!blocks.some((b) => b.type === "tool_use")) {
      return blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n") || "I don't have a response for that.";
    }

    loopMessages.push({ role: "assistant", content: blocks });
    const toolResults: Array<Record<string, unknown>> = [];
    for (const block of blocks) {
      if (block.type !== "tool_use" || !block.id) continue;
      const outcome = await opts.runTool(block.name ?? "", block.input ?? {});
      opts.trace.push({
        tool: block.name ?? "",
        allowed: outcome.allowed,
        requiredScopes: outcome.requiredScopes,
        durationMs: outcome.durationMs,
      });
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(outcome.result),
      });
    }
    loopMessages.push({ role: "user", content: toolResults });
  }
  return "I hit the tool-call limit on that one. Try asking for a smaller piece of it.";
}

type ModelEntry = { id: string; label: string; provider: "grok" | "openai" | "anthropic" };

const MODEL_CATALOG: ModelEntry[] = [
  { id: "grok-4.3", label: "Grok 4.3 (xAI)", provider: "grok" },
  { id: "grok-4.3-fast", label: "Grok 4.3 Fast (xAI)", provider: "grok" },
  { id: "gpt-4o", label: "GPT-4o", provider: "openai" },
  { id: "gpt-4o-mini", label: "GPT-4o mini", provider: "openai" },
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", provider: "anthropic" },
];

function keyFor(provider: ModelEntry["provider"]): string {
  if (provider === "grok") return config.llm.grokKey;
  if (provider === "openai") return config.llm.openaiKey;
  return config.llm.anthropicKey;
}

export function isModelLocked(): boolean {
  return Boolean(config.llm.lockedModel);
}

/**
 * Models this deployment will actually run.
 *
 * When CHAT_LOCKED_MODEL is set this is a single entry — and because
 * runChatCompletion resolves against the same list, an unavailable model cannot
 * be reached by asking for it directly.
 */
export function listAvailableChatModels(): ModelEntry[] {
  const usable = MODEL_CATALOG.filter((m) => keyFor(m.provider));
  if (!config.llm.lockedModel) return usable;
  return usable.filter((m) => m.id === config.llm.lockedModel);
}

export async function runChatCompletion(opts: {
  systemPrompt: string;
  messages: ChatMessage[];
  model?: string;
  tools: readonly ToolDef[];
  runTool: RunToolFn;
}): Promise<{ content: string; provider: string; model: string; toolTrace: ToolTrace[] }> {
  const allowed = listAvailableChatModels();
  if (!allowed.length) {
    throw new Error(
      config.llm.lockedModel
        ? `The assistant is pinned to ${config.llm.lockedModel}, but that provider's API key is not configured.`
        : "No LLM provider configured — set GROK_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY"
    );
  }

  // Resolve strictly against the allowed list. A requested model that isn't on
  // it is ignored rather than honoured — this is the enforcement point, and it
  // sits behind the HTTP layer so no caller can route around it.
  const requested = allowed.find((m) => m.id === opts.model);
  const chosen = requested ?? allowed[0];
  if (opts.model && !requested) {
    console.warn(
      `[chat] ignoring requested model "${opts.model}" — this deployment allows ${allowed
        .map((m) => m.id)
        .join(", ")}`
    );
  }
  const provider = chosen.provider;
  const model = chosen.id;
  const trace: ToolTrace[] = [];

  let content: string;
  if (provider === "anthropic") {
    content = await runAnthropicLoop({
      apiKey: config.llm.anthropicKey,
      systemPrompt: opts.systemPrompt,
      messages: opts.messages,
      model,
      tools: opts.tools,
      runTool: opts.runTool,
      trace,
    });
  } else {
    content = await runOpenAiCompatibleLoop({
      endpoint:
        provider === "grok"
          ? "https://api.x.ai/v1/chat/completions"
          : "https://api.openai.com/v1/chat/completions",
      apiKey: provider === "grok" ? config.llm.grokKey : config.llm.openaiKey,
      label: provider === "grok" ? "xAI" : "OpenAI",
      systemPrompt: opts.systemPrompt,
      messages: opts.messages,
      model,
      tools: opts.tools,
      runTool: opts.runTool,
      trace,
    });
  }

  return { content, provider, model, toolTrace: trace };
}
