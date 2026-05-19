import type { TaxOptimalSolution } from "../lib/solver";
import { money } from "../lib/format";

/**
 * Headline recommendation: the (sCorpW-2, deferral, employer) combination
 * that minimizes total tax + non-recoverable FICA this year. Different
 * from maxAchievableContribution in that it values current-year cash
 * (after FICA + income tax) over additional 401(k) dollars when the
 * ramp would cost more in payroll tax than it saves in deferrals.
 */
export function TaxOptimalCard({
  solution,
  onApply,
}: {
  solution: TaxOptimalSolution;
  onApply: () => void;
}) {
  const savesMoney = solution.savingsVsCurrent > 1;
  return (
    <div className="mt-3 border-l-2 border-accent pl-4 py-1">
      <div className="flex items-baseline justify-between mb-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
          Tax-optimal split
        </div>
        {savesMoney && (
          <div className="font-mono text-[10px] text-positive tabular-nums">
            saves {money(solution.savingsVsCurrent)} vs current
          </div>
        )}
      </div>
      <p className="text-sm leading-relaxed text-ink-soft mb-3">
        {solution.note}
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Field label="S-corp W-2" value={solution.sCorpW2} />
        <Field
          label="Day-job deferral"
          value={solution.dayJobEmployeeDeferral}
        />
        <Field
          label="Solo 401(k) employee"
          value={solution.soloEmployeeDeferral}
        />
        <Field
          label="Solo 401(k) employer"
          value={solution.soloEmployerContribution}
        />
        <Field label="Total 401(k)" value={solution.totalContribution} />
        <Field label="Total tax this year" value={solution.totalTax} />
      </div>
      <button
        type="button"
        onClick={onApply}
        className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent transition-colors"
      >
        Apply these numbers to inputs
      </button>
    </div>
  );
}

function Field({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
        {label}
      </div>
      <div className="font-mono tabular-nums text-base text-ink">
        {money(value)}
      </div>
    </div>
  );
}
