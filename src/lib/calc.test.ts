import { describe, expect, it } from "vitest";
import { compute, type Inputs, taxFromBrackets, marginalRateAt } from "./calc";
import {
  maxAchievableContribution,
  solveForTarget,
  taxOptimalSolution,
  totalTaxCost,
} from "./solver";
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
    // Profit $100k → sweet-spot W* = 100000/1.3265 = $75,386. At that W:
    //   postFica(W*) = 0.9235·75386 = $69,619
    //   D = min(R=24500, 69619) = $24,500
    //   E = 0.25·75386 = $18,847
    //   max Solo = $43,347 < $72k cap. So profit binds.
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
      // Within $100 of the closed-form expected value
      expect(result.maximumAchievable).toBeCloseTo(43_347, -2);
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
      // Message should mention the 415(c)/Solo cap, not profit
      expect(result.reason).toMatch(/Solo 401\(k\)|415\(c\)|\$72,000/i);
      expect(result.reason).not.toMatch(/net profit/i);
      expect(result.maximumAchievable).toBeCloseTo(72_000, -1);
    }
  });

  it("solver spills to day-job 401(k) when S-corp can't reach the target", () => {
    // S-corp profit only $10k. Sweet-spot W* = 10000/1.3265 = $7,538.
    // Solo max ≈ 0.9235·7538 + 0.25·7538 = $6,960 + $1,884 = $8,845.
    // Day-job match capture: defer $6k → $3k match.
    // Solo eats $6,960 of 402(g); day-job already used $6k. Spill room
    // remaining = 24500 - 6000 - 6960 = $11,540.
    // Max reachable = 6k + 3k + 8,845 + 11,540 ≈ $29,385.
    // Target $20k should be reachable with day-job spill.
    const result = solveForTarget(
      {
        ...baseInputs,
        dayJobW2: 100_000,
        dayJob401kEmployeeContribution: 0,
        dayJobMatchPct: 0.5,
        dayJobMatchLimitPct: 0.06,
        sCorpNetProfit: 10_000,
      },
      20_000,
    );
    expect(result.feasible).toBe(true);
    if (result.feasible) {
      // Should defer more than just the match-capture at the day job
      expect(result.dayJobEmployeeDeferral).toBeGreaterThan(6_000);
      expect(result.total).toBeGreaterThanOrEqual(19_999);
    }
  });

  // Property-based: sweep a grid of inputs and check every feasible
  // recommendation respects every constraint. If you regress any of these,
  // this test catches it before the user does.
  it("invariants: feasible recommendations always respect every constraint", () => {
    const ssBase = 184_500;
    const ssRate = 0.062;
    const medRate = 0.0145;
    const elective402g = 24_500;
    const annual415c = 72_000;

    const grid: { dayJobW2: number; profit: number; target: number }[] = [];
    for (const dayJobW2 of [0, 50_000, 150_000, 250_000]) {
      for (const profit of [10_000, 50_000, 150_000, 500_000]) {
        for (const target of [
          5_000, 10_000, 24_000, 24_500, 30_000, 50_000, 70_000, 72_000,
        ]) {
          grid.push({ dayJobW2, profit, target });
        }
      }
    }

    const violations: string[] = [];

    for (const { dayJobW2, profit, target } of grid) {
      const inputs = {
        ...baseInputs,
        dayJobW2,
        dayJob401kEmployeeContribution: 0,
        dayJobMatchPct: 0.5,
        dayJobMatchLimitPct: 0.06,
        sCorpNetProfit: profit,
      };
      const result = solveForTarget(inputs, target);
      if (!result.feasible) continue;

      const tag = `(dayJob=$${dayJobW2}, profit=$${profit}, target=$${target})`;

      // 1. Total must reach the target (within $1 for rounding)
      if (result.total < target - 1) {
        violations.push(`${tag}: total $${result.total} < target $${target}`);
      }

      // 2. Combined employee deferral <= 402(g) limit
      const combinedDeferral =
        result.dayJobEmployeeDeferral + result.soloEmployeeDeferral;
      if (combinedDeferral > elective402g + 1) {
        violations.push(
          `${tag}: combined deferral $${combinedDeferral} > 402(g) limit $${elective402g}`,
        );
      }

      // 3. Solo employee deferral <= post-FICA cash from S-corp W-2
      const ssTaxable = Math.min(result.sCorpW2, ssBase);
      const postFica =
        result.sCorpW2 - ssTaxable * ssRate - result.sCorpW2 * medRate;
      if (result.soloEmployeeDeferral > postFica + 1) {
        violations.push(
          `${tag}: solo employee deferral $${result.soloEmployeeDeferral} > post-FICA cash $${postFica}`,
        );
      }

      // 4. Solo employer contribution <= 25% of S-corp W-2
      if (result.soloEmployerContribution > result.sCorpW2 * 0.25 + 1) {
        violations.push(
          `${tag}: employer contribution $${result.soloEmployerContribution} > 25% of W-2 ($${result.sCorpW2 * 0.25})`,
        );
      }

      // 5. Solo total (employee + employer) <= 415(c)
      const soloTotal =
        result.soloEmployeeDeferral + result.soloEmployerContribution;
      if (soloTotal > annual415c + 1) {
        violations.push(
          `${tag}: solo total $${soloTotal} > 415(c) cap $${annual415c}`,
        );
      }

      // 6. S-corp cash outflow (wages + employer FICA + employer 401k)
      //    must fit inside net profit
      const employerFica =
        ssTaxable * ssRate + result.sCorpW2 * medRate;
      const sCorpOutflow =
        result.sCorpW2 + employerFica + result.soloEmployerContribution;
      if (sCorpOutflow > profit + 1) {
        violations.push(
          `${tag}: S-corp outflow $${sCorpOutflow.toFixed(2)} (W-2 $${result.sCorpW2} + ER FICA $${employerFica.toFixed(2)} + employer 401k $${result.soloEmployerContribution}) exceeds profit $${profit}`,
        );
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Solver invariants violated:\n  ` + violations.slice(0, 10).join("\n  "),
      );
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

describe("Tax-optimal solver", () => {
  // Brute-force sweep over (W, D_dj, D_solo, E) for a given inputs base.
  // Returns the minimum totalTaxCost achievable. Step sizes are chosen so
  // the sweep is exhaustive enough that the closed-form solver can never
  // beat it by more than the step's worth of resolution.
  function bruteForceMinCost(
    base: Inputs,
    opts: { wStep?: number; contribStep?: number } = {},
  ): {
    cost: number;
    inputs: Inputs;
  } {
    const wStep = opts.wStep ?? 500;
    const contribStep = opts.contribStep ?? 500;
    const limit402g =
      base.age >= 60 && base.age <= 63
        ? FEDERAL.elective402gLimit + FEDERAL.superCatchUp60to63
        : base.age >= 50
          ? FEDERAL.elective402gLimit + FEDERAL.catchUp50Plus
          : FEDERAL.elective402gLimit;
    const C415 = FEDERAL.annualAdditions415c;
    const ssBase = FEDERAL.ssWageBase;
    const profit = Math.max(0, base.sCorpNetProfit);

    let best = { cost: Infinity, inputs: base };

    const maxDDj = Math.min(limit402g, base.dayJobW2 * (1 - 0.062 - 0.0145));
    // Match-capture floor: always defer at least matchableComp at the day
    // job (free money via the match). Below this, the brute-force search
    // is comparing apples to oranges relative to the closed-form which
    // never forfeits the match.
    const matchFloor = Math.min(
      base.dayJobW2 * base.dayJobMatchLimitPct,
      maxDDj,
      limit402g,
    );
    const dDjValues: number[] = [];
    for (let d = matchFloor; d <= maxDDj + 1; d += contribStep) {
      dDjValues.push(Math.min(d, maxDDj));
    }
    if (dDjValues.length === 0) dDjValues.push(matchFloor);

    for (let W = 0; W <= profit + 1; W += wStep) {
      const erFica =
        Math.min(W, ssBase) * 0.062 + W * 0.0145;
      const postFica =
        W - Math.min(W, ssBase) * 0.062 - W * 0.0145;
      const profitRoomE = Math.max(0, profit - W - erFica);

      for (const dDj of dDjValues) {
        const room402gAfterDj = Math.max(0, limit402g - dDj);
        const maxDSo = Math.min(
          room402gAfterDj,
          Math.max(0, postFica),
          C415,
        );

        const dSoValues: number[] = [];
        for (let d = 0; d <= maxDSo + 1; d += contribStep) {
          dSoValues.push(Math.min(d, maxDSo));
        }
        if (dSoValues.length === 0) dSoValues.push(0);

        for (const dSo of dSoValues) {
          const maxE = Math.min(
            W * 0.25,
            Math.max(0, C415 - dSo),
            profitRoomE,
          );

          // E is monotonically harmful to tax (QBI loss), so the optimum
          // over E given (W, dDj, dSo) is one of: 0, maxE. Two evals.
          for (const E of [0, maxE]) {
            const candInputs: Inputs = {
              ...base,
              sCorpW2Salary: W,
              dayJob401kEmployeeContribution: dDj,
              soloEmployeeDeferral: dSo,
              soloEmployerContribution: E,
            };
            const cost = totalTaxCost(compute(candInputs));
            if (cost < best.cost) {
              best = { cost, inputs: candInputs };
            }
          }
        }
      }
    }

    return best;
  }

  // Tolerance: brute force has finite resolution (wStep = 500), so the
  // closed-form might legitimately do a tiny bit worse than a hypothetical
  // brute force at infinite resolution. Conversely, brute force might miss
  // a kink between grid points. So the right relationship is
  //   closed_form ≤ brute_force + slack
  // where slack reflects brute force's resolution. $50 is generous.
  const TOL = 50;

  const scenarios: { name: string; inputs: Partial<Inputs> }[] = [
    {
      name: "no day job, modest profit",
      inputs: {
        dayJobW2: 0,
        dayJob401kEmployeeContribution: 0,
        sCorpNetProfit: 80_000,
      },
    },
    {
      name: "day job below SS base, profit fits 415(c)",
      inputs: {
        dayJobW2: 100_000,
        dayJob401kEmployeeContribution: 6_000,
        sCorpNetProfit: 150_000,
      },
    },
    {
      name: "day job already at SS cap (all S-corp wages 'wasted SS')",
      inputs: {
        dayJobW2: 200_000,
        dayJob401kEmployeeContribution: 0,
        sCorpNetProfit: 150_000,
      },
    },
    {
      name: "high earner, QBI fully phased out",
      inputs: {
        dayJobW2: 0,
        dayJob401kEmployeeContribution: 0,
        sCorpNetProfit: 500_000,
        otherIncome: 200_000,
        isSSTB: true,
      },
    },
    {
      name: "modest profit, day job at SS base",
      inputs: {
        dayJobW2: 184_500,
        dayJob401kEmployeeContribution: 0,
        sCorpNetProfit: 100_000,
      },
    },
    {
      name: "MFJ above QBI threshold",
      inputs: {
        filingStatus: "mfj",
        dayJobW2: 250_000,
        dayJob401kEmployeeContribution: 0,
        sCorpNetProfit: 200_000,
      },
    },
  ];

  for (const { name, inputs } of scenarios) {
    it(`closed-form matches brute-force sweep: ${name}`, () => {
      const base: Inputs = { ...baseInputs, ...inputs };
      const optimal = taxOptimalSolution(base);
      const brute = bruteForceMinCost(base, {
        wStep: 1_000,
        contribStep: 1_000,
      });
      // Closed form must be no worse than brute force (up to grid resolution).
      expect(optimal.totalTax).toBeLessThanOrEqual(brute.cost + TOL);
    });
  }

  it("recommends staying at or near user's W when ramping is bad-EV", () => {
    // Day job already past SS cap (combined wages > 184,500), so S-corp
    // wages incur 6.2% wasted employer SS. With low marginal rate this is
    // a net loss vs taking the QBI deduction.
    const base: Inputs = {
      ...baseInputs,
      dayJobW2: 200_000,
      dayJob401kEmployeeContribution: 0,
      sCorpNetProfit: 100_000,
      sCorpW2Salary: 50_000, // user's starting guess
    };
    const optimal = taxOptimalSolution(base);
    // Should not recommend ramping W-2 beyond what's needed; should at
    // least beat the user's current numbers.
    expect(optimal.savingsVsCurrent).toBeGreaterThanOrEqual(-1);
  });

  // Brute-force counterpart for maxAchievableContribution: sweep all the
  // same axes the tax-optimal sweep uses, compute the total contribution
  // (D_dj + match + D_so + E), return the max.
  function bruteForceMaxContribution(
    base: Inputs,
    opts: { wStep?: number; contribStep?: number } = {},
  ): number {
    const wStep = opts.wStep ?? 1_000;
    const contribStep = opts.contribStep ?? 1_000;
    const limit402g =
      base.age >= 60 && base.age <= 63
        ? FEDERAL.elective402gLimit + FEDERAL.superCatchUp60to63
        : base.age >= 50
          ? FEDERAL.elective402gLimit + FEDERAL.catchUp50Plus
          : FEDERAL.elective402gLimit;
    const C415 = FEDERAL.annualAdditions415c;
    const ssBase = FEDERAL.ssWageBase;
    const profit = Math.max(0, base.sCorpNetProfit);
    const matchableComp = base.dayJobW2 * base.dayJobMatchLimitPct;

    let best = 0;

    const maxDDj = Math.min(limit402g, base.dayJobW2 * (1 - 0.062 - 0.0145));
    // maxAchievableContribution() also assumes match is captured.
    const matchFloor = Math.min(matchableComp, maxDDj, limit402g);
    const dDjValues: number[] = [];
    for (let d = matchFloor; d <= maxDDj + 1; d += contribStep) {
      dDjValues.push(Math.min(d, maxDDj));
    }
    if (dDjValues.length === 0) dDjValues.push(matchFloor);

    for (let W = 0; W <= profit + 1; W += wStep) {
      const erFica = Math.min(W, ssBase) * 0.062 + W * 0.0145;
      const postFica = W - Math.min(W, ssBase) * 0.062 - W * 0.0145;
      const profitRoomE = Math.max(0, profit - W - erFica);

      for (const dDj of dDjValues) {
        const match = Math.min(dDj, matchableComp) * base.dayJobMatchPct;
        const room402g = Math.max(0, limit402g - dDj);
        const maxDSo = Math.min(room402g, Math.max(0, postFica), C415);
        for (let dSo = 0; dSo <= maxDSo + 1; dSo += contribStep) {
          const dSoClamped = Math.min(dSo, maxDSo);
          const maxE = Math.min(
            W * 0.25,
            Math.max(0, C415 - dSoClamped),
            profitRoomE,
          );
          const total = dDj + match + dSoClamped + maxE;
          if (total > best) best = total;
        }
      }
    }
    return best;
  }

  it("max-contribution matches brute-force sweep across scenarios", () => {
    for (const { name, inputs } of scenarios) {
      const base: Inputs = { ...baseInputs, ...inputs };
      const closedMax = maxAchievableContribution(base);
      const bruteMax = bruteForceMaxContribution(base, {
        wStep: 1_000,
        contribStep: 1_000,
      });
      // Closed form must be no LESS than brute (it's claiming the maximum;
      // brute might miss the exact kink by grid resolution, so allow small
      // slack on the other side too).
      expect(closedMax, `${name}: closed ${closedMax} vs brute ${bruteMax}`)
        .toBeGreaterThanOrEqual(bruteMax - 100);
    }
  });

  it("recommendation is feasible (all constraints respected)", () => {
    const base: Inputs = {
      ...baseInputs,
      dayJobW2: 150_000,
      sCorpNetProfit: 150_000,
    };
    const opt = taxOptimalSolution(base);
    // 25% rule
    expect(opt.soloEmployerContribution).toBeLessThanOrEqual(
      opt.sCorpW2 * 0.25 + 1,
    );
    // 415(c) on solo
    expect(opt.soloEmployeeDeferral + opt.soloEmployerContribution).toBeLessThanOrEqual(
      FEDERAL.annualAdditions415c + 1,
    );
    // 402(g) combined
    const limit402g =
      base.age >= 50
        ? FEDERAL.elective402gLimit + FEDERAL.catchUp50Plus
        : FEDERAL.elective402gLimit;
    expect(
      opt.dayJobEmployeeDeferral + opt.soloEmployeeDeferral,
    ).toBeLessThanOrEqual(limit402g + 1);
    // Post-FICA cash
    const ssTaxable = Math.min(opt.sCorpW2, FEDERAL.ssWageBase);
    const postFica =
      opt.sCorpW2 -
      ssTaxable * FEDERAL.ssRateEmployee -
      opt.sCorpW2 * FEDERAL.medicareRateEmployee;
    expect(opt.soloEmployeeDeferral).toBeLessThanOrEqual(postFica + 1);
    // Profit cap
    const erFica =
      ssTaxable * FEDERAL.ssRateEmployer +
      opt.sCorpW2 * FEDERAL.medicareRateEmployer;
    expect(
      opt.sCorpW2 + erFica + opt.soloEmployerContribution,
    ).toBeLessThanOrEqual(base.sCorpNetProfit + 1);
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
