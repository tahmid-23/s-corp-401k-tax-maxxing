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
  _options: { maxOutDayJobDeferral?: boolean } = {},
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

  const dayJobMatchCapPct = inputs.dayJobMatchLimitPct;
  const dayJobMatchRate = inputs.dayJobMatchPct;
  const dayJobMatchableComp = inputs.dayJobW2 * dayJobMatchCapPct;

  // Strategy: prefer consolidating at the S-corp Solo 401(k) (gives the most
  // contribution per dollar of W-2 ramp via the 25% employer side). But two
  // exceptions:
  //   1. Day-job employer match is free dollars — always capture it first
  //      by routing match-eligible deferrals to the day job.
  //   2. If the S-corp can't deliver the full target (profit-limited or
  //      415(c)-limited), spill the unmet portion to day-job deferral up to
  //      the per-person 402(g) limit.

  // Step 1: capture day-job match. Defer just enough at the day-job to max
  // the employer match, capped at 402(g) and at the target.
  const dayJobMatchOptimalDeferral = Math.min(
    dayJobMatchableComp,
    effectiveDeferralLimit,
    Math.max(0, target),
  );
  const dayJobMatchAtOptimal =
    dayJobMatchOptimalDeferral * dayJobMatchRate;

  // What remains after the day-job's match-capture contribution + match?
  let dayJobEmployeeDeferral = dayJobMatchOptimalDeferral;
  const dayJobMatch = dayJobMatchAtOptimal;
  let targetAfterDayJob = target - dayJobEmployeeDeferral - dayJobMatch;

  if (targetAfterDayJob <= 0) {
    return {
      feasible: true,
      sCorpW2: inputs.sCorpW2Salary,
      soloEmployeeDeferral: 0,
      soloEmployerContribution: 0,
      dayJobEmployeeDeferral,
      total: dayJobEmployeeDeferral + dayJobMatch,
      note: dayJobMatch > 0
        ? `Defer $${formatNumber(dayJobEmployeeDeferral)} at your day job to capture the full $${formatNumber(dayJobMatch)} match. That already meets the target.`
        : `Defer $${formatNumber(dayJobEmployeeDeferral)} at your day job. That already meets the target.`,
    };
  }

  // Step 2: try the S-corp Solo for the rest.
  let deferralRoom = Math.max(
    0,
    effectiveDeferralLimit - dayJobEmployeeDeferral,
  );

  const profitCeiling = achievableAtW(inputs.sCorpNetProfit, deferralRoom);
  const sub = solveMinSCorpW2({
    target: targetAfterDayJob,
    deferralRoom,
  });

  const soloFeasible = sub.feasible && sub.w2 <= inputs.sCorpNetProfit;

  if (!soloFeasible) {
    // Step 3: spill the unmet portion to extra day-job deferral.
    // The S-corp delivers as much as it can; the rest comes from day-job.
    const soloAchievable = sub.feasible
      ? Math.min(profitCeiling, FEDERAL.annualAdditions415c)
      : sub.maxAchievable;
    // How much of soloAchievable comes from employee deferral (which uses
    // 402(g) room) vs employer profit-sharing (which doesn't)?
    const soloEmployeeDeferralAtCap = Math.min(
      deferralRoom,
      postFicaDeferralCap(Math.min(inputs.sCorpNetProfit, sub.feasible ? sub.w2 : inputs.sCorpNetProfit)),
    );
    const stillNeeded = targetAfterDayJob - soloAchievable;
    // Day-job deferrals beyond the match cap don't earn more match, so
    // spilling here costs nothing extra and just consumes 402(g) room.
    // Available 402(g) room after day-job match capture AND solo employee
    // deferral are both counted.
    const extraDayJobRoom = Math.max(
      0,
      effectiveDeferralLimit -
        dayJobEmployeeDeferral -
        soloEmployeeDeferralAtCap,
    );
    const extraDayJob = Math.min(stillNeeded, extraDayJobRoom);

    if (extraDayJob > 0) {
      dayJobEmployeeDeferral += extraDayJob;
      deferralRoom = Math.max(
        0,
        effectiveDeferralLimit - dayJobEmployeeDeferral,
      );
      targetAfterDayJob -= extraDayJob;
    }

    // Now re-solve the S-corp side with the (possibly reduced) residual.
    const sub2 = solveMinSCorpW2({
      target: targetAfterDayJob,
      deferralRoom,
    });
    const stillInfeasible =
      !sub2.feasible || sub2.w2 > inputs.sCorpNetProfit;

    if (stillInfeasible) {
      // What's the true Solo ceiling? It's the lesser of profit-capped
      // achievable and the 415(c) federal cap.
      const profitCappedSolo = achievableAtW(
        inputs.sCorpNetProfit,
        deferralRoom,
      );
      const reachableSolo = Math.min(
        profitCappedSolo,
        FEDERAL.annualAdditions415c,
      );
      const maximumAchievable =
        dayJobEmployeeDeferral + dayJobMatch + reachableSolo;

      // Profit is the binding wall when it caps the Solo below the federal
      // 415(c) limit.
      const profitBinds = profitCappedSolo < FEDERAL.annualAdditions415c;
      const reason = profitBinds
        ? `Your S-corp's net profit of $${formatNumber(inputs.sCorpNetProfit)} caps how much the Solo 401(k) can deliver at $${formatNumber(profitCappedSolo)}, and you've already maxed what the day-job 401(k) can carry. The business needs more profit to reach this target.`
        : `You've maxed the per-person elective deferral limit and one Solo 401(k) caps at $${formatNumber(FEDERAL.annualAdditions415c)} per year. A second unrelated employer's 401(k) would let you go higher.`;

      return {
        feasible: false,
        reason,
        maximumAchievable,
      };
    }

    // We can reach the target with the day-job spill.
    return {
      feasible: true,
      sCorpW2: sub2.w2,
      soloEmployeeDeferral: sub2.deferral,
      soloEmployerContribution: sub2.employer,
      dayJobEmployeeDeferral,
      total:
        dayJobEmployeeDeferral + dayJobMatch + sub2.deferral + sub2.employer,
      note:
        extraDayJob > 0
          ? `Your S-corp alone can't reach the target. Defer $${formatNumber(dayJobEmployeeDeferral)} at the day job (which earns a $${formatNumber(dayJobMatch)} match) and set S-corp W-2 to $${formatNumber(sub2.w2)} with $${formatNumber(sub2.deferral)} employee + $${formatNumber(sub2.employer)} employer at the Solo 401(k).`
          : `Defer $${formatNumber(dayJobEmployeeDeferral)} at the day job for the match. Set S-corp W-2 to $${formatNumber(sub2.w2)}, with $${formatNumber(sub2.deferral)} employee + $${formatNumber(sub2.employer)} employer at the Solo 401(k).`,
    };
  }

  const dayJobNote =
    dayJobMatch > 0
      ? `Defer $${formatNumber(dayJobEmployeeDeferral)} at your day job to capture the full $${formatNumber(dayJobMatch)} match. `
      : "";
  const sCorpNote =
    sub.w2 <= inputs.sCorpW2Salary
      ? `Your current S-corp W-2 of $${formatNumber(inputs.sCorpW2Salary)} is already enough — contribute $${formatNumber(sub.deferral)} as employee deferral and $${formatNumber(sub.employer)} as employer profit-sharing at the Solo 401(k).`
      : `Set S-corp W-2 to $${formatNumber(sub.w2)}, with $${formatNumber(sub.deferral)} as employee deferral and $${formatNumber(sub.employer)} as employer profit-sharing at the Solo 401(k).`;

  return {
    feasible: true,
    sCorpW2: sub.w2,
    soloEmployeeDeferral: sub.deferral,
    soloEmployerContribution: sub.employer,
    dayJobEmployeeDeferral,
    total: dayJobEmployeeDeferral + dayJobMatch + sub.deferral + sub.employer,
    note: dayJobNote + sCorpNote,
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
