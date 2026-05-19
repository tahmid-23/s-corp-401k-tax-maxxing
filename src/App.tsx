import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { compute, type Inputs } from "./lib/calc";
import { solveForTarget } from "./lib/solver";
import {
  FEDERAL,
  STATES,
  TAX_YEAR,
  type StateKey,
  type StatePreset,
} from "./lib/tax-constants";
import type { DeferralTaxType, FilingStatus } from "./lib/types";
import { money, pct } from "./lib/format";
import { Card } from "./components/Card";
import { Field, FieldRow } from "./components/Field";
import { NumberInput } from "./components/NumberInput";
import { SegmentedToggle } from "./components/SegmentedToggle";
import { LimitBar } from "./components/LimitBar";
import { DiagnosticRow } from "./components/DiagnosticRow";
import { Explainer } from "./components/Explainer";
import { SolverCard } from "./components/SolverCard";

const DEFAULT_INPUTS: Inputs = {
  filingStatus: "single",
  age: 38,
  state: "ca",
  nycResident: false,
  previewWaMillionairesTax: false,
  dayJobW2: 225_000,
  dayJobMatchPct: 0.5,
  dayJobMatchLimitPct: 0.06,
  dayJob401kEmployeeContribution: 24_500,
  dayJob401kType: "traditional",
  sCorpNetProfit: 150_000,
  sCorpW2Salary: 60_000,
  soloEmployeeDeferral: 0,
  soloEmployerContribution: 15_000,
  solo401kEmployeeType: "traditional",
  isSSTB: false,
  otherIncome: 0,
};

export function App() {
  const [inputs, setInputs] = useState<Inputs>(DEFAULT_INPUTS);
  const [target401k, setTarget401k] = useState<number | null>(null);

  const out = useMemo(() => compute(inputs), [inputs]);
  const solution = useMemo(
    () =>
      target401k != null && target401k > 0
        ? solveForTarget(inputs, target401k, { maxOutDayJobDeferral: false })
        : null,
    [inputs, target401k],
  );

  const set = <K extends keyof Inputs>(k: K, v: Inputs[K]) =>
    setInputs((p) => ({ ...p, [k]: v }));

  const statePreset = STATES[inputs.state] as StatePreset;
  const showNyc = inputs.state === "ny";
  const showWaPreview =
    inputs.state === "wa" && statePreset.futureMillionairesTax != null;

  return (
    <div className="paper-grain min-h-dvh">
      <div className="mx-auto max-w-7xl px-6 md:px-10 lg:px-14 py-10 lg:py-16">
        {/* ─── Masthead ──────────────────────────────────────────────── */}
        <motion.header
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="pb-10 border-b border-ink/15"
        >
          <div className="flex items-baseline justify-between gap-6 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="display text-4xl md:text-5xl leading-[1.05]">
                  The S-Corp 401(k) Ledger
                </h1>
                <span className="inline-flex items-center justify-center font-mono text-[11px] uppercase tracking-[0.18em] text-paper bg-accent px-2.5 h-6 leading-none translate-y-[3px]">
                  {TAX_YEAR}
                </span>
              </div>
              <p className="mt-4 max-w-2xl text-ink-soft leading-relaxed">
                A calculator for people who hold a W-2 job and own an S-corp at
                the same time. Work out the right salary, the right contribution
                split, and what each dollar of S-corp wages actually costs you
                in FICA. All limits, brackets, and rates use {TAX_YEAR} figures.
              </p>
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint text-right">
              <div>Not tax advice</div>
              <div className="mt-0.5 not-italic">Federal · CA · NY · WA</div>
            </div>
          </div>
        </motion.header>

        {/* ─── Two-column layout ─────────────────────────────────────── */}
        <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-x-14 mt-10 lg:divide-x lg:divide-ink/10">
          {/* ── Inputs column ──────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }}
            className="space-y-2 lg:pr-8"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-faint">
                Inputs
              </span>
              <div className="flex-1 h-px bg-ink/15" />
            </div>
            <Card title="Filer" marker="I">
              <FieldRow>
                <Field label="Filing status">
                  <select
                    value={inputs.filingStatus}
                    onChange={(e) =>
                      set("filingStatus", e.target.value as FilingStatus)
                    }
                  >
                    <option value="single">Single</option>
                    <option value="mfj">Married filing jointly</option>
                    <option value="mfs">Married filing separately</option>
                    <option value="hoh">Head of household</option>
                  </select>
                </Field>
                <Field label="Age">
                  <NumberInput
                    value={inputs.age}
                    onChange={(v) => set("age", v)}
                    step={1}
                    min={0}
                  />
                </Field>
              </FieldRow>
              <Field
                label="State"
                hint={
                  inputs.state === "wa"
                    ? statePreset.note
                    : statePreset.localities?.nyc && !inputs.nycResident
                      ? "Toggle NYC resident below if you live in the five boroughs."
                      : undefined
                }
              >
                <select
                  value={inputs.state}
                  onChange={(e) => set("state", e.target.value as StateKey)}
                >
                  {Object.entries(STATES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </Field>
              {showNyc && (
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={inputs.nycResident}
                    onChange={(e) => set("nycResident", e.target.checked)}
                    className="mt-1 !w-auto"
                  />
                  <span>
                    NYC resident{" "}
                    <span className="text-ink-faint italic">
                      adds NYC local income tax on top of NY state
                    </span>
                  </span>
                </label>
              )}
              {showWaPreview && (
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={inputs.previewWaMillionairesTax}
                    onChange={(e) =>
                      set("previewWaMillionairesTax", e.target.checked)
                    }
                    className="mt-1 !w-auto"
                  />
                  <span>
                    Preview 2028 ESSB 6346{" "}
                    <span className="text-ink-faint italic">
                      9.9% on household income above $1M, pending litigation
                    </span>
                  </span>
                </label>
              )}
            </Card>

            <Card title="Day-Job W-2" marker="II">
              <FieldRow>
                <Field label="Annual W-2 wages">
                  <NumberInput
                    value={inputs.dayJobW2}
                    onChange={(v) => set("dayJobW2", v)}
                    prefix="$"
                    step={5_000}
                  />
                </Field>
                <Field label="Your 401(k) contribution">
                  <NumberInput
                    value={inputs.dayJob401kEmployeeContribution}
                    onChange={(v) => set("dayJob401kEmployeeContribution", v)}
                    prefix="$"
                    step={500}
                  />
                </Field>
              </FieldRow>
              <FieldRow>
                <Field label="Employer match rate">
                  <NumberInput
                    value={inputs.dayJobMatchPct * 100}
                    onChange={(v) => set("dayJobMatchPct", v / 100)}
                    suffix="%"
                    step={5}
                    min={0}
                    max={200}
                  />
                </Field>
                <Field label="Match up to (% of comp)">
                  <NumberInput
                    value={inputs.dayJobMatchLimitPct * 100}
                    onChange={(v) => set("dayJobMatchLimitPct", v / 100)}
                    suffix="%"
                    step={0.5}
                    min={0}
                    max={100}
                  />
                </Field>
              </FieldRow>
              <Field label="Deferral type">
                <SegmentedToggle<DeferralTaxType>
                  value={inputs.dayJob401kType}
                  options={[
                    { value: "traditional", label: "Traditional (pretax)" },
                    { value: "roth", label: "Roth (after-tax)" },
                  ]}
                  onChange={(v) => set("dayJob401kType", v)}
                />
              </Field>
            </Card>

            <Card title="S-Corp" marker="III">
              <FieldRow>
                <Field label="Net profit (before owner W-2)">
                  <NumberInput
                    value={inputs.sCorpNetProfit}
                    onChange={(v) => set("sCorpNetProfit", v)}
                    prefix="$"
                    step={10_000}
                  />
                </Field>
                <Field
                  label="Your S-corp W-2 salary"
                  hint="The reasonable-compensation lever"
                >
                  <NumberInput
                    value={inputs.sCorpW2Salary}
                    onChange={(v) => set("sCorpW2Salary", v)}
                    prefix="$"
                    step={5_000}
                  />
                </Field>
              </FieldRow>
              <input
                type="range"
                min={0}
                max={Math.max(inputs.sCorpNetProfit, 250_000)}
                step={1_000}
                value={inputs.sCorpW2Salary}
                onChange={(e) => set("sCorpW2Salary", Number(e.target.value))}
                aria-label="S-corp W-2 salary slider"
              />
              <FieldRow>
                <Field label="Solo 401(k): employee deferral">
                  <NumberInput
                    value={inputs.soloEmployeeDeferral}
                    onChange={(v) => set("soloEmployeeDeferral", v)}
                    prefix="$"
                    step={500}
                  />
                </Field>
                <Field
                  label="Solo 401(k): employer (25% cap)"
                  hint={`25% of W-2 = ${money(out.solo25PctCap)}`}
                >
                  <NumberInput
                    value={inputs.soloEmployerContribution}
                    onChange={(v) => set("soloEmployerContribution", v)}
                    prefix="$"
                    step={500}
                  />
                </Field>
              </FieldRow>
              <Field label="Solo deferral type">
                <SegmentedToggle<DeferralTaxType>
                  value={inputs.solo401kEmployeeType}
                  options={[
                    { value: "traditional", label: "Traditional (pretax)" },
                    { value: "roth", label: "Roth (after-tax)" },
                  ]}
                  onChange={(v) => set("solo401kEmployeeType", v)}
                />
              </Field>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={inputs.isSSTB}
                  onChange={(e) => set("isSSTB", e.target.checked)}
                  className="mt-1 !w-auto"
                />
                <span>
                  Specified Service Trade/Business (SSTB){" "}
                  <span className="text-ink-faint italic">
                    law, health, consulting, finance. QBI phases out at high
                    income.
                  </span>
                </span>
              </label>
            </Card>

            <Card title="Other" marker="IV">
              <Field
                label="Other unrelated income"
                hint="Spouse W-2, interest, dividends, rental income, anything else that feeds the bracket math"
              >
                <NumberInput
                  value={inputs.otherIncome}
                  onChange={(v) => set("otherIncome", v)}
                  prefix="$"
                  step={5_000}
                />
              </Field>
              <Field
                label="Target 401(k) total (optional)"
                hint="Enter a target and you'll see what salary and split would get you there."
              >
                <NumberInput
                  value={target401k ?? 0}
                  onChange={(v) => setTarget401k(v > 0 ? v : null)}
                  prefix="$"
                  step={1_000}
                />
              </Field>
              {solution && <SolverCard solution={solution} />}
            </Card>
          </motion.div>

          {/* ── Results column ─────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2, ease: "easeOut" }}
            className="space-y-2 mt-12 lg:mt-0 lg:pl-8"
          >
            <div className="flex items-center gap-3 mb-2">
              <div className="flex-1 h-px bg-ink/15" />
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-faint">
                Results
              </span>
              <div className="flex-1 h-px bg-ink/15" />
            </div>
            {/* 401(k) breakdown */}
            <Card
              variant="output"
              title="401(k) across both plans"
              marker={`Total ${money(out.total401k)}`}
            >
              <LimitBar
                title="Day-job 401(k)"
                cap={FEDERAL.annualAdditions415c}
                capLabel="415(c)"
                segments={[
                  {
                    label:
                      inputs.dayJob401kType === "roth"
                        ? "Employee (Roth)"
                        : "Employee (pretax)",
                    amount: out.dayJobEmployeeDeferral,
                    variant:
                      inputs.dayJob401kType === "roth" ? "roth" : "pretax",
                  },
                  {
                    label: "Employer match",
                    amount: out.dayJobEmployerMatch,
                    variant: "match",
                  },
                ]}
              />
              <LimitBar
                title="Solo 401(k) at the S-corp"
                cap={FEDERAL.annualAdditions415c}
                capLabel="415(c)"
                segments={[
                  {
                    label:
                      inputs.solo401kEmployeeType === "roth"
                        ? "Employee (Roth)"
                        : "Employee (pretax)",
                    amount: out.soloEmployeeDeferral,
                    variant:
                      inputs.solo401kEmployeeType === "roth"
                        ? "roth"
                        : "pretax",
                  },
                  {
                    label: "Employer profit-sharing",
                    amount: out.soloEmployerContribution,
                    variant: "employer",
                  },
                ]}
              />
              <LimitBar
                title="Combined employee deferral"
                cap={out.electiveDeferralLimitEffective}
                capLabel="402(g)"
                segments={[
                  {
                    label: "Day-job deferral",
                    amount: out.dayJobEmployeeDeferral,
                    variant:
                      inputs.dayJob401kType === "roth" ? "roth" : "pretax",
                  },
                  {
                    label: "Solo deferral",
                    amount: out.soloEmployeeDeferral,
                    variant:
                      inputs.solo401kEmployeeType === "roth"
                        ? "roth"
                        : "pretax",
                  },
                ]}
              />
              {out.warnings.length > 0 && (
                <div className="mt-2 space-y-2">
                  {out.warnings.map((w, i) => (
                    <div
                      key={i}
                      className="text-xs leading-snug text-warn border-l-2 border-warn pl-3 py-1"
                    >
                      {w}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* FICA */}
            <Card
              variant="output"
              title="FICA diagnostics"
              marker="payroll tax"
            >
              <DiagnosticRow
                label="S-corp employer-side SS, wasted"
                detail="Non-refundable. Paid by your S-corp on W-2 already covered by your day job."
                value={out.ssEmployerWastedAtSCorp}
                tone={out.ssEmployerWastedAtSCorp > 0 ? "warn" : "muted"}
              />
              <DiagnosticRow
                label="Employee-side SS, refundable"
                detail="Recovered on Form 1040 Schedule 3 as excess SS withholding."
                value={out.ssEmployeeRefundable}
                tone={out.ssEmployeeRefundable > 0 ? "positive" : "muted"}
              />
              <DiagnosticRow
                label="Additional Medicare (0.9%)"
                detail={`Threshold for ${inputs.filingStatus.toUpperCase()}: ${money(FEDERAL.additionalMedicareThreshold[inputs.filingStatus])}. Employee pays this. There is no employer match.`}
                value={out.additionalMedicareLiability}
                tone={out.additionalMedicareLiability > 0 ? "warn" : "muted"}
              />
              <DiagnosticRow
                label="Medicare, employee total"
                value={out.medicareEmployee}
                tone="muted"
              />
              <DiagnosticRow
                label="Medicare, employer total"
                value={out.medicareEmployer}
                tone="muted"
              />
              <div className="pt-2 mt-2 border-t border-rule-soft">
                <div className="text-xs text-ink-faint mb-1 uppercase tracking-wider">
                  Marginal cost of $1 more S-corp W-2
                </div>
                <DiagnosticRow
                  label="Employer SS (S-corp)"
                  value={pct(out.marginalSCorpW2Cost.employerSS, 2)}
                  tone={
                    out.marginalSCorpW2Cost.employerSS > 0 ? "warn" : "muted"
                  }
                />
                <DiagnosticRow
                  label="Medicare both halves + add'l"
                  value={pct(
                    out.marginalSCorpW2Cost.employerMedicare +
                      out.marginalSCorpW2Cost.employeeMedicareTotal,
                    2,
                  )}
                  tone="muted"
                />
                <DiagnosticRow
                  label="QBI deduction lost on extra W-2"
                  detail="Each $1 of S-corp W-2 reduces pass-through QBI by $1 → 20% × marginal federal rate is the tax cost."
                  value={pct(-out.marginalSCorpW2Cost.qbiOffset, 2)}
                  tone={
                    out.marginalSCorpW2Cost.qbiOffset < 0 ? "warn" : "muted"
                  }
                />
              </div>
            </Card>

            {/* Income tax */}
            <Card variant="output" title="Income tax" marker="federal + state">
              <DiagnosticRow label="AGI" value={out.agi} />
              <DiagnosticRow
                label="QBI deduction"
                detail="20% of pass-through profit, subject to SSTB and W-2 wage limits above the income threshold."
                value={-out.qbiDeduction}
                tone={out.qbiDeduction > 0 ? "positive" : "muted"}
              />
              <DiagnosticRow
                label="Taxable income (after QBI)"
                value={out.taxableIncome}
              />
              <DiagnosticRow
                label={`Federal income tax (marginal ${pct(out.marginalFederalRate, 0)})`}
                value={out.federalIncomeTax}
              />
              {out.stateIncomeTax > 0 && (
                <DiagnosticRow
                  label={`${statePreset.name} state tax (marginal ${pct(out.marginalStateRate, 1)})`}
                  value={out.stateIncomeTax}
                />
              )}
              {out.stateSurtax > 0 && (
                <DiagnosticRow
                  label={statePreset.surtax?.label ?? "State surtax"}
                  value={out.stateSurtax}
                  tone="warn"
                />
              )}
              {out.localIncomeTax > 0 && (
                <DiagnosticRow
                  label="NYC local income tax"
                  value={out.localIncomeTax}
                  tone="warn"
                />
              )}
              {out.waMillionairesTaxPreview > 0 && (
                <DiagnosticRow
                  label="WA ESSB 6346 (2028 preview)"
                  detail="Not in effect for 2026. Litigation pending."
                  value={out.waMillionairesTaxPreview}
                  tone="warn"
                />
              )}
            </Card>

          </motion.div>
        </div>

        <Explainer />
      </div>
    </div>
  );
}
