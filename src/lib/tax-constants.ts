/**
 * SINGLE SOURCE OF TRUTH for tax-year figures and state presets.
 *
 * To update for a new tax year:
 *   1. Bump TAX_YEAR
 *   2. Update FEDERAL with new IRS / SSA figures (Notice 20xx-xx for retirement,
 *      Rev. Proc. 20xx-xx for inflation adjustments, SSA fact sheet for FICA)
 *   3. Update STATES with each state's published brackets
 *
 * Sources for the 2026 figures below:
 *   - IRS Notice 2025-67 (retirement plan limits)
 *   - Rev. Proc. 2025-32 (income tax inflation, incl. OBBBA amendments)
 *   - SSA 2026 COLA fact sheet (FICA wage base)
 *   - CA FTB, NY DTF, NYC Form IT-201-I 2026 (state brackets)
 *   - ESSB 6346 (WA millionaire's tax, effective 2028)
 */

import type { Bracket, FilingStatusMap } from "./types";

export const TAX_YEAR = 2026 as const;

export const FEDERAL = {
  // ── 401(k) ── IRS Notice 2025-67 ─────────────────────────────────────────
  elective402gLimit: 24_500, // employee elective deferral cap, per-person, aggregated
  catchUp50Plus: 8_000, // age 50+ catch-up (sits outside 415(c))
  superCatchUp60to63: 11_250, // SECURE 2.0 super-catch-up, ages 60–63
  annualAdditions415c: 72_000, // per-employer, employee + employer combined
  compCap401a17: 360_000, // up from $350k in 2025
  employerContribPctOfW2: 0.25, // solo 401(k) employer side, % of S-corp owner W-2

  // ── FICA ── SSA 2026 ─────────────────────────────────────────────────────
  ssWageBase: 184_500,
  ssRateEmployee: 0.062,
  ssRateEmployer: 0.062,
  medicareRateEmployee: 0.0145,
  medicareRateEmployer: 0.0145,
  additionalMedicareRate: 0.009, // employee-only, no employer match
  additionalMedicareThreshold: {
    single: 200_000,
    mfj: 250_000,
    mfs: 125_000,
    hoh: 200_000,
  } as FilingStatusMap<number>,

  // ── Federal income tax ── Rev. Proc. 2025-32 ─────────────────────────────
  standardDeduction: {
    single: 16_100,
    mfs: 16_100,
    hoh: 24_150,
    mfj: 32_200,
  } as FilingStatusMap<number>,

  brackets: {
    single: [
      { rate: 0.1, upTo: 12_400 },
      { rate: 0.12, upTo: 50_400 },
      { rate: 0.22, upTo: 105_700 },
      { rate: 0.24, upTo: 201_775 },
      { rate: 0.32, upTo: 256_225 },
      { rate: 0.35, upTo: 640_600 },
      { rate: 0.37, upTo: Infinity },
    ],
    mfj: [
      { rate: 0.1, upTo: 24_800 },
      { rate: 0.12, upTo: 100_800 },
      { rate: 0.22, upTo: 211_400 },
      { rate: 0.24, upTo: 403_550 },
      { rate: 0.32, upTo: 512_450 },
      { rate: 0.35, upTo: 768_700 },
      { rate: 0.37, upTo: Infinity },
    ],
    hoh: [
      { rate: 0.1, upTo: 17_700 },
      { rate: 0.12, upTo: 67_450 },
      { rate: 0.22, upTo: 105_700 },
      { rate: 0.24, upTo: 201_775 },
      { rate: 0.32, upTo: 256_200 },
      { rate: 0.35, upTo: 640_600 },
      { rate: 0.37, upTo: Infinity },
    ],
    // MFS = half-of-MFJ (Rev. Proc. 2025-32 Table 3)
    mfs: [
      { rate: 0.1, upTo: 12_400 },
      { rate: 0.12, upTo: 50_400 },
      { rate: 0.22, upTo: 105_700 },
      { rate: 0.24, upTo: 201_775 },
      { rate: 0.32, upTo: 256_225 },
      { rate: 0.35, upTo: 384_350 },
      { rate: 0.37, upTo: Infinity },
    ],
  } as FilingStatusMap<Bracket[]>,

  // ── QBI (199A) ── Rev. Proc. 2025-32 ─────────────────────────────────────
  // OBBBA actually LOWERED the 2026 threshold (from the inflation-trended
  // 2025 figure of ~$241,950 single / $483,900 MFJ) and widened the phase-out
  // window, presumably so the wage-and-property limits bind for more
  // pass-through owners.
  qbi: {
    rate: 0.2,
    incomeThreshold: {
      single: 201_775,
      mfs: 201_775,
      hoh: 201_775,
      mfj: 403_500,
    } as FilingStatusMap<number>,
    phaseoutRange: {
      single: 75_000,
      mfs: 75_000,
      hoh: 75_000,
      mfj: 150_000,
    } as FilingStatusMap<number>,
  },
} as const;

// ── State presets ─────────────────────────────────────────────────────────

export type StateLocality = {
  name: string;
  brackets: FilingStatusMap<Bracket[]>;
};

export type StatePreset = {
  name: string;
  brackets: FilingStatusMap<Bracket[]>;
  standardDeduction: FilingStatusMap<number>;
  surtax?: {
    thresholdSingle: number;
    thresholdMfj: number;
    rate: number;
    label: string;
  };
  localities?: Record<string, StateLocality>;
  futureMillionairesTax?: {
    effectiveYear: number;
    rate: number;
    threshold: number;
    label: string;
    note: string;
  };
  note?: string;
};

const FLAT_ZERO: FilingStatusMap<Bracket[]> = {
  single: [{ rate: 0, upTo: Infinity }],
  mfj: [{ rate: 0, upTo: Infinity }],
  mfs: [{ rate: 0, upTo: Infinity }],
  hoh: [{ rate: 0, upTo: Infinity }],
};

const ZERO_SD: FilingStatusMap<number> = { single: 0, mfj: 0, mfs: 0, hoh: 0 };

// California 2026 — FTB indexed at 2.971% (CCPI Jun 2024 → Jun 2025).
// Single thresholds; MFJ are exactly doubled per CA structure.
const CA_SINGLE: Bracket[] = [
  { rate: 0.01, upTo: 11_076 },
  { rate: 0.02, upTo: 26_257 },
  { rate: 0.04, upTo: 41_443 },
  { rate: 0.06, upTo: 57_527 },
  { rate: 0.08, upTo: 72_724 },
  { rate: 0.093, upTo: 371_479 },
  { rate: 0.103, upTo: 445_771 },
  { rate: 0.113, upTo: 742_953 },
  { rate: 0.123, upTo: Infinity },
];
const CA_MFJ: Bracket[] = CA_SINGLE.map((b) => ({
  rate: b.rate,
  upTo: b.upTo === Infinity ? Infinity : b.upTo * 2,
}));

// New York 2026 — phase-1 of the middle-class tax cut signed with the
// FY2026 enacted budget. The bottom five brackets are reduced 0.1pp for
// 2026 (a second 0.1pp cut lands in 2027). Top four brackets unchanged.
//   4.00 → 3.90, 4.50 → 4.40, 5.25 → 5.15, 5.50 → 5.40, 6.00 → 5.90
const NY_SINGLE: Bracket[] = [
  { rate: 0.039, upTo: 8_500 },
  { rate: 0.044, upTo: 11_700 },
  { rate: 0.0515, upTo: 13_900 },
  { rate: 0.054, upTo: 80_650 },
  { rate: 0.059, upTo: 215_400 },
  { rate: 0.0685, upTo: 1_077_550 },
  { rate: 0.0965, upTo: 5_000_000 },
  { rate: 0.103, upTo: 25_000_000 },
  { rate: 0.109, upTo: Infinity },
];
const NY_MFJ: Bracket[] = [
  { rate: 0.039, upTo: 17_150 },
  { rate: 0.044, upTo: 23_600 },
  { rate: 0.0515, upTo: 27_900 },
  { rate: 0.054, upTo: 161_550 },
  { rate: 0.059, upTo: 323_200 },
  { rate: 0.0685, upTo: 2_155_350 },
  { rate: 0.0965, upTo: 5_000_000 },
  { rate: 0.103, upTo: 25_000_000 },
  { rate: 0.109, upTo: Infinity },
];

// NYC resident income tax — Form IT-201-I 2026
const NYC_SINGLE: Bracket[] = [
  { rate: 0.03078, upTo: 12_000 },
  { rate: 0.03762, upTo: 25_000 },
  { rate: 0.03819, upTo: 50_000 },
  { rate: 0.03876, upTo: Infinity },
];
const NYC_MFJ: Bracket[] = [
  { rate: 0.03078, upTo: 21_600 },
  { rate: 0.03762, upTo: 45_000 },
  { rate: 0.03819, upTo: 90_000 },
  { rate: 0.03876, upTo: Infinity },
];

export const STATES = {
  none: {
    name: "No state tax",
    brackets: FLAT_ZERO,
    standardDeduction: ZERO_SD,
  },
  ca: {
    name: "California",
    brackets: {
      single: CA_SINGLE,
      mfs: CA_SINGLE,
      hoh: CA_SINGLE,
      mfj: CA_MFJ,
    },
    standardDeduction: { single: 5_540, mfs: 5_540, hoh: 11_080, mfj: 11_080 },
    surtax: {
      thresholdSingle: 1_000_000,
      thresholdMfj: 1_000_000,
      rate: 0.01,
      label: "CA Mental Health Services Tax (1% above $1M)",
    },
  },
  ny: {
    name: "New York",
    brackets: {
      single: NY_SINGLE,
      mfs: NY_SINGLE,
      hoh: NY_SINGLE,
      mfj: NY_MFJ,
    },
    standardDeduction: { single: 8_000, mfs: 8_000, hoh: 11_200, mfj: 16_050 },
    localities: {
      nyc: {
        name: "New York City",
        brackets: {
          single: NYC_SINGLE,
          mfs: NYC_SINGLE,
          hoh: NYC_SINGLE,
          mfj: NYC_MFJ,
        },
      },
    },
  },
  wa: {
    name: "Washington",
    brackets: FLAT_ZERO,
    standardDeduction: ZERO_SD,
    futureMillionairesTax: {
      effectiveYear: 2028,
      rate: 0.099,
      threshold: 1_000_000,
      label: "ESSB 6346 millionaire’s tax",
      note: "Enacted March 2026, effective January 2028. Pending constitutional challenge. Flat $1M household threshold (NOT doubled for MFJ).",
    },
    note: "No general state income tax for 2026. Also a 7% capital gains tax above ~$270k (not modeled).",
  },
} as const satisfies Record<string, StatePreset>;

export type StateKey = keyof typeof STATES;
