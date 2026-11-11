/**
 * Turns a result's readings into the shapes the chart draws.
 * The drawing's chart is 400 wide and 132 tall: the plot runs from x 0 to 360
 * and y 12 (top) to 120 (zero), and the side labels sit to its right.
 */
import { compact, dayMonth, hourOfDay, timeOfDay } from "./format";

export interface ChartPoint {
  at: Date;
  value: number;
}

export interface ChartModel {
  /** The line, as an SVG path. */
  line: string;
  /** The same line closed down to the floor, for the soft fill under it. */
  area: string;
  /** Side labels from top to bottom, four of them. */
  ticks: string[];
  /** Labels under the chart from left to right, four of them. */
  times: string[];
}

const LEFT = 0;
const RIGHT = 360;
const TOP = 12;
const FLOOR = 120;

/** The smallest round number at or above the value that splits cleanly into three steps. */
export function roundTop(max: number): number {
  if (max <= 3) return 3;
  const steps = [3, 6, 9, 12, 15, 30];
  const scale = 10 ** Math.floor(Math.log10(max / 3));
  for (const step of steps) {
    // Rounded so that 3 * 0.1 style sums cannot leave a tail like 0.30000000000000004.
    const top = Math.round(step * scale * 1000) / 1000;
    if (top >= max) return top;
  }
  return 30 * scale;
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Null when there are fewer than two readings: one dot is not a chart. */
export function chartModel(points: ChartPoint[], now: Date = new Date()): ChartModel | null {
  if (points.length < 2) return null;

  const first = points[0].at.getTime();
  const last = points[points.length - 1].at.getTime();
  const span = last - first;
  const top = roundTop(Math.max(...points.map((p) => p.value)));

  const xy = points.map((p, i) => {
    // When every reading has the same time, spread them evenly instead of dividing by zero.
    const along = span > 0 ? (p.at.getTime() - first) / span : i / (points.length - 1);
    return {
      x: round(LEFT + along * (RIGHT - LEFT)),
      y: round(FLOOR - (Math.max(0, p.value) / top) * (FLOOR - TOP)),
    };
  });

  // A soft curve that leaves and arrives level, so it never dips below a reading or rises above one.
  let line = `M${xy[0].x} ${xy[0].y}`;
  for (let i = 1; i < xy.length; i++) {
    const mid = round((xy[i - 1].x + xy[i].x) / 2);
    line += ` C${mid} ${xy[i - 1].y} ${mid} ${xy[i].y} ${xy[i].x} ${xy[i].y}`;
  }
  const area = `${line} L${RIGHT} ${FLOOR} L${LEFT} ${FLOOR} Z`;

  const ticks = [top, (top * 2) / 3, top / 3, 0].map(compact);

  // Readings a few minutes apart (the usual case on a job's first day) need the minutes, or every label says the same hour.
  const label = span < 3 * 3_600_000 ? timeOfDay : span < 36 * 3_600_000 ? hourOfDay : dayMonth;
  const lastIsFresh = now.getTime() - last < 3_600_000;
  const times = [0, 1 / 3, 2 / 3, 1].map((part) => {
    if (part === 1 && lastIsFresh) return "Now";
    return label(new Date(first + span * part));
  });

  return { line, area, ticks, times };
}
