import {
  FEDERAL,
  STATES,
  type StateKey,
  type StatePreset,
} from "./tax-constants";
import type { Bracket, DeferralTaxType, FilingStatus } from "./types";
import { formatNumber } from "./format";

// ─────────────────────────────────────────────────────────────────────────────
// Inputs / Outputs
// ─────────────────────────────────────────────────────────────────────────────

export type FicaOverride = {
  ssWithheld: number;
  medicareWithheld: number;
  addlMedicareWithheld: number;
};

export type Inputs = {
  filingStatus: FilingStatus;
  age: number;

  state: StateKey;
  nycResident: boolean;
  previewWaMillionairesTax: boolean;

  // Day job
  dayJobW2: number;
  dayJobFicaOverride?: FicaOverride;
  dayJobMatchPct: number; // e.g. 0.5
  dayJobMatchLimitPct: number; // % of comp matched up to (e.g. 0.06)
  dayJob401kEmployeeContribution: number;
  dayJob401kType: DeferralTaxType;

  // S-corp
  sCorpNetProfit: number;
  sCorpW2Salary: number;
  soloEmployeeDeferral: number;
  soloEmployerContribution: number;
  solo401kEmployeeType: DeferralTaxType;
  isSSTB: boolean;

  // Other
  otherIncome: number;

  // Goal mode (handled in solver.ts; not consumed here)
};

export type Output = {
  // 401(k)
  dayJobEmployeeDeferral: number;
  dayJobEmployerMatch: number;
  soloEmployeeDeferral: number;
  soloEmployerContribution: number;
  total401k: number;
  catchUpAvailable: number;
  catchUpUsed: number;

  // Limit diagnostics
  electiveDeferralLimitEffective: number;
  electiveDeferralUsed: number;
  electiveDeferralRemaining: number;
  dayJob415cRemaining: number;
  solo415cRemaining: number;
  solo25PctCap: number;

  // FICA
  ssTaxableWagesDayJob: number;
  ssTaxableWagesSCorp: number;
  ssEmployeeTotal: number;
  ssEmployeeRefundable: number; // refundable on Schedule 3
  ssEmployerDayJob: number;
  ssEmployerSCorp: number;
  ssEmployerWastedAtSCorp: number; // the headline red number
  medicareEmployee: number;
  medicareEmployer: number;
  additionalMedicareLiability: number;

  // Marginal-cost of next $ of S-corp W-2
  marginalSCorpW2Cost: {
    employerSS: number;
    employerMedicare: number;
    employeeMedicareTotal: number;
    federalMarginalRate: number;
    stateMarginalRate: number;
    qbiOffset: number;
    netCostPerDollar: number;
  };

  // Income tax
  agi: number;
  taxableIncome: number;
  qbiDeduction: number;
  federalIncomeTax: number;
  stateIncomeTax: number;
  localIncomeTax: number;
  stateSurtax: number;
  waMillionairesTaxPreview: number;
  marginalFederalRate: number;
  marginalStateRate: number;

  // S-corp breakdown
  sCorpEmployerPayrollTax: number; // S-corp's deductible employer-side FICA
  sCorpQbi: number; // pre-deduction QBI (net of W-2 + employer FICA)
  sCorpDistributions: number;

  warnings: string[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Bracket helpers
// ─────────────────────────────────────────────────────────────────────────────

export function taxFromBrackets(
  taxableIncome: number,
  brackets: readonly Bracket[],
): number {
  if (taxableIncome <= 0) return 0;
  let tax = 0;
  let prev = 0;
  for (const { rate, upTo } of brackets) {
    if (taxableIncome <= upTo) {
      tax += (taxableIncome - prev) * rate;
      return tax;
    }
    tax += (upTo - prev) * rate;
    prev = upTo;
  }
  return tax;
}

export function marginalRateAt(
  taxableIncome: number,
  brackets: readonly Bracket[],
): number {
  if (taxableIncome <= 0) return brackets[0]?.rate ?? 0;
  for (const { rate, upTo } of brackets) {
    if (taxableIncome <= upTo) return rate;
  }
  return brackets[brackets.length - 1]?.rate ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function effectiveDeferralLimit(age: number): number {
  if (age >= 60 && age <= 63) {
    return FEDERAL.elective402gLimit + FEDERAL.superCatchUp60to63;
  }
  if (age >= 50) {
    return FEDERAL.elective402gLimit + FEDERAL.catchUp50Plus;
  }
  return FEDERAL.elective402gLimit;
}

function catchUpAvailableFor(age: number): number {
  if (age >= 60 && age <= 63) return FEDERAL.superCatchUp60to63;
  if (age >= 50) return FEDERAL.catchUp50Plus;
  return 0;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

// ─────────────────────────────────────────────────────────────────────────────
// QBI deduction
//   For simplicity v1:
//     - Below the taxable-income threshold: full 20% of QBI (capped by 20% of
//       taxable income net of capital gains, treated as 20% of TI here).
//     - Above the threshold for SSTB: phased out linearly across phaseoutRange.
//     - Above the threshold for non-SSTB: applies the W-2 wage limit
//       (greater of 50% of W-2 wages from the business).
// ─────────────────────────────────────────────────────────────────────────────

function qbiDeduction(args: {
  qbi: number;
  taxableIncomeBeforeQbi: number;
  filingStatus: FilingStatus;
  isSSTB: boolean;
  sCorpW2: number;
}): number {
  const { qbi, taxableIncomeBeforeQbi, filingStatus, isSSTB, sCorpW2 } = args;
  if (qbi <= 0) return 0;

  const tentative = qbi * FEDERAL.qbi.rate;
  const tiCap = Math.max(0, taxableIncomeBeforeQbi) * FEDERAL.qbi.rate;

  const threshold = FEDERAL.qbi.incomeThreshold[filingStatus];
  const phaseout = FEDERAL.qbi.phaseoutRange[filingStatus];

  if (taxableIncomeBeforeQbi <= threshold) {
    return Math.min(tentative, tiCap);
  }

  const overage = taxableIncomeBeforeQbi - threshold;

  if (isSSTB) {
    if (overage >= phaseout) return 0;
    const remaining = 1 - overage / phaseout;
    return Math.min(tentative * remaining, tiCap);
  }

  // Non-SSTB: W-2 wage limit applies (full above the phaseout, partial inside)
  const wageLimit = sCorpW2 * 0.5;
  if (overage >= phaseout) {
    return Math.min(tentative, wageLimit, tiCap);
  }
  // Linear blend between unlimited and wage-limited
  const fractionLimited = overage / phaseout;
  const reducedByWageLimit = Math.max(
    0,
    tentative - (tentative - Math.min(tentative, wageLimit)) * fractionLimited,
  );
  return Math.min(reducedByWageLimit, tiCap);
}

// ─────────────────────────────────────────────────────────────────────────────
// State tax (with optional surtax + locality)
// ─────────────────────────────────────────────────────────────────────────────

function statePresetFor(state: StateKey): StatePreset {
  return STATES[state] as StatePreset;
}

function stateBracketsFor(
  preset: StatePreset,
  fs: FilingStatus,
): readonly Bracket[] {
  return preset.brackets[fs];
}

function stateTax(
  preset: StatePreset,
  fs: FilingStatus,
  stateTaxableIncome: number,
): number {
  return taxFromBrackets(stateTaxableIncome, stateBracketsFor(preset, fs));
}

function stateSurtax(
  preset: StatePreset,
  fs: FilingStatus,
  agi: number,
): number {
  if (!preset.surtax) return 0;
  const threshold =
    fs === "mfj" ? preset.surtax.thresholdMfj : preset.surtax.thresholdSingle;
  return Math.max(0, agi - threshold) * preset.surtax.rate;
}

function localTax(
  preset: StatePreset,
  fs: FilingStatus,
  stateTaxableIncome: number,
  nyc: boolean,
): number {
  if (!nyc) return 0;
  const locality = preset.localities?.nyc;
  if (!locality) return 0;
  return taxFromBrackets(stateTaxableIncome, locality.brackets[fs]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main calculation
// ─────────────────────────────────────────────────────────────────────────────

export function compute(inputs: Inputs): Output {
  const warnings: string[] = [];

  const ageEffectiveLimit = effectiveDeferralLimit(inputs.age);
  const catchUpAvailable = catchUpAvailableFor(inputs.age);

  // ── Day-job 401(k) ────────────────────────────────────────────────────────
  const dayJobEmployeeDeferralRaw = Math.max(
    0,
    inputs.dayJob401kEmployeeContribution,
  );
  const dayJobMatchCap = inputs.dayJobW2 * inputs.dayJobMatchLimitPct;
  const dayJobMatchedDeferralBase = Math.min(
    dayJobEmployeeDeferralRaw,
    dayJobMatchCap,
  );
  const dayJobEmployerMatch = dayJobMatchedDeferralBase * inputs.dayJobMatchPct;

  // ── Solo 401(k) constraints ───────────────────────────────────────────────
  const solo25PctCap = inputs.sCorpW2Salary * FEDERAL.employerContribPctOfW2;
  const soloEmployeeDeferral = Math.max(0, inputs.soloEmployeeDeferral);
  const soloEmployerContribRequested = Math.max(
    0,
    inputs.soloEmployerContribution,
  );
  const soloEmployerContribution = clamp(
    soloEmployerContribRequested,
    0,
    Math.min(
      solo25PctCap,
      Math.max(0, FEDERAL.annualAdditions415c - soloEmployeeDeferral),
    ),
  );

  // ── Elective deferral aggregation (per-person) ────────────────────────────
  const electiveDeferralUsed = dayJobEmployeeDeferralRaw + soloEmployeeDeferral;
  const electiveDeferralLimitEffective = ageEffectiveLimit;
  const electiveDeferralRemaining = Math.max(
    0,
    electiveDeferralLimitEffective - electiveDeferralUsed,
  );
  const catchUpUsed = Math.min(
    catchUpAvailable,
    Math.max(0, electiveDeferralUsed - FEDERAL.elective402gLimit),
  );

  if (electiveDeferralUsed > electiveDeferralLimitEffective) {
    warnings.push(
      `Combined employee deferrals ($${formatNumber(electiveDeferralUsed)}) exceed the per-person 402(g) limit of $${formatNumber(electiveDeferralLimitEffective)}. Excess must be withdrawn by April 15 to avoid double taxation.`,
    );
  }
  if (soloEmployerContribRequested > solo25PctCap + 0.5) {
    warnings.push(
      `Solo 401(k) employer contribution exceeds 25% of S-corp W-2 ($${formatNumber(solo25PctCap)}). It has been capped in the math.`,
    );
  }
  if (
    soloEmployeeDeferral + soloEmployerContribRequested >
    FEDERAL.annualAdditions415c + 0.5
  ) {
    warnings.push(
      `Solo 401(k) total annual additions exceed the 415(c) limit of $${formatNumber(FEDERAL.annualAdditions415c)}.`,
    );
  }
  // Solo employee deferral can't exceed post-FICA W-2 cash.
  if (inputs.sCorpW2Salary > 0 && soloEmployeeDeferral > 0) {
    const ssTaxable = Math.min(inputs.sCorpW2Salary, FEDERAL.ssWageBase);
    const ssWithheld = ssTaxable * FEDERAL.ssRateEmployee;
    const medicareWithheld =
      inputs.sCorpW2Salary * FEDERAL.medicareRateEmployee;
    const postFicaCash = Math.max(
      0,
      inputs.sCorpW2Salary - ssWithheld - medicareWithheld,
    );
    if (soloEmployeeDeferral > postFicaCash + 0.5) {
      warnings.push(
        `Solo employee deferral of $${formatNumber(soloEmployeeDeferral)} exceeds the post-FICA cash from your S-corp W-2 ($${formatNumber(postFicaCash)}). You can't defer more than your paycheck delivers.`,
      );
    }
  }

  // ── 415(c) remaining ──────────────────────────────────────────────────────
  const dayJob415cRemaining = Math.max(
    0,
    FEDERAL.annualAdditions415c -
      dayJobEmployeeDeferralRaw -
      dayJobEmployerMatch,
  );
  const solo415cRemaining = Math.max(
    0,
    FEDERAL.annualAdditions415c -
      soloEmployeeDeferral -
      soloEmployerContribution,
  );

  // ── FICA ──────────────────────────────────────────────────────────────────
  const dayJobSSWages = Math.min(inputs.dayJobW2, FEDERAL.ssWageBase);
  const sCorpSSWages = Math.min(inputs.sCorpW2Salary, FEDERAL.ssWageBase);

  const dayJobFica = inputs.dayJobFicaOverride;
  const ssEmployeeDayJob = dayJobFica
    ? dayJobFica.ssWithheld
    : dayJobSSWages * FEDERAL.ssRateEmployee;
  const ssEmployeeSCorp = sCorpSSWages * FEDERAL.ssRateEmployee;
  const ssEmployeeTotal = ssEmployeeDayJob + ssEmployeeSCorp;
  const ssEmployeeRefundable = Math.max(
    0,
    ssEmployeeTotal - FEDERAL.ssRateEmployee * FEDERAL.ssWageBase,
  );

  const ssEmployerDayJob = dayJobSSWages * FEDERAL.ssRateEmployer;
  const ssEmployerSCorp = sCorpSSWages * FEDERAL.ssRateEmployer;

  // The S-corp's wasted SS = the portion of its SS payment that, when combined
  // with the day job's SS-taxable wages, exceeds the single-employer wage base.
  // (Day job pays its SS regardless — sunk; only the S-corp side is something
  // the user actually controls via W-2 lever.)
  const headroomBeforeSCorpHitsCap = Math.max(
    0,
    FEDERAL.ssWageBase - dayJobSSWages,
  );
  const sCorpSSWagesAboveCombinedCap = Math.max(
    0,
    sCorpSSWages - headroomBeforeSCorpHitsCap,
  );
  const ssEmployerWastedAtSCorp =
    sCorpSSWagesAboveCombinedCap * FEDERAL.ssRateEmployer;

  const medicareWagesTotal = inputs.dayJobW2 + inputs.sCorpW2Salary;
  const medicareEmployee = dayJobFica
    ? dayJobFica.medicareWithheld +
      inputs.sCorpW2Salary * FEDERAL.medicareRateEmployee
    : medicareWagesTotal * FEDERAL.medicareRateEmployee;
  const medicareEmployer = medicareWagesTotal * FEDERAL.medicareRateEmployer;

  const addlMedicareThreshold =
    FEDERAL.additionalMedicareThreshold[inputs.filingStatus];
  const additionalMedicareLiability = dayJobFica
    ? dayJobFica.addlMedicareWithheld +
      Math.max(0, medicareWagesTotal - addlMedicareThreshold) *
        FEDERAL.additionalMedicareRate -
      dayJobFica.addlMedicareWithheld
    : Math.max(0, medicareWagesTotal - addlMedicareThreshold) *
      FEDERAL.additionalMedicareRate;

  // ── S-corp distributions & QBI ────────────────────────────────────────────
  // S-corp deducts the employer-side payroll taxes it pays on the owner's W-2.
  const sCorpEmployerPayrollTax =
    ssEmployerSCorp + inputs.sCorpW2Salary * FEDERAL.medicareRateEmployer;
  const sCorpQbi = Math.max(
    0,
    inputs.sCorpNetProfit -
      inputs.sCorpW2Salary -
      sCorpEmployerPayrollTax -
      soloEmployerContribution,
  );
  // Distributions = net profit minus W-2 wages minus employer-side payroll
  // taxes minus employer 401(k) contribution paid by the S-corp.
  const sCorpDistributions = sCorpQbi;

  // ── AGI / taxable income ──────────────────────────────────────────────────
  // Traditional employee deferrals reduce wages-in-AGI (still subject to FICA,
  // but excluded from federal income wages). Roth deferrals do not.
  const dayJobTraditionalDeferral =
    inputs.dayJob401kType === "traditional" ? dayJobEmployeeDeferralRaw : 0;
  const soloTraditionalDeferral =
    inputs.solo401kEmployeeType === "traditional" ? soloEmployeeDeferral : 0;

  const wageIncomeForAgi =
    inputs.dayJobW2 -
    dayJobTraditionalDeferral +
    inputs.sCorpW2Salary -
    soloTraditionalDeferral;

  // Deductible half of additional Medicare? No — addl Medicare is not deductible.
  // Half of SE tax? Not relevant for S-corp owners (they pay FICA via W-2).
  const agi = wageIncomeForAgi + sCorpDistributions + inputs.otherIncome;

  const stdDeduction = FEDERAL.standardDeduction[inputs.filingStatus];

  // QBI is deducted from taxable income, computed against "taxable income before QBI"
  const taxableIncomeBeforeQbi = Math.max(0, agi - stdDeduction);
  const qbi = qbiDeduction({
    qbi: sCorpQbi,
    taxableIncomeBeforeQbi,
    filingStatus: inputs.filingStatus,
    isSSTB: inputs.isSSTB,
    sCorpW2: inputs.sCorpW2Salary,
  });
  const taxableIncome = Math.max(0, taxableIncomeBeforeQbi - qbi);

  const federalBrackets = FEDERAL.brackets[inputs.filingStatus];
  const federalIncomeTax = taxFromBrackets(taxableIncome, federalBrackets);
  const marginalFederalRate = marginalRateAt(taxableIncome, federalBrackets);

  // ── State / local tax ─────────────────────────────────────────────────────
  const statePreset = statePresetFor(inputs.state);
  const stateStdDeduction = statePreset.standardDeduction[inputs.filingStatus];
  // Simplified: states largely conform to federal AGI; use AGI minus state
  // standard deduction as the state taxable income.
  const stateTaxableIncome = Math.max(0, agi - stateStdDeduction);
  const stateIncomeTax = stateTax(
    statePreset,
    inputs.filingStatus,
    stateTaxableIncome,
  );
  const surtax = stateSurtax(statePreset, inputs.filingStatus, agi);
  const localIncomeTax = localTax(
    statePreset,
    inputs.filingStatus,
    stateTaxableIncome,
    inputs.nycResident,
  );
  const stateMarginalRate = marginalRateAt(
    stateTaxableIncome,
    stateBracketsFor(statePreset, inputs.filingStatus),
  );

  const waMillionairesTaxPreview =
    inputs.previewWaMillionairesTax && statePreset.futureMillionairesTax
      ? Math.max(0, agi - statePreset.futureMillionairesTax.threshold) *
        statePreset.futureMillionairesTax.rate
      : 0;

  // ── Marginal cost of next $ of S-corp W-2 ─────────────────────────────────
  const dayJobAlreadyAtSSCap = dayJobSSWages >= FEDERAL.ssWageBase;
  // Next $ of S-corp W-2 incurs employer SS only if the S-corp's own SS wages
  // are still below the wage base (the employer pays SS on its own wages, not
  // aggregated). It is "wasted" (in our diagnostic sense) when the day-job
  // wages alone already covered the cap.
  const sCorpAtOwnSsCap = sCorpSSWages >= FEDERAL.ssWageBase;
  const nextDollarEmployerSS = sCorpAtOwnSsCap ? 0 : FEDERAL.ssRateEmployer;
  const nextDollarEmployerSSWasted = dayJobAlreadyAtSSCap && !sCorpAtOwnSsCap;
  const aboveAddlMedicareThreshold =
    medicareWagesTotal >= addlMedicareThreshold;

  const nextDollarEmployeeMedicare =
    FEDERAL.medicareRateEmployee +
    (aboveAddlMedicareThreshold ? FEDERAL.additionalMedicareRate : 0);

  // QBI offset: paying $1 more W-2 reduces QBI by $1 (plus a small amount for
  // the incremental employer FICA the S-corp deducts), reducing the QBI
  // deduction by ~20% × $1. At the user's federal marginal rate, that's a
  // tax-INCREASE of (0.20 × marginalRate). The W-2 dollar itself is taxed at
  // the marginal rate. So net federal tax change of an extra W-2 dollar vs
  // an extra distribution dollar is roughly:
  //    +marginal × (1 − 0.20)  if QBI applies fully
  // The diagnostic shows what's GAINED by adding W-2 (negative = better).
  const qbiOffset = qbi > 0 ? -FEDERAL.qbi.rate * marginalFederalRate : 0;

  const netCostPerDollar =
    nextDollarEmployerSS +
    FEDERAL.medicareRateEmployer +
    nextDollarEmployeeMedicare +
    qbiOffset; // (federal/state marginal apply equally to wages vs distributions modulo QBI,
  // so they net out except via QBI)

  if (nextDollarEmployerSSWasted && sCorpSSWages > 0) {
    warnings.push(
      `Day-job W-2 already maxes Social Security; the S-corp's 6.2% employer-side SS on the owner W-2 is non-refundable dead weight ($${formatNumber(ssEmployerWastedAtSCorp)} so far).`,
    );
  }
  if (
    sCorpSSWages + dayJobSSWages > FEDERAL.ssWageBase &&
    ssEmployeeRefundable > 0
  ) {
    warnings.push(
      `You will overpay employee-side Social Security by $${formatNumber(ssEmployeeRefundable)}. Reclaim it on Form 1040 Schedule 3.`,
    );
  }
  if (
    inputs.sCorpW2Salary > 0 &&
    inputs.sCorpW2Salary < 50_000 &&
    inputs.sCorpNetProfit > 200_000
  ) {
    warnings.push(
      `Your S-corp W-2 is low relative to net profit. The IRS expects "reasonable compensation" for the services you perform; underpaying invites reclassification.`,
    );
  }

  const total401k =
    dayJobEmployeeDeferralRaw +
    dayJobEmployerMatch +
    soloEmployeeDeferral +
    soloEmployerContribution;

  return {
    dayJobEmployeeDeferral: dayJobEmployeeDeferralRaw,
    dayJobEmployerMatch,
    soloEmployeeDeferral,
    soloEmployerContribution,
    total401k,
    catchUpAvailable,
    catchUpUsed,

    electiveDeferralLimitEffective,
    electiveDeferralUsed,
    electiveDeferralRemaining,
    dayJob415cRemaining,
    solo415cRemaining,
    solo25PctCap,

    ssTaxableWagesDayJob: dayJobSSWages,
    ssTaxableWagesSCorp: sCorpSSWages,
    ssEmployeeTotal,
    ssEmployeeRefundable,
    ssEmployerDayJob,
    ssEmployerSCorp,
    ssEmployerWastedAtSCorp,
    medicareEmployee,
    medicareEmployer,
    additionalMedicareLiability,

    marginalSCorpW2Cost: {
      employerSS: nextDollarEmployerSS,
      employerMedicare: FEDERAL.medicareRateEmployer,
      employeeMedicareTotal: nextDollarEmployeeMedicare,
      federalMarginalRate: marginalFederalRate,
      stateMarginalRate,
      qbiOffset,
      netCostPerDollar,
    },

    agi,
    taxableIncome,
    qbiDeduction: qbi,
    federalIncomeTax,
    stateIncomeTax,
    localIncomeTax,
    stateSurtax: surtax,
    waMillionairesTaxPreview,
    marginalFederalRate,
    marginalStateRate: stateMarginalRate,

    sCorpEmployerPayrollTax,
    sCorpQbi,
    sCorpDistributions,

    warnings,
  };
}
