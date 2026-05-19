import { FEDERAL } from "./tax-constants";
import { compute, type Inputs, type Output } from "./calc";
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
/**
 * The maximum total 401(k) contribution achievable given the user's inputs,
 * combining day-job + Solo and respecting every constraint. Used to show
 * the user their ceiling without making them play with the solver.
 */
export function maxAchievableContribution(inputs: Inputs): number {
  const effectiveDeferralLimit =
    inputs.age >= 60 && inputs.age <= 63
      ? FEDERAL.elective402gLimit + FEDERAL.superCatchUp60to63
      : inputs.age >= 50
        ? FEDERAL.elective402gLimit + FEDERAL.catchUp50Plus
        : FEDERAL.elective402gLimit;

  // Day-job: match capture is the only mandatory contribution. Past that,
  // extra deferrals are pure 402(g) consumption with no match earned (the
  // match has already been captured at the matchable-comp cap).
  const matchableComp = inputs.dayJobW2 * inputs.dayJobMatchLimitPct;
  const dayJobMatchCapture = Math.min(matchableComp, effectiveDeferralLimit);
  const matchEarned = dayJobMatchCapture * inputs.dayJobMatchPct;

  // Max Solo at profit, given 402(g) room left after match capture
  const roomAfterMatch = effectiveDeferralLimit - dayJobMatchCapture;
  const soloMax = maxSoloAtProfit(inputs.sCorpNetProfit, roomAfterMatch);

  // How much of soloMax is employee deferral? That uses 402(g) room.
  // We can compute it by inverting: D = min(R, postFica(W*)) at W*.
  const ssBase = FEDERAL.ssWageBase;
  const erFicaLow = FEDERAL.ssRateEmployer + FEDERAL.medicareRateEmployer;
  const erRate = FEDERAL.employerContribPctOfW2;
  const wStar = Math.min(
    inputs.sCorpNetProfit / (1 + erFicaLow + erRate),
    ssBase,
  );
  const soloDeferral = Math.min(roomAfterMatch, postFicaDeferralCap(wStar));

  // After the Solo eats its share of 402(g), how much can spill into the
  // day-job? (No additional match — already maxed.)
  const remainingDeferralRoom = Math.max(
    0,
    effectiveDeferralLimit - dayJobMatchCapture - soloDeferral,
  );

  return dayJobMatchCapture + matchEarned + soloMax + remainingDeferralRoom;
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Tax-optimal solver (target-driven)
//
// Given a desired total 401(k) contribution T, finds (W, D_dj, D_so, E) that
// hits T exactly with minimum total tax. The user picks T (how much retirement
// savings they want); the calculator picks the cheapest path to deliver it.
//
// Objective: minimize total non-recoverable cost this year
//    federal + state + local + state surtax
//      + employer FICA paid by S-corp (both halves)
//      + employer FICA paid by day-job employer (constant, but included for total)
//      + employee Medicare (always non-recoverable)
//      + employee additional Medicare
//      + employee SS net of refundable excess
//
// Outer optimization (over W): enumerate the kink set:
//     - W = 0
//     - W = max(0, ssWageBase − dayJobSSWages)  (S-corp first crosses
//       combined SS cap; below this, no employer-SS waste at the S-corp)
//     - W = ssWageBase  (S-corp's own SS cap; employer SS on S-corp wages
//       plateaus, postFica slope changes)
//     - W = profit / 1.3265  (low-side sweet spot for E)
//     - W = (profit − ssMaxEmp) / 1.2645  (high-side sweet spot)
//     - W = profit  (no distribution at all)
//     - W such that postFica(W) = 402(g) room  (regime A↔B for D_so)
//     - W at QBI income threshold and phaseout end
//     - federal bracket boundaries (cost surface kinks at TI = bracket)
//     - the user's current sCorpW2Salary
//     - a 50-point grid across [0, profit] as belt-and-suspenders
//
// Inner sub-optimization (given W and target T): fill the target exactly.
// Pretax employee deferrals save current-year tax with no FICA cost (the
// wage already paid FICA when generated). E doesn't save tax (just adds to
// the 401(k)), so we route as many target dollars as possible through D's
// before falling back to E. Two D channels:
//   - D_dj at the day job: comes from day-job W-2 cash, costs nothing
//     beyond what's already paid (FICA on dayJobW2 is sunk).
//   - D_so at the Solo: comes from S-corp W-2 cash. To "fund" D_so at the
//     margin requires more W, which costs S-corp FICA.
// So D_dj > D_so > E in tax-efficiency order. We always fill in that order.
//
// Hard constraints respected: 402(g) per-person, 415(c) per-employer, 25%
// rule on E, post-FICA cash on D_so, day-job 415(c)/cash on D_dj, S-corp
// cash flow W + er-FICA + E ≤ profit. Match floor: D_dj always ≥
// matchableComp so the free employer match is captured.
// ─────────────────────────────────────────────────────────────────────────────

function effectiveDeferralLimitForAge(age: number): number {
  if (age >= 60 && age <= 63) {
    return FEDERAL.elective402gLimit + FEDERAL.superCatchUp60to63;
  }
  if (age >= 50) {
    return FEDERAL.elective402gLimit + FEDERAL.catchUp50Plus;
  }
  return FEDERAL.elective402gLimit;
}

function employerFica(w: number): number {
  if (w <= 0) return 0;
  const ss = Math.min(w, FEDERAL.ssWageBase) * FEDERAL.ssRateEmployer;
  const med = w * FEDERAL.medicareRateEmployer;
  return ss + med;
}

/**
 * Total non-recoverable cost from a compute() output. The objective for
 * tax-optimization.
 *
 *   Federal + state + local + state surtax    (income taxes)
 *   + employer FICA both halves (day-job + S-corp)  (employer-paid, sunk)
 *   + employee Medicare (always non-refundable)
 *   + employee additional Medicare 0.9%
 *   + employee SS net of any refundable excess
 *
 * The employee-side SS shows up two ways depending on cap interaction; the
 * compute() output exposes both ssEmployeeTotal and ssEmployeeRefundable so
 * we can take the difference cleanly.
 */
export function totalTaxCost(out: Output): number {
  const employeeSSNet = Math.max(
    0,
    out.ssEmployeeTotal - out.ssEmployeeRefundable,
  );
  return (
    out.federalIncomeTax +
    out.stateIncomeTax +
    out.localIncomeTax +
    out.stateSurtax +
    out.ssEmployerDayJob +
    out.ssEmployerSCorp +
    out.medicareEmployer +
    out.medicareEmployee +
    out.additionalMedicareLiability +
    employeeSSNet
  );
}

/**
 * Given a target total 401(k) contribution T and a fixed S-corp W-2 W,
 * find the (D_dj, D_so, E) split that hits T exactly using the cheapest
 * channels first. Returns null if T is unreachable at this W under the
 * relevant caps.
 *
 * Fill order: D_dj first (no FICA cost — wage already paid FICA), then
 * D_so, then E. Match floor on D_dj.
 */
function buildInputsForTargetAtW(
  base: Inputs,
  W: number,
  target: number,
): Inputs | null {
  const limit402g = effectiveDeferralLimitForAge(base.age);
  const C415 = FEDERAL.annualAdditions415c;

  // Day-job match arithmetic.
  const dayJobMatchableComp = base.dayJobW2 * base.dayJobMatchLimitPct;

  // Post-FICA cash from each W-2 (employee can't defer more than what
  // arrives in the paycheck).
  const dayJobPostFica =
    base.dayJobW2 -
    Math.min(base.dayJobW2, FEDERAL.ssWageBase) * FEDERAL.ssRateEmployee -
    base.dayJobW2 * FEDERAL.medicareRateEmployee;
  const sCorpPostFica = postFicaDeferralCap(W);

  // S-corp profit constraint: W + employerFica(W) + E ≤ profit.
  const erFica = employerFica(W);
  const profitRoomForE = Math.max(0, base.sCorpNetProfit - W - erFica);

  // Day-job cap on D_dj: 402(g), day-job 415(c) net of match (we add match
  // below, so the cap is approximated as the deferral itself ≤ 415(c)),
  // and day-job post-FICA cash.
  const dDjCap = Math.min(
    limit402g,
    Math.max(0, dayJobPostFica),
    // Conservatively use 415(c) minus the projected match. The match itself
    // depends on D_dj only up to matchableComp, so this is a safe ceiling.
    Math.max(0, C415 - dayJobMatchableComp * base.dayJobMatchPct),
  );

  const eCap = Math.min(
    W * FEDERAL.employerContribPctOfW2,
    C415,
    profitRoomForE,
  );

  // Match-capture floor on D_dj (free money).
  const dDjFloor = Math.min(dayJobMatchableComp, dDjCap);
  const matchAtFloor = dDjFloor * base.dayJobMatchPct;

  // Hitting target with D_dj alone (sub-match-floor): only viable if T is
  // small enough.
  // Total at D_dj ∈ [0, matchableComp]:  D_dj × (1 + matchRate)
  // Total at D_dj ∈ (matchableComp, dDjCap]:  D_dj + matchableComp × matchRate
  const matchAtDDjCap = matchAtFloor; // doesn't grow past matchableComp
  const totalAtDDjCap = Math.min(dDjCap, limit402g) + matchAtDDjCap;

  if (target <= dDjFloor + matchAtFloor + 0.5) {
    // D_dj ≤ matchableComp suffices. Solve: T = D_dj × (1 + matchRate)
    const dDj = target / (1 + base.dayJobMatchPct);
    return {
      ...base,
      sCorpW2Salary: W,
      dayJob401kEmployeeContribution: dDj,
      soloEmployeeDeferral: 0,
      soloEmployerContribution: 0,
    };
  }

  if (target <= totalAtDDjCap + 0.5) {
    // D_dj > matchableComp but ≤ dDjCap suffices. Match is capped at
    // matchableComp × matchRate. D_dj = T − match.
    const dDj = Math.min(
      Math.max(0, target - matchAtFloor),
      Math.min(dDjCap, limit402g),
    );
    return {
      ...base,
      sCorpW2Salary: W,
      dayJob401kEmployeeContribution: dDj,
      soloEmployeeDeferral: 0,
      soloEmployerContribution: 0,
    };
  }

  // Target requires Solo participation. Set D_dj to its cap (maximizes
  // pretax deferral and uses 402(g) — extra D_dj past matchableComp earns
  // no match but reduces the W needed to fund D_so. This is the
  // tax-cheapest allocation: at fixed W, every $1 of D is a deferral; the
  // marginal cost difference is in W, which scales with D_so demand.)
  const dDj = Math.min(dDjCap, limit402g);
  const match = Math.min(dDj, dayJobMatchableComp) * base.dayJobMatchPct;
  let residual = target - dDj - match;

  // At this D_dj, 402(g) room left = limit402g - dDj.
  const room402gSo = Math.max(0, limit402g - dDj);
  const dSoCap = Math.min(sCorpPostFica, room402gSo, C415);

  // Fill E first (no 402(g) consumption), then D_so.
  const E = Math.max(0, Math.min(eCap, residual));
  residual -= E;
  const dSo = Math.max(0, Math.min(dSoCap, Math.max(0, C415 - E), residual));
  residual -= dSo;

  // If still residual: target unreachable at this W. Shifting dDj→dSo
  // doesn't increase total contribution (both eat 402(g)), so it doesn't
  // help. Return null and let the outer loop try a larger W.
  if (residual > 0.5) {
    return null;
  }

  return {
    ...base,
    sCorpW2Salary: W,
    dayJob401kEmployeeContribution: dDj,
    soloEmployeeDeferral: dSo,
    soloEmployerContribution: E,
  };
}

/** All W-level kink points worth evaluating. Clipped to [0, profit]. */
function kinkSetForW(base: Inputs): number[] {
  const ssBase = FEDERAL.ssWageBase;
  const ssMaxEmp = ssBase * FEDERAL.ssRateEmployee;
  const erRate = FEDERAL.employerContribPctOfW2;
  const profit = Math.max(0, base.sCorpNetProfit);
  const dayJobSSWages = Math.min(base.dayJobW2, ssBase);
  const limit402g = effectiveDeferralLimitForAge(base.age);

  // postFica(W) = R kink for D_solo regime A↔B.
  const ficaLow = 1 - FEDERAL.ssRateEmployee - FEDERAL.medicareRateEmployee;
  const ficaHigh = 1 - FEDERAL.medicareRateEmployee;
  const wR =
    limit402g <= ficaLow * ssBase
      ? limit402g / ficaLow
      : (limit402g + ssMaxEmp) / ficaHigh;

  // Sweet-spot W (max-E point).
  const wStarLow = profit / (1 + FEDERAL.ssRateEmployer + FEDERAL.medicareRateEmployer + erRate);
  const wStarHigh =
    (profit - ssMaxEmp) /
    (1 + FEDERAL.medicareRateEmployer + erRate);

  // Federal bracket boundaries — convert each to an approximate W. The
  // dependency runs through taxable income; we'd need to invert which is
  // hairy. Instead, we add the bracket boundaries themselves as Ws — for
  // most reasonable inputs the bracket boundary in $ is in the same order
  // of magnitude as W, and even if it's a loose proxy, missing one of
  // these doesn't change the answer much (the cost surface is smooth
  // between bracket kinks). The brute-force-sweep test catches any
  // pathological miss.
  const bracketBoundaries = FEDERAL.brackets[base.filingStatus]
    .map((b) => b.upTo)
    .filter((b) => Number.isFinite(b)) as number[];

  // QBI kink Ws — at TI-before-QBI = threshold and = threshold + phaseout.
  // TI = AGI - stdDed. AGI = dayJobW2 - tradDeferralDayJob + W + dist + other.
  // dist = profit - W - employerFica(W) - E. With E variable, this is hairy.
  // Use the threshold itself as a proxy — same rationale as brackets.
  const qbiTh = FEDERAL.qbi.incomeThreshold[base.filingStatus];
  const qbiPhase = FEDERAL.qbi.phaseoutRange[base.filingStatus];

  // Some extra granular candidates to defend against the bracket / QBI
  // approximation above. 200 evenly-spaced points across [0, profit] keeps
  // step ≤ ~$500 for typical profits, denser than any reasonable brute-
  // force grid.
  const grid: number[] = [];
  const N = 200;
  for (let i = 0; i <= N; i++) grid.push((i / N) * profit);

  const candidates = [
    0,
    base.sCorpW2Salary,
    Math.max(0, ssBase - dayJobSSWages),
    ssBase,
    wStarLow,
    wStarHigh,
    wR,
    profit,
    qbiTh,
    qbiTh + qbiPhase,
    ...bracketBoundaries,
    ...grid,
  ];

  // Clip and dedupe.
  const clipped = candidates
    .filter((w) => Number.isFinite(w))
    .map((w) => Math.max(0, Math.min(profit, w)));
  return Array.from(new Set(clipped.map((w) => Math.round(w * 100) / 100)));
}

export type TaxOptimalSolution =
  | {
      feasible: true;
      sCorpW2: number;
      dayJobEmployeeDeferral: number;
      soloEmployeeDeferral: number;
      soloEmployerContribution: number;
      totalContribution: number;
      totalTax: number;
      /**
       * Total tax under the user's currently-entered inputs, for comparison.
       */
      baselineTax: number;
      /**
       * baselineTax − totalTax. Positive = recommendation saves money.
       */
      savingsVsCurrent: number;
      note: string;
    }
  | {
      feasible: false;
      reason: string;
      maximumAchievable: number;
    };

/**
 * Find the (W, D_dj, D_so, E) that delivers exactly `target` of total 401(k)
 * contribution with the minimum total tax. Returns infeasibility when the
 * target exceeds the absolute ceiling.
 */
export function taxOptimalForTarget(
  base: Inputs,
  target: number,
): TaxOptimalSolution {
  const ceiling = maxAchievableContribution(base);
  if (target > ceiling + 0.5) {
    return {
      feasible: false,
      reason: `Target of $${formatNumber(target)} exceeds the absolute ceiling of $${formatNumber(ceiling)} for your inputs.`,
      maximumAchievable: ceiling,
    };
  }

  const candidates = kinkSetForW(base);
  let best: { inputs: Inputs; out: Output; cost: number } | null = null;

  for (const W of candidates) {
    const candInputs = buildInputsForTargetAtW(base, W, target);
    if (candInputs === null) continue;
    const out = compute(candInputs);
    const cost = totalTaxCost(out);
    if (best === null || cost < best.cost - 1e-6) {
      best = { inputs: candInputs, out, cost };
    }
  }

  if (!best) {
    // Should not happen — at least one W in the kink set should reach the
    // target if target ≤ ceiling.
    return {
      feasible: false,
      reason: `No (W-2, deferral, employer) combination hits a $${formatNumber(target)} target. This is likely an internal solver miss; try adjusting inputs.`,
      maximumAchievable: ceiling,
    };
  }

  const baseline = compute(base);
  const baselineCost = totalTaxCost(baseline);

  const matchEarned =
    Math.min(
      best.inputs.dayJobW2 * best.inputs.dayJobMatchLimitPct,
      best.inputs.dayJob401kEmployeeContribution,
    ) * best.inputs.dayJobMatchPct;

  const totalContribution =
    best.inputs.dayJob401kEmployeeContribution +
    best.inputs.soloEmployeeDeferral +
    best.inputs.soloEmployerContribution +
    matchEarned;

  const wChanged =
    Math.abs(best.inputs.sCorpW2Salary - base.sCorpW2Salary) > 0.5;
  const skipEmployer = best.inputs.soloEmployerContribution < 0.5;
  const note = (() => {
    const parts: string[] = [];
    if (wChanged) {
      parts.push(
        `Set S-corp W-2 to $${formatNumber(best.inputs.sCorpW2Salary)}`,
      );
    } else {
      parts.push(`Keep S-corp W-2 at $${formatNumber(base.sCorpW2Salary)}`);
    }
    parts.push(
      `defer $${formatNumber(best.inputs.dayJob401kEmployeeContribution)} at the day job` +
        (matchEarned > 0 ? ` (earns $${formatNumber(matchEarned)} match)` : ""),
    );
    if (best.inputs.soloEmployeeDeferral > 0.5) {
      parts.push(
        `$${formatNumber(best.inputs.soloEmployeeDeferral)} as Solo employee`,
      );
    }
    if (!skipEmployer) {
      parts.push(
        `$${formatNumber(best.inputs.soloEmployerContribution)} as Solo employer`,
      );
    }
    return parts.join("; ") + ".";
  })();

  return {
    feasible: true,
    sCorpW2: best.inputs.sCorpW2Salary,
    dayJobEmployeeDeferral: best.inputs.dayJob401kEmployeeContribution,
    soloEmployeeDeferral: best.inputs.soloEmployeeDeferral,
    soloEmployerContribution: best.inputs.soloEmployerContribution,
    totalContribution,
    totalTax: best.cost,
    baselineTax: baselineCost,
    savingsVsCurrent: baselineCost - best.cost,
    note,
  };
}
