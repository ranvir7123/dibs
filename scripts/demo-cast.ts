/**
 * The people in the video and the words typed on camera.
 *
 * EDIT THIS FILE before filming: put in the real shop name, the real game name
 * and the five things a tester should do. Then run:
 *
 *   npx tsx scripts/demo-reset.ts
 *
 * Emails are never written here. They come from .env.local, by the names
 * below, so they stay off GitHub.
 */

export interface CastMember {
  /** A short name for the part this person plays. Used in the printed list only. */
  role: string;
  /** The name shown on Dibs. */
  name: string;
  /** What they do in the video, in plain words. */
  does: string;
  /** The name in .env.local that holds the email their PayPal test account uses. */
  emailFrom: string;
  /**
   * Used when emailFrom is empty. Only for people PayPal never pays in the
   * video. Leave out for anyone who must be paid: the reset then stops and
   * says the email is missing.
   */
  spareEmail?: string;
}

export const cast: CastMember[] = [
  {
    role: "brand",
    name: "Your friend's shop",
    does: "Posts the promotion job and the sales job. Approves the holds on PayPal's page with the pretend buyer account.",
    emailFrom: "PAYPAL_TEST_BUYER_EMAIL",
  },
  {
    role: "game maker",
    name: "Your game studio",
    does: "Posts the game test job. Is never paid, so a spare email is fine.",
    emailFrom: "DEMO_GAME_MAKER_EMAIL",
    spareEmail: "game.maker@example.com",
  },
  {
    role: "promoter",
    name: "friend.posts",
    does: "Your friend who posts the short video, and later sells through their link. Paid by PayPal.",
    emailFrom: "PAYPAL_TEST_WORKER_EMAIL",
  },
  {
    role: "tester",
    name: "tester.plays",
    does: "Records themselves playing your game. Paid by PayPal.",
    emailFrom: "PAYPAL_TEST_WORKER2_EMAIL",
  },
  {
    role: "cheat",
    name: "cheat.clicks",
    does: "You, running the 5,000-click script. Earns $0.00, so a spare email is fine.",
    emailFrom: "DEMO_CHEAT_EMAIL",
    spareEmail: "cheat.clicks@example.com",
  },
];

/**
 * The sentences typed into "post a job" on camera. Starting values: after the
 * first practice run, change the amounts so the real numbers you get (a
 * friend's video will have tens or hundreds of views, not thousands) move
 * real money on screen.
 *
 * A job that counts clicks or sales must say which page visitors land on, or
 * the job card is refused. Both such jobs send visitors to the small shop page
 * on the site itself, so the address is built from the site's own address
 * (DIBS_BASE_URL).
 */
export function typedOnCamera(siteAddress: string | undefined) {
  const site = siteAddress?.trim().replace(/\/+$/, "") || "https://YOUR-SITE-ADDRESS";
  const shop = `${site}/shop`;
  const promotion = `Get real views on our launch video this week. $1 for every 50 views, up to $50. The link in the video goes to ${shop}`;
  const bugs = "Find bugs on my checkout page and show me each one in a recording. $8 a bug, up to $80.";
  const sales = `Bring me paying customers. $5 for every sale through your link, up to $50. Our shop is at ${shop}`;
  return {
    /** 0:15 to 0:40, typed one after another to show AI writing three different cards. */
    threeKinds: [promotion, bugs, sales],
    /** The three jobs that are locked in PayPal and worked on for real. */
    promotion,
    gameTest:
      "Test my game and record your screen. $3 for each of these 5 things you do, up to $15: finish the tutorial, reach level 2, open the shop and buy an item, reach level 3, try the pause menu.",
    sales,
  };
}
