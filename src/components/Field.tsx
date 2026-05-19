import type { ReactNode } from "react";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-[0.14em] text-ink-faint mb-1">
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1 block text-xs text-ink-faint italic leading-snug">
          {hint}
        </span>
      )}
    </label>
  );
}

export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-4">{children}</div>;
}
