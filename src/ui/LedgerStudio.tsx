"use client";

/**
 * The ledger as an AG Studio dashboard: two charts and the table of money
 * moves, all drawn from the rows the page was given, plus AG Studio's AI
 * assistant ("ask box") wired to our own server route.
 *
 * Loaded in the browser only (see LedgerBoard).
 */
import { AgStudioAiModule, createAiHarness, studioTheme, type AgAiPromptStarter, type AgReportState, type AgStudioApi, type AgStudioMode, type AgStudioProperties } from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { useMemo } from "react";
import type { LedgerRow } from "@/db/ledger";
import { ledgerAdapter } from "./LedgerAdapter";

const HAPPENED: Record<LedgerRow["kind"], string> = { locked: "Locked", paid: "Paid", released: "Released", blocked: "Blocked", refunded: "Refunded" };
const STATUS: Record<LedgerRow["status"], string> = { done: "Done", pending: "On its way", failed: "Failed" };

/** The questions offered before anything is typed. Each one works on the columns below. */
export const ASK_STARTERS: AgAiPromptStarter[] = [
  { label: "Who was paid the most?", prompt: "Which worker was paid the most, and for which job? Answer in one or two sentences using the Paid column." },
  { label: "Paid against released, per job", prompt: "Add a chart that compares Paid with Released back for each job." },
  { label: "What did cheating cost me?", prompt: "How much money did the cheat checks stop from being paid, and for which worker and job? Use the rows where What happened is Blocked." },
];

/**
 * The rows as AG Studio reads them. Money is in dollars. Besides the line's
 * own amount there is one column per kind of money, so a chart can simply add
 * a column up: "held" sits on a job's lock line and is what is still locked now.
 */
function studioRows(rows: LedgerRow[]) {
  return rows.map((row) => {
    const counts = row.status === "done";
    const is = (kind: LedgerRow["kind"]) => (row.kind === kind && counts ? row.amountCents / 100 : 0);
    return {
      id: row.id,
      when: new Date(row.when),
      job: row.job,
      worker: row.worker ?? "",
      happened: HAPPENED[row.kind],
      measured: row.measured ?? "",
      amount: row.amountCents / 100,
      paid: is("paid"),
      released: is("released"),
      held: row.stillLockedCents / 100,
      locked: is("locked"),
      stopped: is("blocked"),
      refunded: is("refunded"),
      units: row.units,
      unit: row.unit ?? "",
      paypalRef: row.paypalRef ?? "",
      takeRef: row.takeRef ?? "",
      status: STATUS[row.status],
      note: row.note,
    };
  });
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const whenFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
const money = (id: string, name: string, description: string) => ({ id, name, description, format: "currencyFormat" as const, formatOptions: { format: usd } });
const text = (id: string, name: string, description: string) => ({ id, name, description, format: "textFormat" as const });

const FIELDS = [
  { id: "id", format: "textFormat" as const, hide: true },
  { id: "when", name: "When", description: "The date and time of this money move (India time).", format: "dateTimeFormat" as const, formatOptions: { format: whenFormat } },
  text("job", "Job", "The job this money belongs to."),
  text("worker", "Worker", "The worker this line is about. Empty for Locked and Released lines."),
  text("happened", "What happened", "One of: Locked (the job's budget was held in PayPal), Paid (money taken from the hold for a result that passed its checks), Released (the rest of the hold went back to the business), Blocked (a result failed a cheat check), Refunded (a shop sale went back to its buyer)."),
  text("measured", "What was measured", "What the checker measured for this line, in words, for example '830 views' or '4 of 5 rules'."),
  money("amount", "Amount", "The size of this line in US dollars. Do not add this column up across different kinds of line: use Paid, Released back, Still locked or Stopped instead."),
  money("paid", "Paid", "Dollars paid to a worker on this line. 0 on lines that are not payments."),
  money("released", "Released back", "Dollars released back to the business on this line. 0 on other lines."),
  money("held", "Still locked", "On a job's Locked line: how much of that job's money is still held in PayPal right now. 0 on other lines, so its total is the money still locked."),
  money("locked", "Locked", "Dollars locked on this line. 0 on lines that are not locks."),
  money("stopped", "Stopped by cheat checks", "Dollars a blocked result was stopped from being paid. 0 on other lines."),
  money("refunded", "Refunded", "Dollars of a shop sale refunded to its buyer. 0 on other lines."),
  { id: "units", name: "Units paid for", description: "On a Paid line of a job that pays per unit: how many units (views, clicks, sales) this payment paid for. Paid divided by this is the cost per unit.", format: "integerFormat" as const },
  text("unit", "Unit", "What the units are, for example 'views'."),
  text("paypalRef", "PayPal reference", "PayPal's own reference for this line: the hold for Locked and Released, the payout to the worker for Paid."),
  text("takeRef", "PayPal hold reference", "On a Paid line: PayPal's reference for taking the money out of the hold."),
  text("status", "Status", "Done, On its way, or Failed."),
  text("note", "Note", "One plain sentence on what this line is."),
];

const field = (id: string) => ({ id: `ledger.${id}` });
const sum = (id: string) => ({ id: `ledger.${id}`, aggregation: "sum" as const });

/** The dashboard a business sees first: where each job's budget went, who was paid, and every line. */
const REPORT: AgReportState = {
  selectedPageId: "ledger",
  pages: [
    {
      id: "ledger",
      widgets: {
        byJob: {
          type: "bar-chart-stacked",
          dataMapping: { categoryKey: [field("job")], valueKey: [sum("paid"), sum("released"), sum("held")] },
          format: { title: { enabled: true, text: "Where each job's budget went" }, style: { theme: { common: { legend: { enabled: true, position: "bottom" } } } } },
        },
        byWorker: {
          type: "bar-chart-grouped",
          dataMapping: { categoryKey: [field("worker")], valueKey: [sum("paid")] },
          format: { title: { enabled: true, text: "Paid to each worker" }, style: { theme: { common: { legend: { enabled: false } } } } },
        },
        lines: {
          type: "grid",
          dataMapping: { cols: ["when", "job", "worker", "happened", "measured", "amount", "paypalRef", "status"].map(field) },
          sort: [{ field: field("when"), direction: "desc" }],
          format: { title: { enabled: true, text: "Every money move" }, style: { columnAutoSize: true } },
        },
      },
      widgetLayout: {
        byJob: { xTrack: 0, yTrack: 0, xSpan: 14, ySpan: 18 },
        byWorker: { xTrack: 14, yTrack: 0, xSpan: 10, ySpan: 18 },
        lines: { xTrack: 0, yTrack: 18, xSpan: 24, ySpan: 24 },
      },
    },
  ],
};

/** Reads the site's colours from its CSS variables, so the dashboard follows the Dibs look (charts need real colour values, not variable names). */
function siteColours() {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    page: read("--page", "#fff3c4"),
    card: read("--card", "#ffffff"),
    line: read("--line", "#ebe3c4"),
    text: read("--text", "#15130a"),
    mute: read("--mute", "#6e6748"),
    paid: read("--paid", "#1f7a4d"),
    stop: read("--stop", "#d6453d"),
    font: getComputedStyle(document.body).fontFamily || "system-ui, sans-serif",
  };
}

function dibsTheme() {
  const c = siteColours();
  return studioTheme.withParams({
    accentColor: c.paid,
    backgroundColor: c.card,
    foregroundColor: c.text,
    textColor: c.text,
    subtleTextColor: c.mute,
    borderColor: c.line,
    invalidColor: c.stop,
    fontFamily: c.font,
    fontSize: 14,
    borderRadius: 12,
    studioWrapperBackgroundColor: "transparent",
    studioWrapperBorder: false,
    studioWrapperSpacing: 0,
    studioCanvasBackgroundColor: "transparent",
    studioCanvasBorder: false,
    studioCanvasFontFamily: c.font,
    studioCanvasPadding: 0,
    studioMinWidth: 0,
    studioMinHeight: 0,
    studioCanvasMinWidth: 0,
    studioPanelContainerBackgroundColor: c.card,
    studioPanelContainerBorder: false,
    studioPanelContainerBorderRadius: 24,
    studioAiPanelWidth: 380,
    studioWidgetBackgroundColor: c.card,
    studioWidgetBorder: false,
    studioWidgetBorderRadius: 24,
    studioWidgetPadding: 8,
    studioWidgetTitleFontFamily: c.font,
    studioWidgetTitleFontSize: 17,
    studioWidgetTitleFontWeight: 600,
    studioWidgetTitleTextColor: c.text,
    studioToggleButtonActiveBackgroundColor: c.paid,
    studioToggleButtonActiveBorderColor: c.paid,
    studioToggleButtonActiveColor: c.paid,
    chartFontFamily: c.font,
    chartTextColor: c.text,
    chartSubtleTextColor: c.mute,
    chartAxisLabelColor: c.mute,
    chartAxisLabelFontFamily: c.font,
    chartAxisLineColor: c.line,
    chartGridLineColor: c.line,
    // Green is money paid. Sand is money that went back. Ink is money still locked.
    chartPaletteFills1Color: c.paid,
    chartPaletteFills2Color: "#d9cd97",
    chartPaletteFills3Color: c.text,
    chartPaletteStrokes1Color: c.paid,
    chartPaletteStrokes2Color: "#d9cd97",
    chartPaletteStrokes3Color: c.text,
    gridRowHeight: 48,
    gridRowBorder: { width: 1, color: c.line },
    gridHeaderRowBorder: { width: 1, color: c.line },
  });
}

/** Under 720 wide the widgets stack in one column, in the order they were laid out. */
const BREAKPOINTS: AgStudioProperties["responsiveLayoutBreakpoints"] = [
  {
    maxWidth: 720,
    layout: (candidates, { columns }) => {
      let yTrack = 0;
      return [...candidates]
        .map((candidate, index) => ({ candidate, index }))
        .sort((a, b) => a.candidate.layout.yTrack - b.candidate.layout.yTrack || a.candidate.layout.xTrack - b.candidate.layout.xTrack)
        .map(({ candidate, index }) => {
          const placed = { index, layout: { xTrack: 0, yTrack, xSpan: columns, ySpan: candidate.layout.ySpan } };
          yTrack += candidate.layout.ySpan;
          return placed;
        })
        .sort((a, b) => a.index - b.index)
        .map((placed) => placed.layout);
    },
  },
];

export interface LedgerStudioProps {
  rows: LedgerRow[];
  /** "view" shows the dashboard. "edit" also opens the ask box and lets charts be changed. */
  mode: AgStudioMode;
  licenseKey?: string;
  /** Told in plain words when the AI fails, and null when it answers again. */
  onAskTrouble?: (message: string | null) => void;
}

export default function LedgerStudio({ rows, mode, licenseKey, onAskTrouble }: LedgerStudioProps) {
  const data = useMemo(() => ({ description: "The money ledger of one business on Dibs, a marketplace that pays workers only for measured results. Each row is one money move on a job the business posted.", sources: [{ id: "ledger", name: "Ledger", description: "One row per money move: a lock, a payment, a release, a blocked result or a refund.", primaryKeyField: "id", data: studioRows(rows), fields: FIELDS }] }), [rows]);
  const theme = useMemo(() => dibsTheme(), []);
  // The harness is read once by AG Studio, so the callback is kept in a stable place.
  const ai = useMemo<AgStudioProperties["ai"]>(() => ({ api }) => createAiHarness(api as AgStudioApi, { adapter: ledgerAdapter(onAskTrouble), promptStarters: ASK_STARTERS }), [onAskTrouble]);

  return (
    <AgStudioProvider modules={[AgStudioAiModule]} licenseKey={licenseKey}>
      <AgStudio
        style={{ width: "100%", height: "100%" }}
        mode={mode}
        data={data}
        theme={theme}
        initialState={REPORT}
        layout={{ pagePadding: 0, widgetPadding: 8, widgetBorderEnabled: false, widgetBorderRadius: 24, backgroundColor: "transparent" }}
        ai={ai}
        panels={{ edit: { right: ["ai"] }, view: {} }}
        responsiveLayoutBreakpoints={BREAKPOINTS}
        onApiReady={(event) => {
          if (process.env.NODE_ENV !== "production") (window as unknown as { __ledgerApi?: unknown }).__ledgerApi = event.api;
        }}
      />
    </AgStudioProvider>
  );
}
