import { useState } from "react";
import { formatNumber } from "../lib/format";

type Props = {
  value: number;
  onChange: (n: number) => void;
  prefix?: string;
  suffix?: string;
  step?: number;
  min?: number;
  max?: number;
  ariaLabel?: string;
};

export function NumberInput({
  value,
  onChange,
  prefix,
  suffix,
  step = 1000,
  min,
  max,
  ariaLabel,
}: Props) {
  // Local text state lets the user type "12,3" mid-edit without React
  // reformatting on every keystroke. We re-derive from `value` whenever the
  // prop changes externally (e.g., a linked slider moves) by comparing the
  // last-seen value during render — the React-recommended idiom for adjusting
  // state on a prop change without using an effect.
  const [text, setText] = useState(() => formatNumber(value));
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setText(formatNumber(value));
  }

  return (
    <div className="flex items-baseline gap-1.5 border-b border-rule transition-colors focus-within:border-accent">
      {prefix && (
        <span className="font-mono text-sm text-ink-faint select-none">
          {prefix}
        </span>
      )}
      <input
        type="text"
        inputMode="decimal"
        value={text}
        aria-label={ariaLabel}
        onChange={(e) => {
          // Pass the raw parsed value through during editing. No clamping here
          // so typing "21" doesn't get intercepted as "2" → clamped to min.
          // Clamp happens once, on blur.
          const raw = e.target.value;
          setText(raw);
          const cleaned = raw.replace(/[^0-9.-]/g, "");
          if (cleaned === "" || cleaned === "-") {
            onChange(0);
            return;
          }
          const parsed = Number(cleaned);
          if (Number.isFinite(parsed)) {
            onChange(parsed);
          }
        }}
        onBlur={() => {
          const clamped = Math.min(
            max ?? Infinity,
            Math.max(min ?? -Infinity, value),
          );
          if (clamped !== value) onChange(clamped);
          setText(formatNumber(clamped));
        }}
        onFocus={(e) => e.target.select()}
        className="flex-1 min-w-0 border-0 outline-none !border-b-0"
        style={{ borderBottom: "none" }}
        step={step}
      />
      {suffix && (
        <span className="font-mono text-sm text-ink-faint select-none">
          {suffix}
        </span>
      )}
    </div>
  );
}
