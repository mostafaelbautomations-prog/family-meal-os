# CLAUDE.md — Family Meal OS

Self-improving family meal planning PWA. Single user (the cook), 4 eaters, phone-first (kitchen use). Full specification lives in `MEALPLAN_APP_BUILD_SPEC.md` — read it before starting any phase. This file covers conventions and hard rules; the spec covers what to build.

## Project context

- One user logs everything. No auth, no multi-user, no backend. Do not add a server, serverless functions, or any paid service — the $0 constraint is absolute.
- Data lives in IndexedDB on the user's phone. Treat data loss as the top product risk: never write a migration or schema change without preserving existing data, and never break export/import.

## Stack (do not substitute)

- Vite + React 18 + TypeScript (strict mode) + Tailwind CSS
- Dexie.js for IndexedDB, `dexie-react-hooks` (`useLiveQuery`) for state — no Redux, no Zustand, no context-based stores
- react-router for the 5 tabs + `/recipe/:id` + `/cook/:plannedMealId`
- date-fns for dates
- `vite-plugin-pwa` (autoUpdate) for PWA
- vitest for unit tests
- Anthropic API: model `claude-sonnet-4-6`, direct browser fetch with `anthropic-dangerous-direct-browser-access: true`. Never set max_tokens below 4000 for generation calls (the JSON response is large).

## Hard rules (load-bearing, violating these breaks the product)

1. **Week starts Sunday. Weekend is Friday + Saturday.** Egyptian calendar. Sun–Thu = 1 main + 1 snack; Fri–Sat = 2 meals, no snack. Audit every date-fns call for `weekStartsOn: 0`; never use library defaults for week boundaries.
2. **The API key lives in localStorage only.** Never in IndexedDB, never in exports, never logged, masked in UI. No env vars for the key — the user enters it in Settings at runtime.
3. **Manual mode must stay at full parity with Live mode.** Any change to the generation prompt or response schema must work identically through the copy/paste flow. Test both paths.
4. **Recipe changes are versioned, never destructive.** Adjustments bump `version` and append to `changelog`. Retirement sets `status: 'retired'` — never delete recipe or feedback rows.
5. **AI-generated plans are drafts until the user taps Accept.** Accept commits atomically in a single Dexie transaction (week plan + new recipes + adjustments + retirements + profile updates + grocery regeneration). Partial commits are bugs.
6. **Ingredient names are normalized** (lowercase, trimmed) at every write point. Grocery dedupe depends on this.
7. **Nutrition is rough by design.** Round kcal to 25, protein to 5g, always label as estimate. Do not add food-database APIs or precision tracking.

## Code conventions

- Small files: one component per file, pure logic separated from components into `src/lib/` (timeline computation, grocery merge, retirement rules, prompt assembly, response validation)
- All Dexie access through a typed repository layer in `src/db/` — components never call `db.table` directly
- All AI prompt templates in `src/ai/prompts.ts` as typed template functions; response schema validation in `src/ai/validate.ts`
- Mobile-first Tailwind: design for ~380px, min tap target 44px (kitchen = greasy hands), bottom tab nav thumb-reachable
- No `any`. No silent catch blocks — every catch either recovers meaningfully or surfaces an error state in UI
- UI copy: plain English, no jargon. Errors tell the user what to do next ("Paste didn't parse — make sure you copied Claude's entire reply")

## Testing

Unit-test the pure logic, skip E2E:
- `src/lib/timeline.ts` — offset math, past-due detection, serve-time recompute
- `src/lib/grocery.ts` — dedupe, unit-aware quantity merge, staple exclusion
- `src/lib/engine-rules.ts` — retirement thresholds (avg enjoyment ≤2, ≥2 people ate 'little' or less)
- `src/ai/validate.ts` — JSON schema validation incl. fence-stripping and malformed input

Run `npm test` before declaring any phase complete.

## Build order

Execute the 6 phases in the spec sequentially. Each phase ends with a working app (`npm run dev` clean, tests passing, no TS errors). Phases 1–4 must be fully usable with zero AI configured. Do not start the engine (phase 5) early.

## Commands

```bash
npm run dev        # local dev server
npm test           # vitest
npm run build      # production build (verify PWA manifest + base path)
npm run preview    # test the production build locally
```

## Deploy

GitHub Pages via Actions. `vite.config.ts` `base` must match the repo subpath. Verify the PWA installs from the deployed URL on iOS Safari (add-to-home-screen) before calling deploy done.

## When uncertain

- Product behavior questions → check `MEALPLAN_APP_BUILD_SPEC.md` first; it is the source of truth
- Spec silent on something → choose the simplest option consistent with the hard rules and note the decision in a `DECISIONS.md` at repo root
- Never invent new features, screens, or dependencies not in the spec without asking
