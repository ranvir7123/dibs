// /api/ledger/ask: one turn of the Ledger's ask box.
//
// AG Studio's AI part runs in the browser and needs a model to talk to. The
// browser sends each turn here; this route passes it to Google's Gemini with
// the key kept on the server, and streams the answer back one JSON line at a time.
//
// Who may call it: only a browser that has chosen who it is (the dibs_person
// cookie must name a real person), and only so many turns in a while, so a
// stranger cannot burn the AI key. The ledger's rows are never sent from here:
// the browser already has its own rows and nobody else's.
import { ApiError, FunctionCallingConfigMode, GoogleGenAI, type Content, type GenerateContentConfig } from "@google/genai";
import { MODELS } from "@/ai/models";
import { getViewer } from "@/ui/viewer";
import { looksLikeAskBody, toContents, toDeclarations, type AskBody, type AskLine } from "./convert";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** The biggest turn accepted, in characters. A real turn (chat so far plus AG Studio's tool list) is far smaller. */
const MAX_BODY_CHARS = 600_000;
/** How long one model gets to send the first piece of its answer before the next model is tried. */
const FIRST_PIECE_MS = 15_000;
/** How long one whole answer may take. */
const TRY_MS = 90_000;
/** When every model says the key has made too many calls this minute: how long to wait before each further round. */
const WAITS_MS = [10_000, 20_000] as const;

/**
 * How many turns are allowed. One typed question takes several turns (the AI
 * looks at the data, then builds a chart, then answers), so these are turns,
 * not questions. Counted in this server's memory: enough for one small server.
 */
const LIMITS = {
  perPerson: { turns: 90, windowMs: 10 * 60_000 },
  everyone: { turns: 900, windowMs: 60 * 60_000 },
} as const;

/** Added to AG Studio's own instructions on every turn, so answers read like the rest of Dibs. */
const HOUSE_RULES = [
  "House rules for this dashboard:",
  "- The reader runs a small business and is not technical. Answer in short, plain, everyday sentences.",
  "- All money is in US dollars. Always write it with a dollar sign and two decimals, for example $8.30.",
  "- Never show field ids, table ids, widget ids or row ids in your final answer. Use the names people see, such as Paid or Released back.",
  "- Only use numbers that come from the data. If the data cannot answer the question, say so in one sentence.",
].join("\n");

const holder = globalThis as unknown as { __ledgerAskHits?: Map<string, number[]>; __ledgerAskModel?: string };
const hits = (holder.__ledgerAskHits ??= new Map<string, number[]>());

/** Counts this turn against a key. Returns the seconds to wait when the key is over its limit, else 0. */
function overLimit(key: string, limit: { turns: number; windowMs: number }, now: number): number {
  const recent = (hits.get(key) ?? []).filter((at) => now - at < limit.windowMs);
  if (recent.length >= limit.turns) {
    hits.set(key, recent);
    return Math.max(1, Math.ceil((recent[0] + limit.windowMs - now) / 1000));
  }
  recent.push(now);
  hits.set(key, recent);
  return 0;
}

function refuse(status: number, code: string, message: string, headers?: Record<string, string>): Response {
  return Response.json({ ok: false, code, message }, { status, headers });
}

const statusOf = (error: unknown) => (error instanceof ApiError ? error.status : undefined);
const timedOut = (error: unknown) => error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError" || /aborted|timed? ?out/i.test(error.message));
/** Too busy or briefly broken: the next model is worth a try. */
const busy = (error: unknown) => {
  const status = statusOf(error);
  return status === 429 || (status !== undefined && status >= 500) || timedOut(error);
};

/** An AI failure in plain words. Never includes the key or Google's raw text. */
function plain(error: unknown): { code: string; message: string } {
  const status = statusOf(error);
  if (status === 401 || status === 403) return { code: "key_refused", message: "The AI key was refused, so the ask box is off. The ledger itself still works." };
  if (status === 429) return { code: "busy", message: "The AI has answered as many questions as its key allows for now. Please try again in a minute. The ledger itself still works." };
  if (busy(error)) return { code: "busy", message: "The AI is too busy to answer right now. Please try again in a minute. The ledger itself still works." };
  return { code: "failed", message: `The AI could not answer (error ${status ?? "unknown"}). Please try again. The ledger itself still works.` };
}

function configFor(body: AskBody, signal: AbortSignal): GenerateContentConfig {
  const declarations = toDeclarations(body.tools);
  const choice = body.toolChoice;
  const config: GenerateContentConfig = {
    systemInstruction: [body.instructions, HOUSE_RULES].filter(Boolean).join("\n\n"),
    abortSignal: signal,
    httpOptions: { timeout: TRY_MS, retryOptions: { attempts: 1 } },
  };
  if (declarations.length > 0 && choice !== "none") {
    config.tools = [{ functionDeclarations: declarations }];
    config.toolConfig = {
      functionCallingConfig:
        choice === "required" ? { mode: FunctionCallingConfigMode.ANY } : choice && typeof choice === "object" ? { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: [choice.name] } : { mode: FunctionCallingConfigMode.AUTO },
    };
  } else if (body.responseFormat?.type === "json") {
    config.responseMimeType = "application/json";
    config.responseJsonSchema = body.responseFormat.schema;
  }
  return config;
}

type Send = (line: AskLine) => void;

/**
 * Asks one model and streams its answer out. Returns "done" when the answer
 * is complete. Throws when the model fails; `started` on the error says whether
 * part of an answer had already gone out (then no other model can pick it up).
 */
async function askModel(ai: GoogleGenAI, model: string, contents: Content[], ask: AskBody, request: Request, send: Send, callIds: { next: number; stamp: string }): Promise<void> {
  let started = false;
  const slow = new AbortController();
  const firstPiece = setTimeout(() => slow.abort(new DOMException("No answer started in time", "TimeoutError")), FIRST_PIECE_MS);
  try {
    const signal = AbortSignal.any([request.signal, slow.signal, AbortSignal.timeout(TRY_MS)]);
    const chunks = await ai.models.generateContentStream({ model, contents, config: configFor(ask, signal) });
    let finish: string | undefined;
    let usage: { input?: number; output?: number } | undefined;
    for await (const chunk of chunks) {
      clearTimeout(firstPiece);
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        if (part.thought) continue; // the model's own notes are not shown
        if (part.text) {
          started = true;
          send({ t: "text", d: part.text });
        } else if (part.functionCall?.name) {
          started = true;
          callIds.next += 1;
          send({ t: "call", id: part.functionCall.id || `call_${callIds.stamp}_${callIds.next}`, name: part.functionCall.name, args: JSON.stringify(part.functionCall.args ?? {}), sig: part.thoughtSignature });
        }
      }
      finish = chunk.candidates?.[0]?.finishReason ?? finish;
      if (chunk.usageMetadata) usage = { input: chunk.usageMetadata.promptTokenCount, output: chunk.usageMetadata.candidatesTokenCount };
    }
    send({ t: "done", model, finish, usage });
  } catch (error) {
    throw Object.assign(new Error("model failed"), { cause: error, started });
  } finally {
    clearTimeout(firstPiece);
  }
}

export async function POST(request: Request): Promise<Response> {
  // LEDGER_AI_API_KEY lets the ask box use its own Google key, so its questions never use up the calls the video checks need.
  const key = process.env.LEDGER_AI_API_KEY?.trim() || process.env.GOOGLE_AI_API_KEY?.trim();
  if (!key) return refuse(503, "no_key", "The ask box is off because no AI key is set (GOOGLE_AI_API_KEY). The ledger itself still works.");

  const viewer = await getViewer();
  if (!viewer) return refuse(401, "no_viewer", "Say who you are first, then ask again.");

  const now = Date.now();
  const wait = overLimit(`person:${viewer.id}`, LIMITS.perPerson, now) || overLimit("everyone", LIMITS.everyone, now);
  if (wait > 0) return refuse(429, "limit", `That is a lot of questions in a short time. Please try again in ${wait < 90 ? `${wait} seconds` : `${Math.ceil(wait / 60)} minutes`}.`, { "Retry-After": String(wait) });

  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return refuse(413, "too_big", "This chat has grown too long. Start a new chat and ask again.");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  if (!looksLikeAskBody(body)) return refuse(400, "bad_request", "The question did not arrive in a shape that could be read.");
  const ask: AskBody = body;

  const contents = toContents(ask.input, ask.signatures);
  if (contents.length === 0) return refuse(400, "bad_request", "There was no question to answer.");

  const ai = new GoogleGenAI({ apiKey: key });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send: Send = (line) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      const callIds = { next: 0, stamp: `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}` };
      let last: unknown = new Error("no model was tried");

      // The key allows only so many calls a minute. When every model says "too many", wait a little and go round again.
      rounds: for (let round = 0; round <= WAITS_MS.length; round++) {
        if (round > 0) await new Promise((resolve) => setTimeout(resolve, WAITS_MS[round - 1]));
        if (request.signal.aborted) break;
        // The model that answered last time goes first, so a busy model is not waited for on every turn.
        const models = [...MODELS.geminiText].sort((a, b) => Number(b === holder.__ledgerAskModel) - Number(a === holder.__ledgerAskModel));
        for (const model of models) {
          try {
            await askModel(ai, model, contents, ask, request, send, callIds);
            holder.__ledgerAskModel = model;
            controller.close();
            return;
          } catch (wrapped) {
            const { cause, started } = wrapped as { cause: unknown; started: boolean };
            last = cause;
            if (started || !busy(cause) || request.signal.aborted) break rounds;
          }
        }
        if (statusOf(last) !== 429) break;
      }

      if (!request.signal.aborted) {
        console.error(`Ledger ask box: the AI did not answer (status ${statusOf(last) ?? "none"}): ${last instanceof Error ? last.message.replace(/\s+/g, " ").slice(0, 300) : "unknown"}`);
        send({ t: "error", ...plain(last) });
      }
      controller.close();
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
