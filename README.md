# s-corp-401k-tax-maxxing

**Live at [401k.tzaman.dev](https://401k.tzaman.dev).**

A single-page calculator that helps you figure out the right split between
W-2 salary and distributions when you have both a regular W-2 day job and
an S-corp on the side. The math is mostly about three things: how much
room is left in your 401(k) limits, how much Social Security tax your
S-corp will burn through that you can't get back, and what the QBI
deduction does on the way out. Everything runs in the browser, no backend.

## Run it locally

```bash
pnpm install
pnpm dev    # http://localhost:5173
```

`pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` all do what they
say. `pnpm deploy` builds and ships to Cloudflare Pages.

## Stack

pnpm 11, Vite 8, React 19, Tailwind v4 (using the Vite plugin, not the
old PostCSS path), Motion, Vitest. ESLint with flat config and Prettier
with defaults. TypeScript 6.

## Where the tax numbers live

`src/lib/tax-constants.ts` is the only file you should need to edit when
the tax year rolls over. It exports:

- `FEDERAL`: 401(k) limits, FICA rates, federal brackets, QBI thresholds,
  standard deductions
- `STATES`: per-state brackets, optional surtax and locality blocks,
  and "future tax" preview blocks like the WA ESSB 6346 millionaire's
  tax that hasn't taken effect yet

To advance a year you bump `TAX_YEAR` and pull fresh figures from IRS
Notice 20xx-xx (retirement limits), Rev. Proc. 20xx-xx (income tax
inflation), the SSA fact sheet (FICA wage base), and each state's
published brackets. Nothing else in the code should need to change.

## A note on accuracy

The figures in `tax-constants.ts` are sourced from IRS Notice 2025-67,
Rev. Proc. 2025-32, the SSA 2026 COLA fact sheet, the FTB and NY DTF
bracket releases, and ESSB 6346. If you find an error, fix it in the
constants file and the rest of the app picks it up.

The calculator is a planning tool. Don't change your payroll without
running the numbers past a CPA who knows your full picture.
