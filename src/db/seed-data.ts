/**
 * The sample data: the same jobs, people and results as the approved drawing
 * (round8/screens/index.html), so the screens have something to draw.
 *
 * Everything here is pretend. Emails end in example.com, and PayPal references
 * start with SAMPLE, except the two that are printed on the drawing.
 * Times are worked out from the moment of loading, so "9D left" stays true.
 */
import type { CheckGroup, JobCard, JobRule } from "../contract/types";
import type * as schema from "./schema";

type Insert<T extends { $inferInsert: unknown }> = T["$inferInsert"];

export interface SeedRows {
  people: Insert<typeof schema.people>[];
  jobs: Insert<typeof schema.jobs>[];
  claims: Insert<typeof schema.claims>[];
  results: Insert<typeof schema.results>[];
  checks: Insert<typeof schema.checks>[];
  readings: Insert<typeof schema.readings>[];
  moneyMoves: Insert<typeof schema.moneyMoves>[];
  trackedLinks: Insert<typeof schema.trackedLinks>[];
  clicks: Insert<typeof schema.clicks>[];
  sales: Insert<typeof schema.sales>[];
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function buildSeed(now: Date = new Date()): SeedRows {
  const t = now.getTime();
  const hoursAgo = (h: number) => new Date(t - h * HOUR);
  /** N whole days left on the clock, with half a day to spare so it still reads N tomorrow morning. */
  const endsIn = (days: number) => new Date(t + days * DAY + 12 * HOUR);
  const clock = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).format(d);

  const rows: SeedRows = {
    people: [],
    jobs: [],
    claims: [],
    results: [],
    checks: [],
    readings: [],
    moneyMoves: [],
    trackedLinks: [],
    clicks: [],
    sales: [],
  };
  let n = 0;
  const next = (prefix: string) => `${prefix}_seed${String(++n).padStart(4, "0")}`;

  // ------------------------------------------------------------ people

  const person = (id: string, name: string, mailbox: string) => {
    rows.people.push({ id, name, paypalEmail: `${mailbox}@example.com`, createdAt: hoursAgo(24 * 7) });
    return id;
  };
  const kettle = person("per_kettle", "Kettle & Clove", "kettle.clove");
  const loom = person("per_loom", "Loom & Thread", "loom.thread");
  const tinycomet = person("per_tinycomet", "Tiny Comet Games", "tiny.comet");
  const northside = person("per_northside", "Northside Bakes", "northside.bakes");
  const aarav = person("per_aarav", "aarav.clips", "aarav.clips");
  const meera = person("per_meera", "meera.reels", "meera.reels");
  const zoya = person("per_zoya", "zoya.plays", "zoya.plays");
  // The drawing shows only three workers by name. These are invented so every
  // job's paid total on the board has someone behind it.
  const kabir = person("per_kabir", "kabir.cuts", "kabir.cuts");
  const isha = person("per_isha", "isha.edits", "isha.edits");
  const dev = person("per_dev", "dev.finds", "dev.finds");
  const tara = person("per_tara", "tara.styles", "tara.styles");
  const rohan = person("per_rohan", "rohan.tests", "rohan.tests");
  const ishaan = person("per_ishaan", "ishaan.breaks", "ishaan.breaks");

  // ------------------------------------------------------------ helpers

  let jobOrder = 0;
  const job = (id: string, posterId: string, sentence: string, daysLeft: number, card: Omit<JobCard, "endsAt">) => {
    const endsAt = endsIn(daysLeft);
    const full: JobCard = { ...card, endsAt: endsAt.toISOString() };
    // The first job listed is the newest, so the board shows them in the drawing's order.
    const createdAt = new Date(t - 2 * DAY - jobOrder++ * HOUR);
    const tag = id.replace("job_", "").toUpperCase().replaceAll("_", "-");
    rows.jobs.push({
      id,
      posterId,
      sentence,
      title: card.title,
      category: card.category,
      card: full,
      budgetCents: card.capCents,
      status: "open",
      endsAt,
      paypalOrderId: `SAMPLE-ORDER-${tag}`,
      paypalAuthorizationId: `SAMPLE-HOLD-${tag}`,
      createdAt,
    });
    rows.moneyMoves.push({
      id: next("mov"),
      jobId: id,
      personId: posterId,
      kind: "hold",
      amountCents: card.capCents,
      status: "done",
      paypalRef: `SAMPLE-HOLD-${tag}`,
      note: `Held for: ${card.title}`,
      createdAt,
    });
    return id;
  };

  const claim = (jobId: string, workerId: string, hours: number, status: "open" | "handed_in" = "handed_in") => {
    const id = `clm_${jobId.replace("job_", "")}_${workerId.replace("per_", "")}`;
    rows.claims.push({ id, jobId, workerId, status, createdAt: hoursAgo(hours) });
    return id;
  };

  const link = (code: string, claimId: string, jobId: string, targetUrl: string) => {
    rows.trackedLinks.push({ code, claimId, jobId, targetUrl, createdAt: hoursAgo(30) });
    return code;
  };

  const result = (values: Insert<typeof schema.results>) => {
    rows.results.push(values);
    return values.id;
  };

  let position = 0;
  const check = (
    resultId: string,
    key: string,
    group: CheckGroup,
    label: string,
    passedCount: number,
    totalCount: number,
    reason: string,
    extra: { headline?: string; seenAtSeconds?: number | null } = {},
  ) => {
    rows.checks.push({
      id: next("chk"),
      resultId,
      key,
      group,
      label,
      passed: passedCount === totalCount,
      passedCount,
      totalCount,
      reason,
      headline: extra.headline ?? null,
      seenAtSeconds: extra.seenAtSeconds ?? null,
      position: position++,
      ranAt: hoursAgo(0.05),
    });
  };

  /** A take from the hold and the payout to the worker, as lane A will record them. */
  const pay = (jobId: string, resultId: string, workerId: string, cents: number, hours: number, note: string, payoutRef?: string) => {
    const takeId = next("mov");
    rows.moneyMoves.push({
      id: takeId,
      jobId,
      resultId,
      personId: workerId,
      kind: "take",
      amountCents: cents,
      status: "done",
      paypalRef: `SAMPLE-TAKE-${takeId.slice(-4)}`,
      note,
      createdAt: hoursAgo(hours),
    });
    const payoutId = next("mov");
    rows.moneyMoves.push({
      id: payoutId,
      jobId,
      resultId,
      personId: workerId,
      kind: "payout",
      amountCents: cents,
      status: "done",
      paypalRef: payoutRef ?? `SAMPLE-PAYOUT-${payoutId.slice(-4)}`,
      note,
      createdAt: new Date(hoursAgo(hours).getTime() + 17_000),
    });
  };

  /** Clicks from different visitors spread over some hours, plus a few repeats that are left out. */
  const honestClicks = (code: string, real: number, repeats: number, overHours: number) => {
    for (let i = 0; i < real; i++) {
      rows.clicks.push({
        id: next("clk"),
        linkCode: code,
        at: new Date(t - overHours * HOUR + ((i + 1) * overHours * HOUR) / (real + 1)),
        visitorKey: `visitor-${code}-${i}`,
        counted: true,
      });
    }
    for (let i = 0; i < repeats; i++) {
      rows.clicks.push({
        id: next("clk"),
        linkCode: code,
        at: new Date(t - overHours * HOUR + ((i + 1) * overHours * HOUR) / (real + 1) + 20_000),
        visitorKey: `visitor-${code}-${i}`,
        counted: false,
        leftOutReason: "The same visitor clicked again.",
      });
    }
  };

  // ------------------------------------------------------------ job 1: views

  const inVideoRules: JobRule[] = [
    { id: "names_brand", label: "Names Kettle & Clove", detail: "The brand's name is said or shown in the video." },
    { id: "shows_link", label: "Shows your link", detail: "The worker's tracked link is on screen or in the description." },
    { id: "says_paid", label: "Says it is a paid promotion", detail: "The video says or shows that it is paid for." },
  ];
  const launchPage = "https://kettleandclove.example.com/launch";

  const views = job(
    "job_kettle_views",
    kettle,
    "I want 10,000 real views on our launch video in two weeks. I'll pay up to $50.",
    9,
    {
      title: "Get our launch video 10,000 views",
      category: "promotion",
      finishLine: "10,000 views on your launch video",
      target: { unit: "view", count: 10000 },
      howChecked: [
        "Views are read from the video site's own count every 10 minutes.",
        "Before any pay, AI watches each posted video. It must name Kettle & Clove, show your link, and say it is a paid promotion.",
      ],
      checkedByLine: "The video site's own view count",
      cheatTestsLine: "Sudden jumps in views. Views with no likes or clicks. One visitor clicking many times.",
      payRule: { kind: "per_unit", unit: "view", unitLabel: "views", centsPerBatch: 200, batchSize: 1000 },
      payLine: "$2.00 for every 1,000 views",
      payNote: "Up to $50.00 in total",
      capCents: 5000,
      proofStrength: "medium",
      proofNote: "Views can be bought.",
      proofTip: "Paying for clicks on your link as well would make this stronger.",
      targetUrl: launchPage,
      checker: {
        evidence: ["public_page", "ai_watch", "tracked_link"],
        handIn: "link",
        mustShow: inVideoRules,
        cheatTests: ["view_jump", "views_without_likes", "repeat_visitor", "click_burst"],
        machineCheckable: true,
      },
    },
  );

  // aarav.clips: passed everything, paid $12.40 in two batches ($4.00, then $8.40).
  {
    const c = claim(views, aarav, 12);
    const code = link("aaravk7m", c, views, launchPage);
    const r = result({
      id: "res_kettle_views_aarav",
      claimId: c,
      jobId: views,
      workerId: aarav,
      handInKind: "link",
      handInUrl: "https://video.example.com/watch/aarav-kettle-launch",
      handedInAt: hoursAgo(11),
      status: "paid",
      measured: { views: 6200, likes: 412, comments: 38, clicksTotal: 184, clicksReal: 181, visitors: 181, mediaSeconds: 21 },
      earnedCents: 1240,
      summary: "Everything passed, so this was paid without anyone approving it.",
      watchLabel: "Live cheat check",
      watchNote: "In the normal range",
      watchOk: true,
      lastCheckedAt: hoursAgo(2 / 60),
      nextCheckAt: new Date(t + 8 * 60_000),
    });
    check(r, "in_video", "must_show", "In the video", 3, 3, "The video names Kettle & Clove, shows the link and says it is a paid promotion.");
    check(r, "views_real", "cheat", "Views look real", 1, 1, "Views grew steadily and came with likes: 6.6 for every 100 views.");
    check(r, "clicks_real", "cheat", "Clicks look real", 1, 1, "181 of 184 clicks came from different visitors. 3 repeat clicks were left out.");
    const viewsOverTime = [0, 700, 1500, 2400, 3300, 4100, 4700, 5200, 5600, 5900, 6100, 6200];
    viewsOverTime.forEach((v, i) => {
      const share = v / 6200;
      rows.readings.push({
        id: next("rdg"),
        resultId: r,
        at: hoursAgo(viewsOverTime.length - 1 - i),
        views: v,
        likes: Math.round(412 * share),
        comments: Math.round(38 * share),
        clicksTotal: Math.round(184 * share),
        clicksReal: Math.round(181 * share),
      });
    });
    honestClicks(code, 181, 3, 11);
    pay(views, r, aarav, 400, 7, "Dibs: 2,000 views on Get our launch video 10,000 views");
    pay(views, r, aarav, 840, 1, "Dibs: 4,200 more views on Get our launch video 10,000 views", "4GH81652WS903271B");
  }

  // meera.reels: 5,000 clicks from one visitor in 40 seconds. Counted as 1. Blocked, $0.00.
  {
    const burstAt = hoursAgo(2);
    const c = claim(views, meera, 10);
    const code = link("meerax4p", c, views, launchPage);
    const r = result({
      id: "res_kettle_views_meera",
      claimId: c,
      jobId: views,
      workerId: meera,
      handInKind: "link",
      handInUrl: "https://video.example.com/watch/meera-kettle-launch",
      handedInAt: hoursAgo(9),
      status: "blocked",
      measured: { views: 140, likes: 3, comments: 0, clicksTotal: 5000, clicksReal: 1, visitors: 1, mediaSeconds: 34 },
      earnedCents: 0,
      summary: "Blocked. $0.00 paid. The held money was not touched.",
      watchLabel: "Live cheat check",
      watchNote: `Fake clicks found at ${clock(burstAt)} and left out of the count`,
      watchOk: false,
      lastCheckedAt: hoursAgo(2 / 60),
      nextCheckAt: null,
    });
    check(r, "in_video", "must_show", "In the video", 3, 3, "The video names Kettle & Clove, shows the link and says it is a paid promotion.");
    check(r, "views_real", "cheat", "Views look real", 1, 1, "140 views with 3 likes. Too few views to judge, so nothing is held against them.");
    check(
      r,
      "clicks_real",
      "cheat",
      "Clicks look real",
      0,
      1,
      "All 5,000 clicks arrived in 40 seconds from the same visitor. They were counted as 1 click.",
      { headline: "One visitor, 5,000 clicks" },
    );
    for (let i = 0; i < 5000; i++) {
      rows.clicks.push({
        id: next("clk"),
        linkCode: code,
        at: new Date(burstAt.getTime() + i * 8), // 5,000 clicks, 8 thousandths of a second apart = 40 seconds
        visitorKey: `visitor-${code}-0`,
        counted: i === 0,
        leftOutReason: i === 0 ? null : "The same visitor clicked again.",
      });
    }
    const clicksOverTime = [0, 0, 0, 0, 0, 0, 0, 0, 5000, 5000, 5000];
    clicksOverTime.forEach((total, i) => {
      rows.readings.push({
        id: next("rdg"),
        resultId: r,
        at: hoursAgo(clicksOverTime.length - 1 - i),
        views: Math.round((140 * i) / (clicksOverTime.length - 1)),
        likes: i > 5 ? 3 : 1,
        comments: 0,
        clicksTotal: total,
        clicksReal: total > 0 ? 1 : 0,
      });
    });
  }

  // kabir.cuts and isha.edits: just handed in, still being checked.
  {
    const c = claim(views, kabir, 3);
    link("kabirn2w", c, views, launchPage);
    const r = result({
      id: "res_kettle_views_kabir",
      claimId: c,
      jobId: views,
      workerId: kabir,
      handInKind: "link",
      handInUrl: "https://video.example.com/watch/kabir-kettle-launch",
      handedInAt: hoursAgo(0.5),
      status: "checking",
      measured: { mediaSeconds: 27 },
      earnedCents: 0,
      summary: "The video passed. Views are being counted.",
      lastCheckedAt: hoursAgo(0.2),
      nextCheckAt: new Date(t + 5 * 60_000),
    });
    check(r, "in_video", "must_show", "In the video", 3, 3, "The video names Kettle & Clove, shows the link and says it is a paid promotion.");
  }
  {
    const c = claim(views, isha, 2);
    link("ishaq8rd", c, views, launchPage);
    result({
      id: "res_kettle_views_isha",
      claimId: c,
      jobId: views,
      workerId: isha,
      handInKind: "link",
      handInUrl: "https://video.example.com/watch/isha-kettle-launch",
      handedInAt: hoursAgo(0.1),
      status: "checking",
      measured: {},
      earnedCents: 0,
      summary: "AI is watching the video.",
      lastCheckedAt: null,
      nextCheckAt: now,
    });
  }

  // ------------------------------------------------------------ job 2: sales

  const shopPage = "https://loomandthread.example.com/shop";
  const salesJob = job("job_loom_sales", loom, "Bring me paying customers this month. $5 for every sale, up to $200.", 16, {
    title: "Bring us paying customers",
    category: "sales",
    finishLine: "Sales in the Loom & Thread shop that came through your link",
    target: null,
    howChecked: [
      "Each worker gets their own link to the shop. A sale counts when PayPal shows a paid order that carries the worker's code.",
    ],
    checkedByLine: "PayPal: the sale itself",
    cheatTestsLine: "The same buyer buying again and again. Orders that are refunded.",
    payRule: { kind: "per_unit", unit: "sale", unitLabel: "sale", centsPerBatch: 500, batchSize: 1 },
    payLine: "$5.00 for every sale",
    payNote: "Up to $200.00 in total",
    capCents: 20000,
    proofStrength: "strong",
    proofNote: "PayPal itself saw the money arrive.",
    proofTip: null,
    targetUrl: shopPage,
    checker: {
      evidence: ["paypal_sale", "tracked_link"],
      handIn: "none",
      mustShow: [],
      cheatTests: ["repeat_visitor", "click_burst"],
      machineCheckable: true,
    },
  });

  const seller = (workerId: string, name: string, code: string, soldCount: number, realClicks: number, repeats: number) => {
    const c = claim(salesJob, workerId, 40);
    link(code, c, salesJob, shopPage);
    const r = result({
      id: `res_loom_sales_${name}`,
      claimId: c,
      jobId: salesJob,
      workerId,
      handInKind: "none",
      handedInAt: hoursAgo(40),
      status: "paid",
      measured: { sales: soldCount, clicksTotal: realClicks + repeats, clicksReal: realClicks, visitors: realClicks },
      earnedCents: soldCount * 500,
      summary: `${soldCount} sales came through this link, so $${soldCount * 5}.00 was paid without anyone approving it.`,
      watchLabel: "Live cheat check",
      watchNote: "In the normal range",
      watchOk: true,
      lastCheckedAt: hoursAgo(0.1),
      nextCheckAt: new Date(t + 6 * 60_000),
    });
    check(r, "sales_real", "cheat", "Sales look real", 1, 1, `${soldCount} paid PayPal orders from ${soldCount} different buyers carry this worker's code.`);
    check(r, "clicks_real", "cheat", "Clicks look real", 1, 1, `${realClicks} of ${realClicks + repeats} clicks came from different visitors.`);
    honestClicks(code, realClicks, repeats, 38);
    for (let i = 0; i < soldCount; i++) {
      rows.sales.push({
        id: next("sal"),
        jobId: salesJob,
        claimId: c,
        linkCode: code,
        paypalOrderId: `SAMPLE-SALE-${code.toUpperCase()}-${i + 1}`,
        amountCents: 3200,
        at: hoursAgo(36 - i * 5),
      });
    }
    pay(salesJob, r, workerId, soldCount * 500, 3, `Dibs: ${soldCount} sales for Loom & Thread`);
  };
  seller(dev, "dev", "devfnd3k", 4, 58, 3);
  seller(tara, "tara", "tarast9v", 3, 41, 2);

  // ------------------------------------------------------------ job 3: testing a game

  const testRules: JobRule[] = [
    { id: "tutorial", label: "Finished the tutorial", detail: 'The "Tutorial complete" banner appears.' },
    { id: "level_2", label: "Reached level 2", detail: "The level counter changes from 1 to 2." },
    { id: "shop", label: "Opened the shop and bought an item", detail: "Coins drop after buying an item in the shop." },
    { id: "level_3", label: "Reached level 3", detail: "The level counter changes from 2 to 3." },
    { id: "pause_menu", label: "Tried the pause menu", detail: "The pause menu opens during play." },
  ];
  const testJob = job(
    "job_tinycomet_test",
    tinycomet,
    "I need people to test levels 1 to 3 of my game and record their screen. $3 for each thing they try, up to $60.",
    5,
    {
      title: "Test levels 1 to 3 and record your screen",
      category: "testing",
      finishLine: "A screen recording of you playing levels 1 to 3 of Tiny Comet",
      target: null,
      howChecked: [
        "AI watches your whole recording and notes the moment each of the 5 rules is met.",
        "The recording must be one unbroken take and must show Tiny Comet.",
      ],
      checkedByLine: "AI watches your recording",
      cheatTestsLine: "A recording that is cut or stitched together. A recording of a different game.",
      payRule: { kind: "per_rule", centsPerRule: 300, rules: testRules },
      payLine: "$3.00 for each of 5 rules passed",
      payNote: "Up to $60.00 in total",
      capCents: 6000,
      proofStrength: "medium",
      proofNote: "A recording shows what happened, but AI can miss a moment.",
      proofTip: null,
      targetUrl: null,
      checker: {
        evidence: ["ai_watch"],
        handIn: "file",
        mustShow: [],
        cheatTests: ["recording_one_take", "recording_right_subject"],
        machineCheckable: true,
      },
    },
  );

  const tester = (
    workerId: string,
    name: string,
    hours: number,
    mediaSeconds: number,
    seen: Record<string, { at: number | null; reason: string }>,
    payoutRef?: string,
  ) => {
    const c = claim(testJob, workerId, hours + 3);
    const passed = testRules.filter((rule) => seen[rule.id].at !== null).length;
    const r = result({
      id: `res_tinycomet_test_${name}`,
      claimId: c,
      jobId: testJob,
      workerId,
      handInKind: "file",
      handInFile: `sample/${name}-recording.mp4`,
      handedInAt: hoursAgo(hours),
      status: "paid",
      measured: { rulesPassed: passed, rulesTotal: testRules.length, mediaSeconds },
      earnedCents: passed * 300,
      summary: `${passed} of ${testRules.length} rules passed, so $${passed * 3}.00 was paid without anyone approving it.`,
      watchLabel: "Recording check",
      watchNote: "One unbroken take, and the game on screen is Tiny Comet",
      watchOk: true,
      lastCheckedAt: hoursAgo(hours - 0.1),
      nextCheckAt: null,
    });
    for (const rule of testRules) {
      const s = seen[rule.id];
      check(r, `rule:${rule.id}`, "rule", rule.label, s.at === null ? 0 : 1, 1, s.reason, { seenAtSeconds: s.at });
    }
    check(r, "recording", "cheat", "The recording is real", 2, 2, "One unbroken take, and the game on screen is Tiny Comet.");
    pay(testJob, r, workerId, passed * 300, hours - 0.2, `Dibs: ${passed} of ${testRules.length} rules on Test levels 1 to 3`, payoutRef);
  };
  tester(
    zoya,
    "zoya",
    6,
    252,
    {
      tutorial: { at: 48, reason: 'The "Tutorial complete" banner appears.' },
      level_2: { at: 91, reason: "The level counter changes from 1 to 2." },
      shop: { at: 134, reason: "Coins drop from 120 to 70." },
      level_3: { at: 220, reason: "The level counter changes from 2 to 3." },
      pause_menu: { at: null, reason: "The pause menu never appears in the recording." },
    },
    "9TR30418KM227645C",
  );
  tester(rohan, "rohan", 20, 305, {
    tutorial: { at: 55, reason: 'The "Tutorial complete" banner appears.' },
    level_2: { at: 112, reason: "The level counter changes from 1 to 2." },
    shop: { at: null, reason: "The shop is never opened in the recording." },
    level_3: { at: 248, reason: "The level counter changes from 2 to 3." },
    pause_menu: { at: 271, reason: "The pause menu opens and closes." },
  });

  // ------------------------------------------------------------ job 4: streaming

  const streamJob = job(
    "job_tinycomet_stream",
    tinycomet,
    "Get a streamer with 100 viewers to play my game for half an hour. I'll pay $40.",
    12,
    {
      title: "Play our game on stream for 30 minutes",
      category: "promotion",
      finishLine: "30 minutes of Tiny Comet live on stream with 100 or more people watching",
      target: null,
      howChecked: ["The streaming site's own live numbers are read every minute while you are live."],
      checkedByLine: "The streaming site's live numbers",
      cheatTestsLine: "Viewer numbers that jump and fall at once. A stream showing a different game.",
      payRule: { kind: "once", cents: 4000 },
      payLine: "$40.00 once",
      payNote: "With 100 or more people watching",
      capCents: 4000,
      proofStrength: "medium",
      proofNote: "Live viewers can be bought, but it is harder than buying views.",
      proofTip: null,
      targetUrl: null,
      checker: {
        evidence: ["public_page"],
        handIn: "link",
        mustShow: [],
        cheatTests: ["view_jump"],
        machineCheckable: true,
      },
    },
  );
  // zoya.plays has called dibs here but not handed anything in yet.
  claim(streamJob, zoya, 1, "open");

  // ------------------------------------------------------------ job 5: bugs

  const bugsJob = job("job_northside_bugs", northside, "Find bugs on my checkout page and show me each one. $8 a bug, up to $80.", 7, {
    title: "Find real bugs on our checkout page",
    category: "testing",
    finishLine: "Bugs on the Northside Bakes checkout page that can be repeated",
    target: null,
    howChecked: ["You hand in a recording and the steps for each bug. AI repeats your steps on the live site, and a bug counts when it happens again."],
    checkedByLine: "AI repeats your steps on the live site",
    cheatTestsLine: "The same bug handed in twice. Steps that do not lead to the bug.",
    payRule: { kind: "per_unit", unit: "item", unitLabel: "bug we can repeat", centsPerBatch: 800, batchSize: 1 },
    payLine: "$8.00 for each bug we can repeat",
    payNote: "Up to $80.00 in total",
    capCents: 8000,
    proofStrength: "strong",
    proofNote: "A bug that happens again on the live site is hard to fake.",
    proofTip: null,
    targetUrl: null,
    checker: {
      evidence: ["live_site", "ai_watch"],
      handIn: "file",
      mustShow: [],
      cheatTests: ["recording_right_subject"],
      machineCheckable: true,
    },
  });
  {
    const c = claim(bugsJob, ishaan, 30);
    const r = result({
      id: "res_northside_bugs_ishaan",
      claimId: c,
      jobId: bugsJob,
      workerId: ishaan,
      handInKind: "file",
      handInFile: "sample/ishaan-bugs.mp4",
      handedInAt: hoursAgo(26),
      status: "paid",
      measured: { items: 2, mediaSeconds: 198 },
      earnedCents: 1600,
      summary: "2 of 3 bugs could be repeated, so $16.00 was paid without anyone approving it.",
      watchLabel: "Recording check",
      watchNote: "The site on screen is the Northside Bakes checkout",
      watchOk: true,
      lastCheckedAt: hoursAgo(25),
      nextCheckAt: null,
    });
    check(r, "item:1", "rule", "An expired coupon is still accepted", 1, 1, "The code BAKE10 ended in October and still took 10% off.", { seenAtSeconds: 37 });
    check(r, "item:2", "rule", "The basket empties when you go back", 1, 1, "Pressing back from the payment step cleared the basket both times.", { seenAtSeconds: 102 });
    check(r, "item:3", "rule", "The total shows the wrong delivery fee", 0, 1, "The delivery fee was right each time the steps were repeated.", { seenAtSeconds: null });
    pay(bugsJob, r, ishaan, 1600, 25, "Dibs: 2 bugs on Find real bugs on our checkout page");
  }

  // ------------------------------------------------------------ job 6: translation

  job("job_kettle_translate", kettle, "Translate our menu into Hindi. $18.", 3, {
    title: "Translate our menu into Hindi",
    category: "writing",
    finishLine: "The Kettle & Clove menu, fully translated into Hindi",
    target: null,
    howChecked: [
      "AI reads your file against the menu: every item is there, the prices match, and the Hindi reads naturally.",
      "This is AI's opinion, not a measurement. The owner has 3 days to object. Silence means the AI's answer stands.",
    ],
    checkedByLine: "AI reads your file, owner has 3 days to object",
    cheatTestsLine: "A machine translation pasted in unchanged. Missing items.",
    payRule: { kind: "once", cents: 1800 },
    payLine: "$18.00 once",
    payNote: "One person gets this job",
    capCents: 1800,
    proofStrength: "medium",
    proofNote: "No machine can measure a good translation, so AI gives its opinion and the owner can object.",
    proofTip: null,
    targetUrl: null,
    checker: {
      evidence: ["ai_read", "ai_opinion"],
      handIn: "file",
      mustShow: [],
      cheatTests: [],
      machineCheckable: false,
    },
  });

  return rows;
}

