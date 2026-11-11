/**
 * Turns one AG Studio AI turn into the shape Google's Gemini reads, and names
 * the small messages our route streams back to the browser.
 *
 * AG Studio speaks in "conversation items" (a user message, the AI's message,
 * a tool call, a tool's result). Gemini speaks in "contents" with "parts".
 * Plain functions only, so they can be tested without calling any AI.
 */
import type { Content, FunctionDeclaration, Part } from "@google/genai";
import type { AgAiConversationItem, AgAiToolSchema, AgLlmRequest } from "ag-studio";

/** What the browser sends: AG Studio's turn, plus Gemini's own marks for earlier tool calls. */
export interface AskBody {
  input: AgAiConversationItem[];
  instructions?: string;
  tools?: AgAiToolSchema[];
  toolChoice?: AgLlmRequest["toolChoice"];
  responseFormat?: AgLlmRequest["responseFormat"];
  /**
   * Gemini signs each tool call it makes and wants that signature back on the
   * next turn. AG Studio has no place to keep it, so the browser keeps it by
   * call id and sends the lot back here.
   */
  signatures?: Record<string, string>;
}

/** One line of the answer stream (each line is one JSON object). */
export type AskLine =
  | { t: "text"; d: string }
  | { t: "call"; id: string; name: string; args: string; sig?: string }
  | { t: "done"; model: string; finish?: string; usage?: { input?: number; output?: number } }
  | { t: "error"; code: string; message: string };

/**
 * Google documents this value as the stand-in for a tool call whose real
 * signature was lost (for example after the page was reloaded mid-chat).
 */
const NO_SIGNATURE = "context_engineering_is_the_way_to_go";

function parseArgs(json: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(json || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The conversation as Gemini contents. Neighbouring items from the same side are joined, as Gemini expects turns to alternate. */
export function toContents(input: AgAiConversationItem[], signatures: Record<string, string> = {}): Content[] {
  const contents: Content[] = [];
  const nameOfCall = new Map<string, string>();
  const push = (role: "user" | "model", part: Part) => {
    const last = contents.at(-1);
    if (last && last.role === role) last.parts!.push(part);
    else contents.push({ role, parts: [part] });
  };

  for (const item of input) {
    if (item.type === "message" && item.kind === "input") {
      for (const piece of item.content) if (piece.type === "text" && piece.text) push("user", { text: piece.text });
    } else if (item.type === "message" && item.kind === "output") {
      for (const piece of item.content) {
        if (piece.type === "text" && piece.text) push("model", { text: piece.text });
        else if (piece.type === "refusal" && piece.refusal) push("model", { text: piece.refusal });
      }
    } else if (item.type === "function_call") {
      nameOfCall.set(item.callId, item.name);
      // Only the first call of a model turn carries a signature; later ones in the same turn need none.
      const last = contents.at(-1);
      const firstOfTurn = !(last && last.role === "model" && last.parts!.some((p) => p.functionCall));
      const signature = signatures[item.callId] ?? (firstOfTurn ? NO_SIGNATURE : undefined);
      push("model", { functionCall: { id: item.callId, name: item.name, args: parseArgs(item.arguments) }, ...(signature ? { thoughtSignature: signature } : {}) });
    } else if (item.type === "function_call_output") {
      push("user", { functionResponse: { id: item.callId, name: nameOfCall.get(item.callId) ?? "unknown_tool", response: { result: item.output } } });
    }
    // Reasoning items are the AI's own notes and are not sent back.
  }
  return contents;
}

/** The tools as Gemini function declarations. Tools a provider runs by itself are left out: Gemini has none of AG's. */
export function toDeclarations(tools: AgAiToolSchema[] = []): FunctionDeclaration[] {
  return tools.filter((tool) => tool.kind !== "provided").map((tool) => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters }));
}

/** Rough size check so a stranger cannot post a huge body. */
export function looksLikeAskBody(value: unknown): value is AskBody {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<AskBody>;
  return Array.isArray(body.input) && body.input.length > 0 && (body.tools === undefined || Array.isArray(body.tools));
}
