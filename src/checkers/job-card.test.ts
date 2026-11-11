import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AiKeyMissing, AiTrouble, useAi } from "@/ai";
import { closeDb, getDb } from "@/db/client";
import { seed } from "@/db/seed";
import { createJob } from "@/db/write";
import { settings } from "@/settings";
import { writeJobCard } from "./index";
import { buildCard, type CardDraft } from "./job-card";

// EXAMPLE answers, written by hand in the shape AI is asked for. They are NOT
// real AI output: they prove what the code does with a draft, not what AI writes.
const EXAMPLE_VIEWS: CardDraft = {
  title: "Get our launch video 10,000 views",
  category: "promotion",
  finishLine: "10,000 views on your launch video",
  targetUnit: "view",
  targetCount: 10000,
  evidence: ["public_page", "ai_watch", "tracked_link"],
  handIn: "link",
  machineCheckable: true,
  mustShow: [
    { id: "Names Brand", label: "Names Kettle & Clove", detail: "The brand's name is said or shown." },
    { id: "shows_link", label: "Shows your link", detail: "The worker's link is on screen." },
  ],
  cheatTests: ["view_jump", "views_without_likes", "repeat_visitor", "click_burst"],
  howChecked: ["Views are read from the video site's own count."],
  checkedByLine: "The video site's own view count",
  cheatTestsLine: "Sudden jumps in views.",
  payKind: "per_unit",
  unit: "view",
  unitLabel: "views",
  centsPerBatch: 200,
  batchSize: 1000,
  centsPerRule: 0,
  payRules: [],
  onceCents: 0,
  capCents: 5000,
  daysToRun: 14,
  proofNote: "Views can be bought.",
  proofTip: "",
  targetUrl: "https://kettleandclove.example.com/launch",
};
const EXAMPLE_TRANSLATION: CardDraft = {
  ...EXAMPLE_VIEWS,
  title: "Translate our menu into Hindi",
  category: "writing",
  finishLine: "The menu, fully translated into Hindi",
  targetUnit: "none",
  targetCount: 0,
  evidence: ["ai_read"],
  handIn: "file",
  machineCheckable: false,
  mustShow: [],
  cheatTests: [],
  howChecked: ["AI reads your file against the menu."],
  payKind: "once",
  unit: "none",
  unitLabel: "",
  centsPerBatch: 0,
  batchSize: 0,
  onceCents: 1800,
  capCents: 1800,
  daysToRun: 40,
  targetUrl: "",
};

const NOW = new Date("2026-11-10T12:00:00Z");

describe("building a job card from AI's draft (EXAMPLE drafts, not real AI output)", () => {
  it("writes the pay sentences itself, exactly", () => {
    const card = buildCard(EXAMPLE_VIEWS, NOW);
    expect(card.payLine).toBe("$2.00 for every 1,000 views");
    expect(card.payNote).toBe("Up to $50.00 in total");
    expect(card.payRule).toEqual({ kind: "per_unit", unit: "view", unitLabel: "views", centsPerBatch: 200, batchSize: 1000 });
    expect(card.target).toEqual({ unit: "view", count: 10000 });
    expect(card.proofStrength).toBe("medium");
    expect(card.proofTip).toBeNull();
    expect(card.checker.mustShow[0].id).toBe("names_brand");
    expect(card.endsAt).toBe("2026-11-24T12:00:00.000Z");
  });

  it("says honestly when no machine can measure the result", () => {
    const card = buildCard(EXAMPLE_TRANSLATION, NOW);
    expect(card.checker.machineCheckable).toBe(false);
    expect(card.checker.evidence).toContain("ai_opinion");
    expect(card.howChecked.join(" ")).toContain(`You have ${settings.objectionWindowDays} days to object`);
    expect(card.payLine).toBe("$18.00 once");
  });

  it("never lets a job run longer than the settings allow", () => {
    const card = buildCard(EXAMPLE_TRANSLATION, NOW);
    expect(new Date(card.endsAt).getTime()).toBe(NOW.getTime() + settings.maxJobDays * 86_400_000);
  });

  it("rates views alone as weak proof and a PayPal sale as strong", () => {
    expect(buildCard({ ...EXAMPLE_VIEWS, evidence: ["public_page"], mustShow: [] }, NOW).proofStrength).toBe("weak");
    expect(buildCard({ ...EXAMPLE_VIEWS, evidence: ["paypal_sale"], handIn: "none", unit: "sale", unitLabel: "sale", centsPerBatch: 500, batchSize: 1 }, NOW)).toMatchObject({
      proofStrength: "strong",
      payLine: "$5.00 for every sale",
    });
  });

  it("refuses a card that could never pay", () => {
    expect(() => buildCard({ ...EXAMPLE_VIEWS, capCents: 0 }, NOW)).toThrow("Please say the most you will pay");
    expect(() => buildCard({ ...EXAMPLE_VIEWS, targetUrl: "" }, NOW)).toThrow("please add the link to your page");
    expect(() => buildCard({ ...EXAMPLE_VIEWS, centsPerBatch: 0 }, NOW)).toThrow("Please say how much you pay");
    expect(() => buildCard({ ...EXAMPLE_VIEWS, payKind: "per_rule" }, NOW)).toThrow("what each person should do");
  });

  it("keeps a one-off amount inside the budget", () => {
    expect(buildCard({ ...EXAMPLE_TRANSLATION, onceCents: 9900 }, NOW).payRule).toEqual({ kind: "once", cents: 1800 });
  });
});

describe("writeJobCard", () => {
  beforeAll(async () => seed(await getDb()));
  afterAll(closeDb);
  afterEach(() => useAi(null));

  it("asks AI with the sentence and the poster's name, and returns a card createJob accepts", async () => {
    let asked = "";
    useAi({
      text: async (request) => {
        asked = request.prompt;
        return EXAMPLE_VIEWS as never;
      },
      watch: async () => {
        throw new Error("not used");
      },
    });
    const card = await writeJobCard({ sentence: "I want 10,000 real views. Up to $50.", posterName: "Kettle & Clove" });
    expect(asked).toContain("Kettle & Clove");
    expect(asked).toContain("I want 10,000 real views. Up to $50.");
    const job = await createJob({ posterId: "per_kettle", sentence: "I want 10,000 real views. Up to $50.", card });
    expect(job.status).toBe("draft");
    expect(job.budgetCents).toBe(5000);

    useAi({ text: async () => EXAMPLE_TRANSLATION as never, watch: async () => ({}) as never });
    const opinionCard = await writeJobCard({ sentence: "Translate our menu into Hindi. $18.", posterName: "Kettle & Clove" });
    expect((await createJob({ posterId: "per_kettle", sentence: "Translate our menu into Hindi. $18.", card: opinionCard })).status).toBe("draft");
  });

  it("tells the poster in plain words when the AI is out of allowance, busy or missing, in a form the screen shows", async () => {
    // (Named swapAi here because the style checker takes any "use..." call inside a helper for a React hook.)
    const swapAi = useAi;
    const failing = (error: Error) => swapAi({ text: async () => Promise.reject(error), watch: async () => ({}) as never });

    failing(new AiTrouble("The AI has used up its allowance for now (3 models tried). Please try again later."));
    const limit = await writeJobCard({ sentence: "Get my video views. Up to $50.", posterName: "Kettle & Clove" }).then(
      () => null,
      (error: Error) => error,
    );
    expect(limit?.message).toBe("The AI has used up its allowance for now (3 models tried). Please try again later. Nothing was saved and no money was locked.");
    expect(limit?.constructor).toBe(Error); // the screens only show errors of the plain kind as they are
    expect(limit!.message.length).toBeLessThanOrEqual(240);

    failing(new AiKeyMissing("text", ["ANTHROPIC_API_KEY", "GOOGLE_AI_API_KEY"]));
    const missing = await writeJobCard({ sentence: "Get my video views. Up to $50.", posterName: "Kettle & Clove" }).then(
      () => null,
      (error: Error) => error,
    );
    expect(missing?.message).toBe("The AI that writes job cards is not available right now. Nothing was saved and no money was locked. Please try again later.");
    expect(missing?.message).not.toMatch(/KEY|env/);
    expect(missing?.constructor).toBe(Error);
  });

  it("refuses an empty sentence without asking AI", async () => {
    await expect(writeJobCard({ sentence: "  ", posterName: "x" })).rejects.toThrow("Please type the result you want");
  });
});
