# Decisions

Choices made where the spec was silent, per CLAUDE.md ("choose the simplest option consistent with the hard rules and note it here").

## Phase 1

- **Snack serve time**: spec defines weekday main (18:00) and weekend meal times, but not a snack time. Added `defaultSnackTime` ("16:30") to `AppSettings` so snacks get a real slot on the prep timeline. Editable in Settings.
- **Icons**: spec/CLAUDE.md forbid unlisted dependencies, and the design skill forbids emoji-as-icons. Resolution: hand-inlined SVG icons (lucide-style) in `src/components/Icons.tsx` — no new package.
- **Design system**: ui-ux-pro-max recommended warm terracotta (#9A3412) + green accent (#059669) on cream (#FFFBEB), Varela Round headings + Nunito Sans body. Adopted the palette/type; skipped its "claymorphism" effect styling — heavy shadows/blur hurt kitchen legibility and performance. Light theme only in v1 (kitchen = bright environment; spec never asks for dark mode).
- **`AppSettings.apiKey`**: the spec's interface lists `apiKey?` but §9 mandates localStorage-only. The stored settings record deliberately omits the field (`src/lib/apiKey.ts` owns the key) so exports can never contain it.
- **PWA icon**: Phase 1 manifest uses `icon.svg` as placeholder; real 192/512 PNGs + maskable + apple-touch-icon are Phase 6 work.
- **Vite `base`**: left at `/` until deploy target (GitHub Pages subpath vs Vercel) is chosen in Phase 6.
- **Seed week**: Week 1 plan is seeded for the *current* calendar week at first run (computed Sunday start), not a fixed date, so the app is immediately useful.
- **Duplicate grocery adds**: `groceryRepo.add` merges into an existing 'needed' row with the same normalized name instead of creating duplicates (dedupe at write point, per hard rule #6).

## Phase 2

- **Advance-step & ingredient checkmarks** persist in localStorage keyed per planned meal (`src/lib/stepChecks.ts`) — disposable UI state, deliberately not in IndexedDB or exports.
- **Cook mode finishing** marks the meal `cooked`. There's no separate "mark cooked" button on Today; the Week screen's status chip covers manual overrides.

## Phase 3

- **Feedback eligibility**: any non-skipped meal whose serve time has passed can be logged, even if the user never opened cook mode. Saving feedback sets the meal to `cooked` (in the same transaction).
- **Week status chips are tappable** (planned → cooked → skipped → planned) so the user can correct reality without cook mode.
- **History "disliked only" filter** = enjoyment ≤ 2 for the selected person (matches the retirement threshold).

## Phase 4

- **"Fill from week plan" button** on Grocery: the spec auto-generates on plan *accept* (Phase 5), but the seeded Week 1 was never "accepted", so the button covers the cold start. Regeneration replaces only `auto-recipe` rows; ran-out/manual/staple rows survive.
- **Buying a staple restocks it**: marking a grocery item bought sets a matching pantry staple back to `stocked` (closes the ran-out → buy → stocked loop). Setting a staple back to stocked removes its auto-added `staple-low` row.
- **Long-press to delete** (550ms hold) per spec; a hint line explains it since long-press is invisible UI.

## Phase 5

- **Draft storage**: the validated engine response lives in localStorage until Accept — nothing touches IndexedDB before the atomic commit (hard rule #5). Drafts for a week that already started are discarded as stale.
- **Draft editing**: the review screen lets each meal be swapped via dropdown (active recipes + the draft's new recipes). Slot structure and dates are not editable — the validator enforces the weekday/weekend contract.
- **Validation strictness**: the validator rejects wrong dates, wrong slot pairs (Sun–Thu = main+snack, Fri–Sat = meal1+meal2), >2 new recipes, refs to retired-in-same-plan recipes, and positive prep offsets. Error strings are written to be fed back to the model on the single automatic retry.
- **`generatedBy` is 'ai'** for engine plans regardless of Live vs Manual transport (both are AI-generated; the field distinguishes engine plans from hand-built ones).
- **Old active plan → 'completed'** when a new plan is accepted, even mid-week.
- **max_tokens 8192** for generation (rule: never below 4000); test-connection uses a tiny 16-token call.

## Phase 6

- **Notifications implemented honestly** per spec §8: a 60s in-app timer fires a Notification within 5 minutes after an unchecked advance step's due time, only while the app is open. Dedup persisted in localStorage. Past-due red state in Today remains the safety net. App badge = count of unlogged cooked meals.
- **Backup nudge**: banner on Today when last export > 7 days (or never exported after 3 days of use); snooze = 2 days. Export date tracked in localStorage.
- **Icons**: generated PNGs (192/512/maskable/apple-touch-icon) from the terracotta bowl mark via a PIL script; `icon.svg` stays as favicon.
- **Deploy**: GitHub Pages workflow builds with `BASE_PATH=/<repo-name>/` (vite `base` reads it; localhost stays `/`). `404.html` copy provides the SPA deep-link fallback. `npm test` runs in CI before build.
- **Cook mode hides the tab bar and install banner** (full-screen focus).
