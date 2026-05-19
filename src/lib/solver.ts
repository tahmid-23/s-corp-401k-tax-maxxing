import { FEDERAL } from "./tax-constants";
import type { Inputs } from "./calc";
import { formatNumber } from "./format";

/**
 * Post-FICA cash from a given S-corp W-2. The IRS limit on elective deferral
 * is 100% of compensation (gross), but FICA is withheld before the deferral
 * comes out of the paycheck. So the practical ceiling on the deferral is
 *   W minus employee SS (6.2% up to the wage base)
 *     minus employee Medicare (1.45%, no cap).
 *
 * Below the SS wage base:  postFica(W) = 0.9235 · W
 * Above it:                postFica(W) = 0.9855 · W − 0.062 · ssWageBase
 */
function postFicaDeferralCap(w2: number): number {
  if (w2 <= 0) return 0;
  const ssTaxable = Math.min(w2, FEDERAL.ssWageBase);
  const ss = ssTaxable * FEDERAL.ssRateEmployee;
  const medicare = w2 * FEDERAL.medicareRateEmployee;
  return Math.max(0, w2 - ss - medicare);
}

export type Solution =
  | {
      feasible: true;
      sCorpW2: number;
      soloEmployeeDeferral: number;
      soloEmployerContribution: number;
      dayJobEmployeeDeferral: number;
      total: number;
      note: string;
    }
  | {
      feasible: false;
      reason: string;
      maximumAchievable: number;
    };

/**
 * Closed-form solver for the minimum S-corp W-2 that delivers a given amount
 * `T` of Solo 401(k) contribution, given remaining 402(g) deferral room `R`
 * and the 415(c) annual-additions cap.
 *
 * Achievable contribution at W:
 *   G(W) = min(R, postFica(W)) + 0.25·W,  bounded by 415(c).
 *
 * Two regimes:
 *
 *   Regime A — W-2-limited deferral.   postFica(W) < R, so D = postFica(W).
 *     Below SS wage base:  G(W) = 1.1735·W    →  W = T / 1.1735
 *     Above SS wage base:  G(W) = 1.2355·W − 11439  →  W = (T + 11439) / 1.2355
 *
 *   Regime B — 402(g)-limited deferral.  postFica(W) ≥ R, so D = R.
 *     G(W) = R + 0.25·W  →  W = 4·(T − R)
 *
 * The regimes meet continuously at W_R, the smallest wage where
 * postFica(W_R) = R.
 */
function solveMinSCorpW2(args: {
  target: number;
  deferralRoom: number;
}):
  | { feasible: true; w2: number; deferral: number; employer: number }
  | { feasible: false; maxAchievable: number } {
  const T = args.target;
  const R = Math.max(0, args.deferralRoom);
  const C415 = FEDERAL.annualAdditions415c;
  const ssBase = FEDERAL.ssWageBase;
  const ssRate = FEDERAL.ssRateEmployee;
  const medRate = FEDERAL.medicareRateEmployee;
  const ficaLow = 1 - ssRate - medRate; // 0.9235
  const ficaHigh = 1 - medRate; // 0.9855
  const ssMaxEmp = ssRate * ssBase; // 11_439 (2026)
  const erRate = FEDERAL.employerContribPctOfW2; // 0.25

  if (T <= 0) return { feasible: true, w2: 0, deferral: 0, employer: 0 };
  if (T > C415) return { feasible: false, maxAchievable: C415 };

  // W_R: smallest W where postFica(W) ≥ R. Below the wage base the function
  // is 0.9235·W; above it kinks to 0.9855·W − 11439.
  const wR =
    R <= ficaLow * ssBase ? R / ficaLow : (R + ssMaxEmp) / ficaHigh;
  const gR = R + erRate * wR; // achievable D+E at W = W_R

  let w: number;
  if (T <= gR) {
    // Regime A: try the low-wage piece first.
    const wLow = T / (ficaLow + erRate); // T / 1.1735
    w = wLow <= ssBase ? wLow : (T + ssMaxEmp) / (ficaHigh + erRate);
  } else {
    // Regime B: deferral saturates at R, employer side fills the rest.
    w = (T - R) / erRate; // 4 · (T − R)
  }

  const d = Math.min(R, postFicaDeferralCap(w));
  const e = Math.max(0, T - d);

  return { feasible: true, w2: w, deferral: d, employer: e };
}

/**
 * Given inputs, find the minimum S-corp W-2 that hits `target`.
 *
 * Strategy:
 *   1. Take day-job contributions as given (employee deferral chosen by the
 *      user, employer match implied by the match terms).
 *   2. Subtract those from the target to get the residual that must come
 *      from the S-corp Solo 401(k).
 *   3. Solve for the minimum S-corp W-2 that supports that residual, given
 *      remaining 402(g) room, the post-FICA cash cap, the 25% employer rule,
 *      and the per-employer 415(c) cap.
 */
export function solveForTarget(
  inputs: Inputs,
  target: number,
  options: { maxOutDayJobDeferral?: boolean } = {},
): Solution {
  const effectiveDeferralLimit = ((): number => {
    if (inputs.age >= 60 && inputs.age <= 63) {
      return FEDERAL.elective402gLimit + FEDERAL.superCatchUp60to63;
    }
    if (inputs.age >= 50) {
      return FEDERAL.elective402gLimit + FEDERAL.catchUp50Plus;
    }
    return FEDERAL.elective402gLimit;
  })();

  const dayJobMatchCap = inputs.dayJobW2 * inputs.dayJobMatchLimitPct;

  const dayJobEmployeeDeferral = options.maxOutDayJobDeferral
    ? Math.min(effectiveDeferralLimit, FEDERAL.annualAdditions415c)
    : Math.max(0, inputs.dayJob401kEmployeeContribution);

  const dayJobMatchedBase = Math.min(dayJobEmployeeDeferral, dayJobMatchCap);
  const dayJobMatch = dayJobMatchedBase * inputs.dayJobMatchPct;

  const targetAfterDayJob = target - dayJobEmployeeDeferral - dayJobMatch;
  if (targetAfterDayJob <= 0) {
    return {
      feasible: true,
      sCorpW2: inputs.sCorpW2Salary,
      soloEmployeeDeferral: 0,
      soloEmployerContribution: 0,
      dayJobEmployeeDeferral,
      total: dayJobEmployeeDeferral + dayJobMatch,
      note: "Your day-job contributions alone already meet or exceed the target.",
    };
  }

  const deferralRoom = Math.max(
    0,
    effectiveDeferralLimit - dayJobEmployeeDeferral,
  );

  // What's the true ceiling given this user's inputs? It's the lesser of:
  //   - the 415(c) cap ($72k), which is a federal limit
  //   - what their S-corp profit can actually deliver (capped W-2)
  const profitCeiling = achievableAtW(inputs.sCorpNetProfit, deferralRoom);
  const trueCeiling = Math.min(
    FEDERAL.annualAdditions415c,
    profitCeiling,
  );
  const profitBinds = profitCeiling < FEDERAL.annualAdditions415c;

  const sub = solveMinSCorpW2({
    target: targetAfterDayJob,
    deferralRoom,
  });

  // If the solver itself says it's infeasible, the target is above 415(c).
  // If the solver returned a feasible W-2 but it exceeds the user's profit,
  // the profit ceiling is binding even though 415(c) wouldn't be.
  const infeasibleAt415c = !sub.feasible;
  const infeasibleAtProfit = sub.feasible && sub.w2 > inputs.sCorpNetProfit;

  if (infeasibleAt415c || infeasibleAtProfit) {
    const maximumAchievable =
      dayJobEmployeeDeferral + dayJobMatch + trueCeiling;

    // Use the binding-constraint message: profit if that's the lower wall,
    // 415(c) otherwise.
    const reason = profitBinds
      ? `Your S-corp's net profit of $${formatNumber(inputs.sCorpNetProfit)} caps the W-2 you can pay yourself, which in turn caps the Solo 401(k) at $${formatNumber(profitCeiling)}. The business needs more profit to reach this target.`
      : `One Solo 401(k) plan caps out at $${formatNumber(FEDERAL.annualAdditions415c)} in total contributions per year, and your target is above that. You'd need a second unrelated employer's 401(k) to go higher.`;

    return {
      feasible: false,
      reason,
      maximumAchievable,
    };
  }

  return {
    feasible: true,
    sCorpW2: sub.w2,
    soloEmployeeDeferral: sub.deferral,
    soloEmployerContribution: sub.employer,
    dayJobEmployeeDeferral,
    total: dayJobEmployeeDeferral + dayJobMatch + sub.deferral + sub.employer,
    note:
      sub.w2 <= inputs.sCorpW2Salary
        ? `Your current S-corp W-2 of $${formatNumber(inputs.sCorpW2Salary)} is already enough. Contribute $${formatNumber(sub.deferral)} as employee deferral and $${formatNumber(sub.employer)} as employer profit-sharing at the Solo 401(k).`
        : `Set S-corp W-2 to $${formatNumber(sub.w2)}. Contribute $${formatNumber(sub.deferral)} as employee deferral and $${formatNumber(sub.employer)} as employer profit-sharing at the Solo 401(k).`,
  };
}

/** What's the maximum Solo contribution achievable at a given W-2? */
function achievableAtW(w: number, deferralRoom: number): number {
  return Math.min(
    FEDERAL.annualAdditions415c,
    Math.min(deferralRoom, postFicaDeferralCap(w)) +
      FEDERAL.employerContribPctOfW2 * w,
  );
}
