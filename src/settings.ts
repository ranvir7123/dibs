/**
 * The starting numbers for Dibs, kept in one place so they can be changed
 * without hunting through the code. These are starting values, not fixed
 * decisions: change a number here and every lane picks it up.
 *
 * Money is always whole cents (500 means $5.00).
 */
export const settings = {
  /** The money Dibs works in. PayPal test mode uses US dollars. */
  currency: "USD",

  // ---- pay ----

  /** How long to wait between payouts on one job, in minutes. Pay is sent in batches, not on every view. */
  payBatchMinutes: 60,
  /** The smallest amount worth sending in one payout, in cents. Smaller earnings wait for the next batch. */
  minPayoutCents: 100,
  /** The share of each payout Dibs keeps, in percent. Shown on the job card. */
  feePercent: 10,
  /** 1 means the fee is really taken from payouts; 0 means it is only shown. Off in the first build. */
  feeTakenFromPayouts: 0,

  // ---- time limits ----

  /** How often the numbers for a result are read again from their source, in minutes. */
  checkEveryMinutes: 10,
  /** How long a poster has to object when AI gave an opinion instead of a measurement, in days. Silence means the AI's answer stands. */
  objectionWindowDays: 3,
  /** The longest a job may run, in days (3 weeks). */
  maxJobDays: 21,
  /** How long PayPal promises the held money is there, in days. */
  holdPromisedDays: 3,
  /** How long a PayPal hold lasts at most, in days. */
  holdMaxDays: 29,

  // ---- cheat tests: each one is a named test with its own thresholds ----

  cheatTests: {
    /** One visitor clicking a tracked link many times. */
    repeatVisitor: {
      /** How many clicks from the same visitor count. The rest are left out. */
      countedClicksPerVisitor: 1,
    },
    /** A sudden rush of clicks on a tracked link. */
    clickBurst: {
      /** The length of the window that is watched, in seconds. */
      windowSeconds: 60,
      /** More clicks than this inside one window is called a burst. */
      maxClicksInWindow: 30,
    },
    /** A sudden jump in views between two readings. */
    viewJump: {
      /** Views must be at least this high before the test says anything. */
      minViewsBeforeTesting: 200,
      /** Growing by more than this many times between two readings is called a jump. */
      maxGrowthBetweenReadings: 5,
    },
    /** Views that come with no likes: a sign the views were bought. */
    viewsWithoutLikes: {
      /** Views must be at least this high before the test says anything. */
      minViewsBeforeTesting: 500,
      /** Fewer likes than this for every 100 views fails the test. */
      minLikesPer100Views: 0.5,
    },
    /** Clicks that are far too many for the views the video has. */
    clicksAgainstViews: {
      /** More real clicks than this for every 100 views fails the test. */
      maxClicksPer100Views: 50,
    },
  },
} as const;

export type Settings = typeof settings;
