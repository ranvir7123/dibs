import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "../src/db/client";
import { cast, typedOnCamera } from "./demo-cast";
import { castEmails, readDemoState, resetForFilming } from "./demo-lib";

const realEmails = {
  PAYPAL_TEST_BUYER_EMAIL: "buyer@test.example.com",
  PAYPAL_TEST_WORKER_EMAIL: "worker1@test.example.com",
  PAYPAL_TEST_WORKER2_EMAIL: "worker2@test.example.com",
};

describe("the filming reset", () => {
  afterAll(closeDb);

  it("loads the sample board and the people in the video", async () => {
    const state = await resetForFilming({ env: realEmails });
    expect(state.jobs).toHaveLength(6);
    expect(state.jobs[0]).toMatchObject({ title: "Get our launch video 10,000 views", poster: "Kettle & Clove", locked: "$50.00", paid: "$12.40", held: "$37.60" });
    expect(state.peopleCount).toBe(13 + cast.length);
    expect(state.cast.map((member) => member.role)).toEqual(cast.map((member) => member.role));
    expect(state.cast.find((member) => member.role === "brand")).toMatchObject({ name: cast[0].name, payable: true });
    // Nobody in the cast has done anything yet: the video starts from zero.
    expect(state.cast.every((member) => member.claims === 0 && member.jobsPosted === 0)).toBe(true);
  });

  it("gives the same state when run again, with nothing doubled", async () => {
    const first = await resetForFilming({ env: realEmails });
    const again = await resetForFilming({ env: realEmails });
    expect(again.peopleCount).toBe(first.peopleCount);
    expect(again.jobs).toEqual(first.jobs);
    expect(again.cast.map((member) => member.name)).toEqual(first.cast.map((member) => member.name));
    expect(await readDemoState({ env: realEmails })).toEqual(again);
  });

  it("stops and names the PayPal test emails that are missing", async () => {
    await expect(resetForFilming({ env: { PAYPAL_TEST_BUYER_EMAIL: "buyer@test.example.com" } })).rejects.toThrow(
      /PAYPAL_TEST_WORKER_EMAIL.*PAYPAL_TEST_WORKER2_EMAIL/,
    );
  });

  it("stops when two people in the video would share one email", () => {
    expect(() => castEmails({ env: { ...realEmails, PAYPAL_TEST_WORKER2_EMAIL: "WORKER1@test.example.com" } })).toThrow(/same email/);
  });

  it("the sentences for click and sales jobs say which page visitors land on", () => {
    const typed = typedOnCamera("https://dibs.example.com/");
    expect(typed.promotion).toContain("https://dibs.example.com/shop");
    expect(typed.sales).toContain("https://dibs.example.com/shop");
    expect(typed.threeKinds).toEqual([typed.promotion, expect.stringContaining("bugs"), typed.sales]);
    expect(typedOnCamera(undefined).sales).toContain("https://YOUR-SITE-ADDRESS/shop");
  });

  it("a practice run needs no PayPal emails and marks everyone as not payable", async () => {
    const state = await resetForFilming({ env: {}, practice: true });
    expect(state.peopleCount).toBe(13 + cast.length);
    expect(state.cast.every((member) => !member.payable)).toBe(true);
  });
});
