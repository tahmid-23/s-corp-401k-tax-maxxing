export type FilingStatus = "single" | "mfj" | "mfs" | "hoh";
export type DeferralTaxType = "traditional" | "roth";

export type Bracket = { rate: number; upTo: number };

export type FilingStatusMap<T> = Record<FilingStatus, T>;
