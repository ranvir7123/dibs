import { chartModel, type ChartPoint } from "./chart";

/**
 * The small chart on a result card, drawn from the result's readings.
 * Blue for a healthy count, red when the line is the cheat itself.
 */
export function Chart({ id, points, bad, label, now, emptyText }: { id: string; points: ChartPoint[]; bad: boolean; label: string; now: Date; emptyText: string }) {
  const model = chartModel(points, now);
  if (!model) {
    return (
      <div className="chart">
        <div className="none">{emptyText}</div>
      </div>
    );
  }
  const colour = bad ? "#f0616d" : "#dcb765";
  const fillId = `fill-${id}`;
  return (
    <div className="chart">
      <div className="plot">
        <svg viewBox="0 0 360 132" preserveAspectRatio="none" role="img" aria-label={label}>
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={colour} stopOpacity={bad ? 0.3 : 0.32} />
              <stop offset="1" stopColor={colour} stopOpacity="0" />
            </linearGradient>
          </defs>
          <g stroke="#2a2a28" strokeWidth="1">
            <path className="ln" d="M0 12H360M0 48H360M0 84H360M0 120H360" />
          </g>
          <path d={model.area} fill={`url(#${fillId})`} />
          <path className="ln" d={model.line} fill="none" stroke={colour} strokeWidth="2" />
        </svg>
        <div className="yax" aria-hidden="true">
          {model.ticks.map((tick, i) => (
            <span key={i} style={{ top: 12 + i * 36 }}>
              {tick}
            </span>
          ))}
        </div>
      </div>
      <div className="ax" aria-hidden="true">
        {model.times.map((time, i) => (
          <span key={i}>{time}</span>
        ))}
      </div>
    </div>
  );
}
