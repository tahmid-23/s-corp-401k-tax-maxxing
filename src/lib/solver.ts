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
 * Maximum Solo 401(k) contribution the S-corp can deliver given net profit,
 * post-FICA deferral cap, 25%-of-W2 employer cap, and 415(c) cap. Returns
 * the optimal W along with the achievable D and E.
 *
 * The two binding constraints on the employer side are:
 *    E ≤ 0.25·W                       (Solo plan rule)
 *    E ≤ profit − W − employerFica(W) (cash available after wages + ER FICA)
 *
 * Below the SS wage base (W ≤ $184,500), employerFica = 0.0765·W, so:
 *    profit-bound: E ≤ profit − 1.0765·W
 * The two bounds cross at W* where 0.25·W = profit − 1.0765·W, i.e.,
 *    W* = profit / 1.3265
 *
 * Below W* the 25% rule binds (E grows with W). Above W*, employer cash
 * shrinks faster than deferral capacity grows, so achievable shrinks.
 * Maximum achievable solo contribution is therefore at W = W*.
 *
 * Above the SS wage base things kink (employer SS plateaus); we handle that
 * case but it's rare for users with small businesses, so the comment here
 * focuses on the common regime.
 */
function maxSoloAtProfit(profit: number, deferralRoom: number): number {
  if (profit <= 0) return 0;
  const C415 = FEDERAL.annualAdditions415c;
  const ssBase = FEDERAL.ssWageBase;
  const erFicaLow = FEDERAL.ssRateEmployer + FEDERAL.medicareRateEmployer; // 0.0765
  const erRate = FEDERAL.employerContribPctOfW2; // 0.25

  // Sweet-spot W if under SS wage base
  const wStarLow = profit / (1 + erFicaLow + erRate); // = profit / 1.3265
  if (wStarLow <= ssBase) {
    const e = erRate * wStarLow;
    const d = Math.min(deferralRoom, postFicaDeferralCap(wStarLow));
    return Math.min(C415, d + e);
  }
  // Sweet-spot above the SS wage base. Employer FICA = 0.0145·W + 11439.
  // E ≤ profit − W − 0.0145·W − 11439 = profit − 1.0145·W − 11439.
  // 0.25·W = profit − 1.0145·W − 11439 → W = (profit − 11439) / 1.2645
  const wStarHigh =
    (profit - FEDERAL.ssRateEmployer * ssBase) /
    (1 + FEDERAL.medicareRateEmployer + erRate);
  const e = erRate * wStarHigh;
  const d = Math.min(deferralRoom, postFicaDeferralCap(wStarHigh));
  return Math.min(C415, d + e);
}

/**
 * Closed-form solver for the minimum S-corp W-2 that delivers a given amount
 * `T` of Solo 401(k) contribution, given remaining 402(g) deferral room `R`,
 * the 415(c) annual-additions cap, and the S-corp's net profit (which caps
 * total cash outflow W + employerFica(W) + E).
 *
 * The unprofit-bounded math has two regimes:
 *
 *   Regime A — W-2-limited deferral.   postFica(W) < R, so D = postFica(W).
 *     Below SS wage base:  G(W) = 1.1735·W    →  W = T / 1.1735
 *     Above SS wage base:  G(W) = 1.2355·W − 11439  →  W = (T + 11439) / 1.2355
 *
 *   Regime B — 402(g)-limited deferral.  postFica(W) ≥ R, so D = R.
 *     G(W) = R + 0.25·W  →  W = 4·(T − R)
 *
 * The regimes meet continuously at W_R = smallest W where postFica(W_R) = R.
 *
 * After picking W by these formulas, we verify the profit constraint
 *     W + employerFica(W) + E ≤ profit
 * If it fails, the target isn't reachable from this S-corp at all (the
 * caller handles the spill/infeasibility logic).
 */
function solveMinSCorpW2(args: {
  target: number;
  deferralRoom: number;
  profit: number;
}):
  | { feasible: true; w2: number; deferral: number; employer: number }
  | { feasible: false; maxAchievable: number } {
  const T = args.target;
  const R = Math.max(0, args.deferralRoom);
  const profit = Math.max(0, args.profit);
  const C415 = FEDERAL.annualAdditions415c;
  const ssBase = FEDERAL.ssWageBase;
  const ssRate = FEDERAL.ssRateEmployee;
  const medRate = FEDERAL.medicareRateEmployee;
  const ficaLow = 1 - ssRate - medRate; // 0.9235
  const ficaHigh = 1 - medRate; // 0.9855
  const ssMaxEmp = ssRate * ssBase; // 11_439 (2026)
  const erRate = FEDERAL.employerContribPctOfW2; // 0.25

  if (T <= 0) return { feasible: true, w2: 0, deferral: 0, employer: 0 };

  const profitMax = maxSoloAtProfit(profit, R);
  const trueMax = Math.min(C415, profitMax);
  if (T > trueMax) {
    return { feasible: false, maxAchievable: trueMax };
  }

  // W_R: smallest W where postFica(W) ≥ R.
  const wR =
    R <= ficaLow * ssBase ? R / ficaLow : (R + ssMaxEmp) / ficaHigh;
  const gR = R + erRate * wR;

  let w: number;
  if (T <= gR) {
    // Regime A
    const wLow = T / (ficaLow + erRate); // T / 1.1735
    w = wLow <= ssBase ? wLow : (T + ssMaxEmp) / (ficaHigh + erRate);
  } else {
    // Regime B
    w = (T - R) / erRate;
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

  const sub = solveMinSCorpW2({
    target: targetAfterDayJob,
    deferralRoom,
    profit: inputs.sCorpNetProfit,
  });

  if (!sub.feasible) {
    // Step 3: spill the unmet portion to extra day-job deferral.
    // The S-corp delivers up to its profit/415(c) ceiling; the rest comes
    // from day-job employee deferral (no match capture beyond what we
    // already did, so this just consumes 402(g) room).
    const soloAchievable = sub.maxAchievable;
    // The solo's max contribution at its sweet-spot W is split between
    // employee deferral (eats 402(g) room) and employer (doesn't).
    // We need to know how much eats 402(g) to know how much room is left
    // for day-job spill.
    const soloAtMax = solveMinSCorpW2({
      target: soloAchievable,
      deferralRoom,
      profit: inputs.sCorpNetProfit,
    });
    const soloDeferralUsed = soloAtMax.feasible ? soloAtMax.deferral : 0;
    const stillNeeded = targetAfterDayJob - soloAchievable;
    const extraDayJobRoom = Math.max(
      0,
      effectiveDeferralLimit - dayJobEmployeeDeferral - soloDeferralUsed,
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

    // Re-solve the S-corp side with the (possibly reduced) residual.
    const sub2 = solveMinSCorpW2({
      target: targetAfterDayJob,
      deferralRoom,
      profit: inputs.sCorpNetProfit,
    });

    if (!sub2.feasible) {
      const reachableSolo = Math.min(
        maxSoloAtProfit(inputs.sCorpNetProfit, deferralRoom),
        FEDERAL.annualAdditions415c,
      );
      const maximumAchievable =
        dayJobEmployeeDeferral + dayJobMatch + reachableSolo;

      const profitBinds = reachableSolo < FEDERAL.annualAdditions415c;
      const reason = profitBinds
        ? `Your S-corp's net profit of $${formatNumber(inputs.sCorpNetProfit)} caps the Solo 401(k) at $${formatNumber(reachableSolo)} (the W-2 you pay, the employer FICA on it, and the 25% employer contribution all come out of profit). You've also maxed what the day-job 401(k) can carry. The business needs more profit to reach this target.`
        : `You've maxed the per-person elective deferral limit and one Solo 401(k) caps at $${formatNumber(FEDERAL.annualAdditions415c)} per year. A second unrelated employer's 401(k) would let you go higher.`;

      return {
        feasible: false,
        reason,
        maximumAchievable,
      };
    }

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
          : `Defer $${formatNumber(dayJobEmployeeDeferral)} at the day job for the match. Set S-corp W-2 to $${formatNumber(sub2.w2)}, with $${formatNumber(sub2.deferral)} as employee deferral and $${formatNumber(sub2.employer)} as employer profit-sharing at the Solo 401(k).`,
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

