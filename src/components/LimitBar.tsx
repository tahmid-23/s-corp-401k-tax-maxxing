import { money } from "../lib/format";

type Segment = {
  amount: number;
  label: string;
  variant: "pretax" | "roth" | "match" | "employer";
};

function segmentsWithOffsets(
  segs: Segment[],
): { seg: Segment; offset: number }[] {
  const out: { seg: Segment; offset: number }[] = [];
  let offset = 0;
  for (const seg of segs) {
    out.push({ seg, offset });
    offset += seg.amount;
  }
  return out;
}

const COLOR: Record<Segment["variant"], string> = {
  pretax: "var(--color-pretax)",
  roth: "var(--color-roth)",
  match: "var(--color-match)",
  employer: "var(--color-accent-soft)",
};

export function LimitBar({
  title,
  cap,
  capLabel,
  segments,
  warningAtPct = 1,
}: {
  title: string;
  cap: number;
  capLabel: string;
  segments: Segment[];
  warningAtPct?: number;
}) {
  const used = segments.reduce((s, x) => s + x.amount, 0);
  const pctUsed = cap > 0 ? Math.min(1, used / cap) : 0;
  const remaining = Math.max(0, cap - used);
  const isWarning = used / cap >= warningAtPct - 0.0001;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-ink">{title}</h3>
        <div className="font-mono text-xs text-ink-faint">
          {money(used)}
          <span className="text-ink-faint/60"> / </span>
          <span>{money(cap)}</span>
        </div>
      </div>

      <div className="relative mt-2 h-4 bg-paper-deep border border-rule-soft overflow-hidden">
        {segmentsWithOffsets(segments).map(({ seg, offset }, i) => {
          const widthPct = cap > 0 ? (seg.amount / cap) * 100 : 0;
          const leftPct = cap > 0 ? (offset / cap) * 100 : 0;
          return (
            <div
              key={i}
              className="absolute top-0 bottom-0 transition-[width,left] duration-300 ease-out"
              style={{
                left: `${leftPct}%`,
                width: `${widthPct}%`,
                background: COLOR[seg.variant],
              }}
              title={`${seg.label}: ${money(seg.amount)}`}
            />
          );
        })}
        {/* Cap line */}
        <div
          className="absolute top-0 bottom-0 w-px"
          style={{
            left: `${pctUsed * 100}%`,
            background: isWarning ? "var(--color-warn)" : "transparent",
          }}
        />
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-ink-faint">
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {segments
            .filter((s) => s.amount > 0)
            .map((s, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2 h-2"
                  style={{ background: COLOR[s.variant] }}
                />
                <span>
                  {s.label} <span className="font-mono">{money(s.amount)}</span>
                </span>
              </span>
            ))}
        </div>
        <div className="font-mono">
          {capLabel}: {money(remaining)} left
        </div>
      </div>
    </div>
  );
}
