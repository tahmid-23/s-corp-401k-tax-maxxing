# s-corp-401k-tax-maxxing

**Live at [401k.tzaman.dev](https://401k.tzaman.dev).**

A single-page calculator that helps you figure out the right split between
W-2 salary and distributions when you have both a regular W-2 day job and
an S-corp on the side. Everything runs in the browser, no backend.

## Why this exists

The U.S. retirement-savings system was built for someone with one job. The
moment you have two, a W-2 day job and an S-corp, the limits start
interacting in ways the IRS publications don't make obvious. Three caps
govern you at once:

- **402(g)** caps employee elective deferrals at $24,500 in 2026 (more if
  you're 50+), aggregated across every 401(k) you participate in. Defer
  $20k at the day job and $10k at your Solo and you've overshot.
- **415(c)** caps total annual additions at $72,000 per unrelated
  employer. The day job and the S-corp each get their own bucket.
- **25% of W-2** caps the Solo 401(k) employer side. The only way to push
  the Solo past the deferral cap is to pay yourself more S-corp wages,
  which costs FICA.

Once your day-job W-2 crosses the Social Security wage base ($184,500 in
2026), every additional dollar of S-corp salary triggers a 6.2%
employer-side SS payment that the S-corp cannot get back. The employee
side comes back to you on Form 1040 Schedule 3 as excess withholding.
The employer side is gone. Add Medicare (2.9% both halves) and another
0.9% additional Medicare above your filing-status threshold and you're
looking at roughly 10% dead weight on the marginal S-corp wage dollar.
Against that, each dollar of S-corp W-2 unlocks 25 cents of Solo 401(k)
employer contribution. The arithmetic only favors more salary up to a
point, and the point isn't obvious without running the numbers.

The QBI deduction (Section 199A) pulls the other way. It applies to the
S-corp's pass-through distributions, not your W-2. Below the income
threshold ($201,775 single / $403,500 joint in 2026), paying yourself
less salary leaves more profit eligible for the 20% deduction. Above the
threshold the math flips for non-SSTBs, and zeros out for SSTBs. The
calculator surfaces all of this so you can see the tradeoff before you
talk to your CPA.

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
