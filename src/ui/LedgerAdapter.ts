/**
 * Connects AG Studio's AI part to our own server route (/api/ledger/ask),
 * which talks to Google's Gemini. The AI key never reaches the browser.
 *
 * AG Studio calls executeTurn once per turn. It wants two things back at once:
 * a stream of small events while the answer arrives, and a promise of the
 * finished answer. Browser code only.
 */
import type { AgAiEvent, AgAiOutputItem, AgLlmAdapter, AgLlmRequest, AgLlmResponse } from "ag-studio";
import type { AskBody, AskLine } from "@/app/api/ledger/ask/convert";

const ASK_URL = "/api/ledger/ask";

/** What the ask box says when the AI could not be reached at all. */
export const ASK_UNREACHABLE = "The AI could not be reached. Check your connection and try again. The ledger itself still works.";

let counter = 0;
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}`;

/** A queue the reader can loop over while the writer is still adding to it. */
function eventQueue() {
  const waiting: AgAiEvent[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  return {
    push(event: AgAiEvent) {
      waiting.push(event);
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    stream: {
      async *[Symbol.asyncIterator](): AsyncGenerator<AgAiEvent> {
        for (;;) {
          while (waiting.length > 0) yield waiting.shift()!;
          if (closed) return;
          await new Promise<void>((resolve) => (wake = resolve));
          wake = null;
        }
      },
    },
  };
}

/** Reads the route's answer one JSON line at a time. */
async function* readLines(response: Response): AsyncGenerator<AskLine> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let rest = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) rest += decoder.decode(value, { stream: true });
    let cut = rest.indexOf("\n");
    while (cut >= 0) {
      const line = rest.slice(0, cut).trim();
      rest = rest.slice(cut + 1);
      if (line) yield JSON.parse(line) as AskLine;
      cut = rest.indexOf("\n");
    }
    if (done) break;
  }
  if (rest.trim()) yield JSON.parse(rest) as AskLine;
}

/**
 * The adapter. `onTrouble` is told, in plain words, whenever a turn fails, so
 * the page can say so next to the ask box.
 */
export function ledgerAdapter(onTrouble?: (message: string | null) => void): AgLlmAdapter {
  // Gemini signs its tool calls and wants the signature back next turn; AG Studio has nowhere to keep it.
  const signatures: Record<string, string> = {};

  return {
    executeTurn(request: AgLlmRequest, options) {
      const queue = eventQueue();
      const id = newId("turn");
      const createdAt = Date.now();

      const failed = (code: string, message: string, cancelled = false): AgLlmResponse => {
        if (!cancelled) onTrouble?.(message);
        return { id, createdAt, output: [], status: cancelled ? "cancelled" : "failed", error: { code, message } };
      };

      const run = async (): Promise<AgLlmResponse> => {
        const body: AskBody = { input: request.input, instructions: request.instructions, tools: request.tools, toolChoice: request.toolChoice, responseFormat: request.responseFormat, signatures };
        let response: Response;
        try {
          response = await fetch(ASK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: options?.signal });
        } catch {
          return options?.signal?.aborted ? failed("cancelled", "Stopped.", true) : failed("unreachable", ASK_UNREACHABLE);
        }
        if (!response.ok || !response.body) {
          const told = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
          return failed(told?.code ?? `http_${response.status}`, told?.message ?? ASK_UNREACHABLE);
        }

        const output: AgAiOutputItem[] = [];
        let text = "";
        let messageId: string | null = null;
        let model: string | undefined;
        let usage: AgLlmResponse["usage"];
        let incomplete = false;
        const endMessage = () => {
          if (messageId === null) return;
          queue.push({ type: "TEXT_MESSAGE_END", messageId });
          output.push({ id: messageId, kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text, annotations: [] }] });
          messageId = null;
          text = "";
        };

        try {
          for await (const line of readLines(response)) {
            if (line.t === "text") {
              if (messageId === null) {
                messageId = newId("msg");
                queue.push({ type: "TEXT_MESSAGE_START", messageId, role: "assistant" });
              }
              text += line.d;
              queue.push({ type: "TEXT_MESSAGE_CONTENT", messageId, delta: line.d });
            } else if (line.t === "call") {
              endMessage();
              if (line.sig) signatures[line.id] = line.sig;
              queue.push({ type: "TOOL_CALL_START", toolCallId: line.id, toolCallName: line.name });
              queue.push({ type: "TOOL_CALL_ARGS", toolCallId: line.id, delta: line.args });
              queue.push({ type: "TOOL_CALL_END", toolCallId: line.id });
              output.push({ id: newId("fc"), kind: "output", type: "function_call", callId: line.id, name: line.name, arguments: line.args, status: "completed" });
            } else if (line.t === "done") {
              model = line.model;
              incomplete = line.finish === "MAX_TOKENS";
              if (line.usage) usage = { inputTokens: line.usage.input ?? 0, outputTokens: line.usage.output ?? 0, totalTokens: (line.usage.input ?? 0) + (line.usage.output ?? 0) } as AgLlmResponse["usage"];
            } else if (line.t === "error") {
              endMessage();
              return { ...failed(line.code, line.message), output };
            }
          }
        } catch {
          endMessage();
          return options?.signal?.aborted ? { ...failed("cancelled", "Stopped.", true), output } : { ...failed("cut_off", "The AI's answer was cut off. Please ask again. The ledger itself still works."), output };
        }
        endMessage();

        if (output.length === 0) return failed("empty", "The AI gave no answer. Please ask again.");
        onTrouble?.(null);
        return { id, createdAt, output, status: incomplete ? "incomplete" : "completed", ...(incomplete ? { incompleteDetails: { reason: "max_output_tokens" as const } } : {}), usage, model };
      };

      const complete = run().finally(() => queue.close());
      return { stream: queue.stream, complete };
    },
  };
}
