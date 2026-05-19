import type { Solution } from "../lib/solver";
import { money } from "../lib/format";

export function SolverCard({ solution }: { solution: Solution }) {
  if (solution.feasible) {
    return (
      <div className="mt-3 border-l-2 border-accent pl-4 py-1">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent mb-2">
          Recommendation
        </div>
        <p className="text-sm leading-relaxed text-ink-soft mb-3">
          {solution.note}
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <SolverField label="Set S-corp W-2 to" value={solution.sCorpW2} />
          <SolverField
            label="Solo 401(k) employee"
            value={solution.soloEmployeeDeferral}
          />
          <SolverField
            label="Solo 401(k) employer"
            value={solution.soloEmployerContribution}
          />
          <SolverField label="Reaches a total of" value={solution.total} />
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 border-l-2 border-warn pl-4 py-1">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-warn mb-2">
        Out of reach
      </div>
      <p className="text-sm leading-relaxed text-ink-soft mb-2">
        {solution.reason}
      </p>
      <p className="text-sm text-ink-soft">
        The most you could hit with your current inputs is{" "}
        <span className="font-mono text-ink">
          {money(solution.maximumAchievable)}
        </span>
        .
      </p>
    </div>
  );
}

function SolverField({ label, value }: { label: string; value: number }) {
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
