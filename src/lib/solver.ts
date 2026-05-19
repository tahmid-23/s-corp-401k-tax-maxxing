import { FEDERAL } from "./tax-constants";
import type { Inputs } from "./calc";
import { formatNumber } from "./format";

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
 * Given inputs, find the minimum S-corp W-2 that hits `target401kTotal`.
 *
 * Strategy: max out the day-job employee deferral first (to capture match),
 * spill the remaining elective deferral room into the solo 401(k), then
 * compute the S-corp W-2 needed for the residual to come from employer
 * profit-sharing at 25% of W-2 (subject to 415(c)).
 *
 * Day-job employee deferral is taken from the input (the user already chose it
 * in the form) unless that choice violates limits.
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

  // Remaining elective deferral room goes to solo 401(k) employee deferral.
  const soloEmployeeDeferralCapacity = Math.max(
    0,
    Math.min(
      effectiveDeferralLimit - dayJobEmployeeDeferral,
      FEDERAL.annualAdditions415c, // solo's own 415(c)
    ),
  );

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

  // Allocate as much as possible to solo employee deferral (no W-2 cost)
  const soloEmployeeDeferral = Math.min(
    targetAfterDayJob,
    soloEmployeeDeferralCapacity,
  );
  const remaining = targetAfterDayJob - soloEmployeeDeferral;

  if (remaining <= 0) {
    return {
      feasible: true,
      sCorpW2: inputs.sCorpW2Salary, // unchanged; W-2 not needed
      soloEmployeeDeferral,
      soloEmployerContribution: 0,
      dayJobEmployeeDeferral,
      total: dayJobEmployeeDeferral + dayJobMatch + soloEmployeeDeferral,
      note: "No S-corp W-2 increase needed. Additional employee deferrals at the Solo 401(k) cover the target.",
    };
  }

  // Remaining must come from solo employer side: ≤ 25% × W-2 AND
  // ≤ 415(c) − soloEmployeeDeferral.
  const employer415cRoom = FEDERAL.annualAdditions415c - soloEmployeeDeferral;
  if (remaining > employer415cRoom) {
    return {
      feasible: false,
      reason: `One Solo 401(k) plan caps out at $${formatNumber(FEDERAL.annualAdditions415c)} in total contributions per year, and your target is above that. You'd need a second unrelated employer's 401(k) to go higher.`,
      maximumAchievable:
        dayJobEmployeeDeferral +
        dayJobMatch +
        soloEmployeeDeferral +
        employer415cRoom,
    };
  }

  const requiredSCorpW2 = remaining / FEDERAL.employerContribPctOfW2;

  // Sanity: if the user's S-corp net profit cannot support that W-2, flag it.
  if (requiredSCorpW2 > inputs.sCorpNetProfit) {
    return {
      feasible: false,
      reason: `Your S-corp would need to pay you $${formatNumber(requiredSCorpW2)} in W-2 wages to hit this target, but it only earns $${formatNumber(inputs.sCorpNetProfit)} in net profit. The business isn't earning enough to support this contribution level.`,
      maximumAchievable:
        dayJobEmployeeDeferral +
        dayJobMatch +
        soloEmployeeDeferral +
        inputs.sCorpNetProfit * FEDERAL.employerContribPctOfW2,
    };
  }

  return {
    feasible: true,
    sCorpW2: requiredSCorpW2,
    soloEmployeeDeferral,
    soloEmployerContribution: remaining,
    dayJobEmployeeDeferral,
    total:
      dayJobEmployeeDeferral + dayJobMatch + soloEmployeeDeferral + remaining,
    note: `Set S-corp W-2 to $${formatNumber(requiredSCorpW2)}. Contribute $${formatNumber(soloEmployeeDeferral)} as employee deferral and $${formatNumber(remaining)} as employer profit-sharing at the Solo 401(k).`,
  };
}
