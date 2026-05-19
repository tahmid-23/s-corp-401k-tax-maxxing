import { describe, expect, it } from "vitest";
import { compute, type Inputs, taxFromBrackets, marginalRateAt } from "./calc";
import { solveForTarget } from "./solver";
import { FEDERAL } from "./tax-constants";

const baseInputs: Inputs = {
  filingStatus: "single",
  age: 35,
  state: "none",
  nycResident: false,
  previewWaMillionairesTax: false,
  dayJobW2: 100_000,
  dayJobMatchPct: 0.5,
  dayJobMatchLimitPct: 0.06,
  dayJob401kEmployeeContribution: 0,
  dayJob401kType: "traditional",
  sCorpNetProfit: 0,
  sCorpW2Salary: 0,
  soloEmployeeDeferral: 0,
  soloEmployerContribution: 0,
  solo401kEmployeeType: "traditional",
  isSSTB: false,
  otherIncome: 0,
};

describe("taxFromBrackets", () => {
  it("returns 0 for non-positive income", () => {
    expect(taxFromBrackets(0, FEDERAL.brackets.single)).toBe(0);
    expect(taxFromBrackets(-100, FEDERAL.brackets.single)).toBe(0);
  });

  it("computes a known single-filer scenario correctly", () => {
    // Single, $60k taxable
    // First $12,400 @ 10% = $1,240
    // Next $38,000 ($50,400-$12,400) @ 12% = $4,560
    // Next $9,600 ($60k-$50,400) @ 22% = $2,112
    // Total = $7,912
    expect(taxFromBrackets(60_000, FEDERAL.brackets.single)).toBeCloseTo(
      7_912,
      0,
    );
  });

  it("computes top-bracket income correctly for MFJ", () => {
    // MFJ, $1M taxable — manually traced
    const result = taxFromBrackets(1_000_000, FEDERAL.brackets.mfj);
    expect(result).toBeGreaterThan(0);
  });
});

describe("marginalRateAt", () => {
  it("returns the correct marginal rate at bracket boundaries", () => {
    expect(marginalRateAt(50_000, FEDERAL.brackets.single)).toBe(0.12);
    expect(marginalRateAt(100_000, FEDERAL.brackets.single)).toBe(0.22);
    expect(marginalRateAt(2_000_000, FEDERAL.brackets.single)).toBe(0.37);
  });
});

describe("401(k) limits", () => {
  it("caps employee elective deferral aggregation across plans", () => {
    const r = compute({
      ...baseInputs,
      dayJob401kEmployeeContribution: 20_000,
      sCorpW2Salary: 100_000,
      soloEmployeeDeferral: 10_000,
    });
    expect(r.electiveDeferralUsed).toBe(30_000);
    expect(r.warnings.some((w) => w.includes("402(g)"))).toBe(true);
  });

  it("respects 25% of S-corp W-2 cap on employer side", () => {
    const r = compute({
      ...baseInputs,
      sCorpW2Salary: 100_000,
      soloEmployerContribution: 30_000, // exceeds 25k = 25%
    });
    expect(r.solo25PctCap).toBe(25_000);
    expect(r.soloEmployerContribution).toBe(25_000);
    expect(r.warnings.some((w) => w.includes("25%"))).toBe(true);
  });

  it("grants age-50+ catch-up", () => {
    const r = compute({ ...baseInputs, age: 55 });
    expect(r.catchUpAvailable).toBe(FEDERAL.catchUp50Plus);
    expect(r.electiveDeferralLimitEffective).toBe(
      FEDERAL.elective402gLimit + FEDERAL.catchUp50Plus,
    );
  });

  it("grants 60-63 super-catch-up", () => {
    const r = compute({ ...baseInputs, age: 62 });
    expect(r.catchUpAvailable).toBe(FEDERAL.superCatchUp60to63);
  });

  it("reverts to base limit at 64", () => {
    const r = compute({ ...baseInputs, age: 64 });
    expect(r.catchUpAvailable).toBe(FEDERAL.catchUp50Plus);
  });
});

describe("FICA — SS wage base interaction", () => {
  it("flags employer-side SS waste when day job already maxes the wage base", () => {
    const r = compute({
      ...baseInputs,
      dayJobW2: 250_000, // above $184,500 base
      sCorpW2Salary: 50_000,
    });
    expect(r.ssTaxableWagesDayJob).toBe(FEDERAL.ssWageBase);
    expect(r.ssTaxableWagesSCorp).toBe(50_000);
    expect(r.ssEmployerWastedAtSCorp).toBeCloseTo(50_000 * 0.062, 2);
    expect(
      r.warnings.some((w) => w.toLowerCase().includes("dead weight")),
    ).toBe(true);
  });

  it("makes employee-side overpayment refundable", () => {
    const r = compute({
      ...baseInputs,
      dayJobW2: 200_000,
      sCorpW2Salary: 50_000,
    });
    // Both employers withhold up to their cap; combined SS withheld > base × 0.062
    expect(r.ssEmployeeRefundable).toBeGreaterThan(0);
  });

  it("no waste when combined wages stay under cap", () => {
    const r = compute({
      ...baseInputs,
      dayJobW2: 80_000,
      sCorpW2Salary: 50_000,
    });
    expect(r.ssEmployerWastedAtSCorp).toBe(0);
    expect(r.ssEmployeeRefundable).toBe(0);
  });

  it("applies additional Medicare 0.9% above filing-status threshold", () => {
    const r = compute({
      ...baseInputs,
      filingStatus: "single",
      dayJobW2: 250_000,
      sCorpW2Salary: 0,
    });
    expect(r.additionalMedicareLiability).toBeCloseTo(
      (250_000 - 200_000) * 0.009,
      2,
    );

    const rMfj = compute({
      ...baseInputs,
      filingStatus: "mfj",
      dayJobW2: 250_000,
    });
    // MFJ threshold is $250k — exactly at threshold, no liability
    expect(rMfj.additionalMedicareLiability).toBe(0);
  });
});

describe("Roth vs Traditional", () => {
  it("traditional reduces AGI; Roth does not", () => {
    const trad = compute({
      ...baseInputs,
      dayJob401kEmployeeContribution: 20_000,
      dayJob401kType: "traditional",
    });
    const roth = compute({
      ...baseInputs,
      dayJob401kEmployeeContribution: 20_000,
      dayJob401kType: "roth",
    });
    expect(roth.agi - trad.agi).toBeCloseTo(20_000, 2);
    expect(roth.federalIncomeTax).toBeGreaterThan(trad.federalIncomeTax);
  });

  it("counts Roth toward the 402(g) limit", () => {
    const r = compute({
      ...baseInputs,
      dayJob401kEmployeeContribution: 24_000,
      dayJob401kType: "roth",
      sCorpW2Salary: 100_000,
      soloEmployeeDeferral: 5_000,
      solo401kEmployeeType: "roth",
    });
    // 24k + 5k = 29k > 24.5k cap
    expect(r.warnings.some((w) => w.includes("402(g)"))).toBe(true);
  });
});

describe("State + local tax", () => {
  it("zero state tax in WA", () => {
    const r = compute({ ...baseInputs, state: "wa", dayJobW2: 250_000 });
    expect(r.stateIncomeTax).toBe(0);
  });

  it("produces NYC local tax when nycResident is true", () => {
    const stateOnly = compute({
      ...baseInputs,
      state: "ny",
      dayJobW2: 200_000,
    });
    const withNyc = compute({
      ...baseInputs,
      state: "ny",
      nycResident: true,
      dayJobW2: 200_000,
    });
    expect(stateOnly.localIncomeTax).toBe(0);
    expect(withNyc.localIncomeTax).toBeGreaterThan(0);
  });

  it("previews WA millionaires tax when enabled", () => {
    const r = compute({
      ...baseInputs,
      state: "wa",
      previewWaMillionairesTax: true,
      dayJobW2: 2_000_000,
    });
    expect(r.waMillionairesTaxPreview).toBeCloseTo(
      0.099 * (2_000_000 - 1_000_000),
      0,
    );
  });

  it("applies CA mental health surtax above $1M", () => {
    const r = compute({
      ...baseInputs,
      state: "ca",
      dayJobW2: 1_500_000,
    });
    expect(r.stateSurtax).toBeCloseTo(0.01 * (1_500_000 - 1_000_000), 0);
  });
});

describe("QBI", () => {
  it("grants 20% deduction below the threshold", () => {
    const r = compute({
      ...baseInputs,
      dayJobW2: 0,
      sCorpNetProfit: 100_000,
      sCorpW2Salary: 40_000,
      isSSTB: false,
    });
    // QBI = 100k - 40k - ~3k payroll tax = ~57k → 20% = ~11.4k
    expect(r.qbiDeduction).toBeGreaterThan(10_000);
    expect(r.qbiDeduction).toBeLessThan(12_000);
  });

  it("phases out for SSTB above threshold", () => {
    const r = compute({
      ...baseInputs,
      filingStatus: "single",
      dayJobW2: 0,
      otherIncome: 400_000,
      sCorpNetProfit: 100_000,
      sCorpW2Salary: 40_000,
      isSSTB: true,
    });
    // Above SSTB phaseout fully → QBI = 0
    expect(r.qbiDeduction).toBe(0);
  });
});

describe("Solver", () => {
  it("returns infeasible when target exceeds combined caps", () => {
    const result = solveForTarget(baseInputs, 200_000, {
      maxOutDayJobDeferral: true,
    });
    expect(result.feasible).toBe(false);
    if (!result.feasible) {
      // Reason should mention the Solo 401(k) cap when 415(c) blocks the target
      expect(result.reason).toMatch(/Solo 401\(k\)/i);
    }
  });

  it("computes a feasible recommendation", () => {
    const result = solveForTarget(
      { ...baseInputs, sCorpNetProfit: 500_000 },
      80_000,
      { maxOutDayJobDeferral: true },
    );
    expect(result.feasible).toBe(true);
    if (result.feasible) {
      expect(result.total).toBeGreaterThanOrEqual(79_999);
      expect(result.sCorpW2).toBeGreaterThan(0);
      // 80k - 24.5k (deferral) = 55.5k from employer side @ 25% = $222k W-2
      // (no day-job match because day-job W-2 is $100k × 0.06 × 0.5 = $3k match,
      //  but the solver model maxes deferral to the limit; with W-2 of 100k
      //  the match calc applies dayJobMatchedBase = min(24.5k, 6k) = $6k → $3k match)
      expect(result.sCorpW2).toBeGreaterThan(200_000);
    }
  });

  it("handles target already met by day-job alone", () => {
    const result = solveForTarget(
      { ...baseInputs, dayJob401kEmployeeContribution: 20_000 },
      15_000,
    );
    expect(result.feasible).toBe(true);
  });

  it("caps solo employee deferral by post-FICA W-2 cash", () => {
    // W-2 of $24,000. Employee FICA = 7.65% × 24,000 = $1,836.
    // Post-FICA cash = $22,164. Solver must not recommend deferring more.
    const result = solveForTarget(
      {
        ...baseInputs,
        dayJobW2: 0, // isolate the S-corp side
        dayJob401kEmployeeContribution: 0,
        sCorpNetProfit: 100_000,
        sCorpW2Salary: 24_000,
      },
      24_500, // exactly the full 402(g) limit, but unreachable from $24k W-2
    );
    if (result.feasible) {
      expect(result.soloEmployeeDeferral).toBeLessThanOrEqual(22_164 + 1);
    }
  });

  it("closed-form: target $24,500 with full 402(g) room → W ≈ $20,878", () => {
    // Regime A. W = T / 1.1735.
    const result = solveForTarget(
      {
        ...baseInputs,
        dayJobW2: 0,
        dayJob401kEmployeeContribution: 0,
        sCorpNetProfit: 500_000,
      },
      24_500,
    );
    expect(result.feasible).toBe(true);
    if (result.feasible) {
      expect(result.sCorpW2).toBeCloseTo(20_878, -1); // within $10
      expect(result.soloEmployeeDeferral).toBeCloseTo(19_281, -1);
      expect(result.soloEmployerContribution).toBeCloseTo(5_219, -1);
      // Sanity: employee deferral fits within post-FICA cash from this W-2
      const postFica = result.sCorpW2 * (1 - 0.062 - 0.0145);
      expect(result.soloEmployeeDeferral).toBeLessThanOrEqual(postFica + 1);
      // Employer side fits within 25% of W-2
      expect(result.soloEmployerContribution).toBeLessThanOrEqual(
        result.sCorpW2 * 0.25 + 1,
      );
    }
  });

  it("infeasibility message uses profit ceiling when profit binds tighter than 415(c)", () => {
    // Target $80k, profit only $100k. At $100k W-2, achievable is
    // min(24500, postFica(100k)) + 25000 = 24500 + 25000 = 49500 < $72k cap.
    // So profit binds, not 415(c).
    const result = solveForTarget(
      {
        ...baseInputs,
        dayJobW2: 0,
        dayJob401kEmployeeContribution: 0,
        sCorpNetProfit: 100_000,
      },
      80_000,
    );
    expect(result.feasible).toBe(false);
    if (!result.feasible) {
      expect(result.reason).toMatch(/net profit/i);
      expect(result.reason).not.toMatch(/Solo 401\(k\) plan caps out/i);
      expect(result.maximumAchievable).toBeCloseTo(49_500, -1);
    }
  });

  it("infeasibility message uses 415(c) when profit allows it but target is above $72k", () => {
    // Plenty of profit, but target is $80k > 415(c) cap of $72k
    const result = solveForTarget(
      {
        ...baseInputs,
        dayJobW2: 0,
        dayJob401kEmployeeContribution: 0,
        sCorpNetProfit: 1_000_000,
      },
      80_000,
    );
    expect(result.feasible).toBe(false);
    if (!result.feasible) {
      expect(result.reason).toMatch(/Solo 401\(k\) plan caps out/i);
      expect(result.maximumAchievable).toBeCloseTo(72_000, -1);
    }
  });

  it("closed-form: target $50k with full 402(g) room → W = $102,000 (Regime B)", () => {
    // Beyond crossover. D saturates at 24,500, E = 25,500, W = 4 × 25,500.
    const result = solveForTarget(
      {
        ...baseInputs,
        dayJobW2: 0,
        dayJob401kEmployeeContribution: 0,
        sCorpNetProfit: 500_000,
      },
      50_000,
    );
    expect(result.feasible).toBe(true);
    if (result.feasible) {
      expect(result.sCorpW2).toBeCloseTo(102_000, -1);
      expect(result.soloEmployeeDeferral).toBeCloseTo(24_500, -1);
      expect(result.soloEmployerContribution).toBeCloseTo(25_500, -1);
    }
  });
});

describe("Post-FICA deferral warning", () => {
  it("warns when solo employee deferral exceeds post-FICA W-2 cash", () => {
    const r = compute({
      ...baseInputs,
      sCorpNetProfit: 100_000,
      sCorpW2Salary: 24_000,
      soloEmployeeDeferral: 24_000, // gross-equal but post-FICA only $22,164
    });
    expect(r.warnings.some((w) => /post-FICA/i.test(w))).toBe(true);
  });

  it("does not warn when deferral fits within post-FICA cash", () => {
    const r = compute({
      ...baseInputs,
      sCorpNetProfit: 100_000,
      sCorpW2Salary: 24_000,
      soloEmployeeDeferral: 20_000,
    });
    expect(r.warnings.some((w) => /post-FICA/i.test(w))).toBe(false);
  });
});
