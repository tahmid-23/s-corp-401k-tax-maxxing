type Option<T extends string> = { value: T; label: string };

export function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex border border-rule font-mono text-xs">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 transition-colors ${
              active
                ? "bg-ink text-paper"
                : "bg-paper text-ink hover:bg-paper-deep"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
