/**
 * Turns the poster's one sentence into a job card.
 *
 * AI does the understanding: what result is wanted, where the truth can be
 * read, which cheat tests fit, how pay is worked out. Plain code then builds
 * the card from AI's draft, so every amount, date and pay sentence is exact
 * and a card that could never pay is refused before the poster sees it.
 */
import { z } from "zod";
import { getAi } from "@/ai";
import { formatCents, isCents } from "@/contract/money";
import type { EvidenceKind, JobCard, JobRule, PayRule, ProofStrength } from "@/contract/types";
import { settings } from "@/settings";

const DAY_MS = 86_400_000;

const rule = z.object({
  id: z.string().describe("Short stable name in snake_case, for example level_2"),
  label: z.string().describe("What the worker must do, as shown on screen"),
  detail: z.string().describe("What the checker looks for, in one plain sentence"),
});

/** What AI is asked to fill in. Flat and simple on purpose; code builds the card from it. */
export const cardDraft = z.object({
  title: z.string().describe("Short title for the board, written to the workers"),
  category: z.enum(["promotion", "testing", "sales", "writing", "design", "other"]),
  finishLine: z.string().describe("The result wanted, in plain words"),
  targetUnit: z.enum(["view", "click", "sale", "item", "none"]).describe("What is counted towards the finish line; none when it is not a count"),
  targetCount: z.number().describe("The number to reach; 0 when targetUnit is none"),
  evidence: z.array(z.enum(["public_page", "tracked_link", "paypal_sale", "ai_watch", "ai_read", "live_site", "ai_opinion"])),
  handIn: z.enum(["link", "file", "none"]),
  machineCheckable: z.boolean().describe("False when no machine can measure the result and AI can only give an opinion"),
  mustShow: z.array(rule).describe("Things the hand-in must contain before any pay; empty when none"),
  doesNotCount: z.array(z.string()).describe("Things the poster says they already know or that do not count, copied from the sentence, one per entry; empty when none"),
  cheatTests: z.array(
    z.enum(["repeat_visitor", "click_burst", "view_jump", "views_without_likes", "clicks_against_views", "recording_one_take", "recording_right_subject"]),
  ),
  howChecked: z.array(z.string()).describe("How the result is checked, one plain sentence each"),
  checkedByLine: z.string().describe("The same in a few words for the board"),
  cheatTestsLine: z.string().describe("The cheat tests in plain words"),
  payKind: z.enum(["per_unit", "per_rule", "once"]),
  unit: z.enum(["view", "click", "sale", "item", "none"]).describe("For per_unit pay: what is counted"),
  unitLabel: z.string().describe('For per_unit pay: the unit in words, for example "views", "sale", "bug we can repeat"'),
  centsPerBatch: z.number().describe("For per_unit pay: whole cents paid for each batch"),
  batchSize: z.number().describe("For per_unit pay: units in one batch, for example 1000 for every 1,000 views"),
  centsPerRule: z.number().describe("For per_rule pay: whole cents for each rule passed"),
  payRules: z.array(rule).describe("For per_rule pay: the rules; empty otherwise"),
  onceCents: z.number().describe("For once pay: the whole amount in cents"),
  capCents: z.number().describe("The most the job can ever pay, in whole cents; 0 when the sentence gives no amount"),
  daysToRun: z.number().describe("How many days the job runs"),
  proofNote: z.string().describe("One plain sentence on how hard this proof is to fake"),
  proofTip: z.string().describe("How the poster could make the proof stronger; empty when there is nothing to add"),
  targetUrl: z.string().describe("The poster's own page that visitors are sent to, copied from the sentence; empty when the sentence has no link"),
});
export type CardDraft = z.infer<typeof cardDraft>;

function systemPrompt(): string {
  const t = settings.cheatTests;
  return `You write job cards for Dibs, a marketplace where a business posts a result it wants and locks the pay in PayPal. Anyone can take the job. A checker measures what really happened and PayPal pays exactly what was earned. Nobody presses approve.

From the poster's one sentence, decide how the result can be checked. Any kind of job may be posted. A checker reads the truth from one or more of these kinds of evidence:

- public_page: a public page we can read. Today that is a public YouTube video's views, likes and comments. The worker hands in a link.
- tracked_link: a link Dibs owns, one per worker, counting clicks from different real visitors. Needs the poster's page address (targetUrl).
- paypal_sale: a sale seen by PayPal that carries the worker's code. Needs the poster's shop page address (targetUrl). The worker hands in nothing (handIn "none").
- ai_watch: AI watches a public video link, or looks at an uploaded recording or photo, and decides yes-or-no rules, with the moment each was seen.
- ai_read: AI reads an uploaded text file or PDF against yes-or-no rules.
- live_site: Dibs opens a public web page itself and reads its words. No logins. The worker hands in links (handIn link). Use it when the result is something that should now be true on a public page, such as a business being listed on a site with the right name, address, phone and opening hours. These jobs usually pay per_unit with unit "item" and batchSize 1, with a unitLabel that names the thing (for example "site listed correctly"): each handed-in page that matches every fact in the sentence is one item. Use live_site by itself, without public_page or ai_watch. Say in howChecked that Dibs opens each link itself and compares the page with the facts in the sentence, so screenshots are not needed. When the poster names sites they are already on, put each one in doesNotCount.
- ai_opinion: nothing a machine can measure. AI gives its opinion of the work and the poster has ${settings.objectionWindowDays} days to object; silence means AI's answer stands.

Be honest. If the result is a matter of quality or taste (a good translation, a nice logo, a well-written post), no machine can measure it: set machineCheckable to false, include ai_opinion in evidence, and say plainly in howChecked that this is AI's opinion and not a measurement. Never dress an opinion up as a measurement. If part of a job can be measured and part cannot, measure what can be measured and say what cannot.

Cheat tests you may pick, only where they fit the evidence:
- repeat_visitor: one visitor clicking a tracked link many times (only ${t.repeatVisitor.countedClicksPerVisitor} counted per visitor).
- click_burst: more than ${t.clickBurst.maxClicksInWindow} clicks inside ${t.clickBurst.windowSeconds} seconds.
- view_jump: views growing more than ${t.viewJump.maxGrowthBetweenReadings} times between two readings.
- views_without_likes: many views with almost no likes.
- clicks_against_views: far more clicks than the video's views could produce.
- recording_one_take: a recording that is cut or stitched together.
- recording_right_subject: a recording that shows something other than the poster's product.

When the poster lists things they already know (known bugs, known mistakes, their own shops), put each one in doesNotCount, copied from the sentence, one per entry. Then say in howChecked that a find matching that list earns nothing, and that each find is paid once: the first worker to show it is paid, and nobody is paid for the same find again.

A worker hands in once per job: one recording, one photo, one file or one list of links, which may show several finds. Never write that a worker uploads one recording for each find. An uploaded recording or photo is looked at as pictures with no sound, so never ask a worker to say something out loud in it, and never write a rule that depends on sound for an uploaded file.

Pay rules:
- per_unit: so much for every batch of units (for example 200 cents for every 1000 views, or 500 cents for every 1 sale).
- per_rule: so much for each yes-or-no rule passed. Write each rule so that someone watching a recording could say yes or no, and say what would be seen on screen.
- once: one fixed amount when the finish line is met.

Rules for the card:
- All money is whole cents. capCents is the most the poster said they would pay. If the sentence names no amount at all, set capCents to 0.
- Views are only ever counted on a video the WORKER posts and hands in, never on the poster's own video: many workers could hand in the same link and each be paid for the same views. So when a poster wants views or attention, the job is "post your own public video about us and get it views". Say that in the title, the finish line and howChecked. If the sentence gives a link to the poster's own video or page, that link is what workers promote: put it in targetUrl.
- Every job where the worker posts a video must use ai_watch as well as public_page, with mustShow rules: it names the brand (use the poster's name), it says it is a paid promotion, and, when the job has a tracked link, it shows the worker's link. Say in howChecked that AI watches each video before any pay.
- When a views job has a targetUrl, also give each worker a tracked link (tracked_link in evidence, with repeat_visitor and click_burst), and say in proofTip how clicks make the proof stronger.
- Jobs run ${settings.maxJobDays} days at most, because a PayPal hold does not last longer. If the sentence gives no length, choose a sensible one.
- targetUrl: copy the poster's page address from the sentence if there is one. Never invent an address.
- Write for someone who has never met technical words. Short, plain sentences. No jargon.
- Fill every field. Use 0, "none", an empty list or an empty text for fields that do not apply.`;
}

function strengthOf(evidence: EvidenceKind[]): ProofStrength {
  if (evidence.includes("paypal_sale")) return "strong";
  if (evidence.some((e) => e === "tracked_link" || e === "ai_watch" || e === "ai_read" || e === "ai_opinion" || e === "live_site")) return "medium";
  return "weak";
}

function cleanRules(rules: JobRule[]): JobRule[] {
  const seen = new Set<string>();
  return rules
    .map((r, i) => {
      let id = r.id.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `rule_${i + 1}`;
      while (seen.has(id)) id = `${id}_${i + 1}`;
      seen.add(id);
      return { id, label: r.label.trim(), detail: r.detail.trim() };
    })
    .filter((r) => r.label);
}

function isWebLink(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

const whole = (n: number) => Math.round(n);

/**
 * Builds the card the poster reads from AI's draft. Throws a plain sentence
 * when the job cannot be posted as written (no amount, or clicks and sales
 * with no page to send visitors to).
 */
export function buildCard(draft: CardDraft, now: Date = new Date()): JobCard {
  const capCents = whole(draft.capCents);
  if (!isCents(capCents) || capCents <= 0) {
    throw new Error("Please say the most you will pay for this job, for example: up to $50.");
  }

  let evidence = [...new Set(draft.evidence)] as EvidenceKind[];
  const machineCheckable = draft.machineCheckable && !(evidence.length === 1 && evidence[0] === "ai_opinion");
  if (!machineCheckable && !evidence.includes("ai_opinion")) evidence.push("ai_opinion");
  if (evidence.length === 0) evidence = ["ai_opinion"];

  const targetUrl = draft.targetUrl.trim();
  const usesLink = evidence.includes("tracked_link") || evidence.includes("paypal_sale");
  if (usesLink && !isWebLink(targetUrl)) {
    throw new Error("This job counts clicks or sales, so please add the link to your page, starting with https://");
  }

  let payRule: PayRule;
  let payLine: string;
  if (draft.payKind === "per_unit") {
    if (draft.unit === "none") throw new Error("The job card could not say what is being counted. Please say what you pay for, for example: $2 for every 1,000 views.");
    const centsPerBatch = whole(draft.centsPerBatch);
    const batchSize = Math.max(1, whole(draft.batchSize));
    if (centsPerBatch <= 0) throw new Error("Please say how much you pay, for example: $2 for every 1,000 views.");
    const unitLabel = draft.unitLabel.trim() || draft.unit;
    payRule = { kind: "per_unit", unit: draft.unit, unitLabel, centsPerBatch, batchSize };
    payLine = batchSize === 1 ? `${formatCents(centsPerBatch)} for every ${unitLabel}` : `${formatCents(centsPerBatch)} for every ${batchSize.toLocaleString("en-US")} ${unitLabel}`;
  } else if (draft.payKind === "per_rule") {
    const rules = cleanRules(draft.payRules);
    const centsPerRule = whole(draft.centsPerRule);
    if (rules.length === 0 || centsPerRule <= 0) throw new Error("Please say what each person should do and how much each thing pays, for example: $3 for each thing they try.");
    payRule = { kind: "per_rule", centsPerRule, rules };
    payLine = `${formatCents(centsPerRule)} for each of ${rules.length} rules passed`;
  } else {
    const cents = Math.min(whole(draft.onceCents) > 0 ? whole(draft.onceCents) : capCents, capCents);
    payRule = { kind: "once", cents };
    payLine = `${formatCents(cents)} once`;
  }

  const days = Math.min(Math.max(1, whole(draft.daysToRun) || settings.maxJobDays), settings.maxJobDays);
  const endsAt = new Date(now.getTime() + days * DAY_MS);

  const howChecked = draft.howChecked.map((s) => s.trim()).filter(Boolean);
  if (!machineCheckable) {
    const honest = `This is AI's opinion, not a measurement. You have ${settings.objectionWindowDays} days to object. Silence means the AI's answer stands.`;
    if (!howChecked.some((s) => /opinion/i.test(s))) howChecked.push(honest);
  }

  const target = draft.targetUnit !== "none" && whole(draft.targetCount) > 0 ? { unit: draft.targetUnit, count: whole(draft.targetCount) } : null;

  return {
    title: draft.title.trim(),
    category: draft.category,
    finishLine: draft.finishLine.trim(),
    target,
    howChecked,
    checkedByLine: draft.checkedByLine.trim(),
    cheatTestsLine: draft.cheatTestsLine.trim(),
    payRule,
    payLine,
    payNote: `Up to ${formatCents(capCents)} in total`,
    capCents,
    endsAt: endsAt.toISOString(),
    proofStrength: strengthOf(evidence),
    proofNote: draft.proofNote.trim(),
    proofTip: draft.proofTip.trim() || null,
    targetUrl: isWebLink(targetUrl) ? targetUrl : null,
    checker: {
      evidence,
      handIn: draft.handIn,
      mustShow: cleanRules(draft.mustShow),
      cheatTests: [...new Set(draft.cheatTests)],
      machineCheckable,
      doesNotCount: [...new Set((draft.doesNotCount ?? []).map((line) => line.trim()).filter(Boolean))],
    },
  };
}

export async function writeJobCardWithAi(input: { sentence: string; posterName: string }, now: Date = new Date()): Promise<JobCard> {
  const sentence = input.sentence.trim();
  if (!sentence) throw new Error("Please type the result you want, in one sentence.");
  const draft = await getAi().text({
    system: systemPrompt(),
    prompt: `The poster is called: ${input.posterName.trim() || "the poster"}\nToday is ${now.toISOString().slice(0, 10)}.\n\nTheir sentence:\n${sentence}`,
    schema: cardDraft,
  });
  const card = buildCard(draft, now);
  if (!card.title) throw new Error("The job card came back without a title. Please try again.");
  return card;
}
