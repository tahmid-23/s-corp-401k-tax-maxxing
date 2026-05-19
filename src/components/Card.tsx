import type { ReactNode } from "react";

type Variant = "input" | "output";

export function Card({
  title,
  marker,
  variant = "input",
  children,
}: {
  title: string;
  marker?: string;
  variant?: Variant;
  children: ReactNode;
}) {
  if (variant === "output") {
    return (
      <section className="border border-ink/15 bg-paper-deep/40 px-5 py-5 mb-3 shadow-[inset_0_1px_0_rgba(0,0,0,0.02)]">
        <header className="flex items-baseline justify-between mb-4 pb-2 border-b border-ink/10">
          <h2 className="display text-lg text-ink tracking-tight">{title}</h2>
          {marker && (
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
              {marker}
            </span>
          )}
        </header>
        <div className="space-y-3">{children}</div>
      </section>
    );
  }

  // input variant: lighter weight, top hairline, hanging marker on the left
  return (
    <section className="relative pt-5 pb-6 mb-1 border-t border-rule">
      <header className="flex items-baseline justify-between mb-5">
        <h2 className="display text-xl text-ink tracking-tight">{title}</h2>
        {marker && (
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
            {marker}
          </span>
        )}
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
