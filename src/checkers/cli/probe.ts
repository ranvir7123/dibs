// A small test call to each AI model, with timings, to see which ones answer right now.
//   npx tsx src/checkers/cli/probe.ts            lists the models this key can use and tries a few
//   npx tsx src/checkers/cli/probe.ts <model>... tries just those
import "../../db/cli/env";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY!.trim() });

async function attempt(model: string) {
  const started = Date.now();
  try {
    const r = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: "Say hello." }] }],
      config: { responseMimeType: "application/json", responseJsonSchema: z.toJSONSchema(z.object({ greeting: z.string() })), abortSignal: AbortSignal.timeout(60_000) },
    });
    console.log(`${model}: OK in ${Date.now() - started} ms: ${r.text?.replace(/\s+/g, " ").slice(0, 80)}`);
  } catch (error) {
    const e = error as { name?: string; status?: number; message?: string };
    console.log(`${model}: FAILED after ${Date.now() - started} ms. ${e.name} ${e.status ?? ""} ${String(e.message).replace(/\s+/g, " ").slice(0, 160)}`);
  }
}

async function main() {
  let models = process.argv.slice(2);
  if (models.length === 0) {
    const names: string[] = [];
    const pager = await ai.models.list();
    for await (const m of pager) {
      if (m.name && m.supportedActions?.includes("generateContent")) names.push(m.name.replace(/^models\//, ""));
    }
    console.log(`Models this key can ask (${names.length}): ${names.join(", ")}`);
    models = names.filter((n) => /^gemini-[34]/.test(n) && !/image|tts|audio|live|embedding/.test(n));
  }
  for (const model of models) await attempt(model);
}
main();
