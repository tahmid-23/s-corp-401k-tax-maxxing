import type { ReactNode } from "react";
import { money } from "../lib/format";

export function DiagnosticRow({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  detail?: ReactNode;
  tone?: "neutral" | "positive" | "warn" | "muted";
}) {
  const toneClass =
    tone === "warn"
      ? "text-warn"
      : tone === "positive"
        ? "text-positive"
        : tone === "muted"
          ? "text-ink-faint"
          : "text-ink";

  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-rule-soft last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm text-ink">{label}</div>
        {detail && (
          <div className="text-xs text-ink-faint mt-0.5 leading-snug">
            {detail}
          </div>
        )}
      </div>
      <div className={`font-mono text-sm whitespace-nowrap ${toneClass}`}>
        {typeof value === "number" ? money(value) : value}
      </div>
    </div>
  );
}
