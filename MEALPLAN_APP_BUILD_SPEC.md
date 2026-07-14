# Family Meal OS — Build Specification for Claude Code

A self-improving family meal planning PWA. Single user (the cook), four eaters. Local-first, fully free hosting, optional Claude API for the intelligence layer.

This document is the complete spec. Hand it to Claude Code and build in the phase order at the bottom.

---

## 1. Product summary

The cook plans one week of family meals at a time. Each day the app tells him what he's cooking, when to start prep (including freezer-removal reminders), the full recipe, and the ingredients. After each meal he logs how much each family member ate and whether they enjoyed it, with free-text notes ("too salty", "dad loved it"). At the end of each week, the app feeds the full feedback history into Claude and generates next week's plan — automatically dropping disliked meals, adjusting seasoning/technique based on notes, and respecting each person's emerging preference profile. Ingredients that run out get flagged mid-cook and land on the next grocery list automatically.

### Non-goals for v1 (backlog, section 12)
- Family members rating meals themselves (multi-user)
- WhatsApp/n8n push reminders
- Accounts, sync across devices, cloud backup beyond manual export

---

## 2. Constraints and key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Platform | PWA, mobile-first (~380px viewport primary) | Used on phone in the kitchen |
| Backend | **None.** Local-first, IndexedDB via Dexie.js | Fully free requirement; single user; no sync needed |
| Hosting | Static — GitHub Pages or Vercel free tier | $0. User already has GitHub Pages experience |
| Framework | Vite + React + TypeScript | Fast static build, PWA plugin available (`vite-plugin-pwa`) |
| Styling | Tailwind CSS | Fast to build, small bundle |
| AI layer | Anthropic API called **directly from browser** with `anthropic-dangerous-direct-browser-access: true` header. Model: `claude-sonnet-4-6`. API key entered by user in Settings, stored in localStorage only | No server = no key proxy possible. Acceptable: personal single-user app, key never leaves his device. Document this tradeoff in-app |
| AI fallback | "Manual mode": app assembles the exact same prompt, user copies it, pastes into claude.ai, pastes the JSON response back into an import box | Keeps the app fully functional at $0 if he never adds a key |
| Notifications | In-app Today view is primary. Optionally, PWA local notifications (see section 8) | User chose in-app only |
| Data safety | JSON export/import (full DB dump) from Settings | IndexedDB can be wiped by browser storage eviction; manual backup is mandatory insurance |

**iOS PWA caveats to handle:** must be installed to home screen for persistent storage + notification permission (iOS 16.4+). Show an install banner with instructions on first visit. Call `navigator.storage.persist()` to request storage persistence.

---

## 3. Data model (Dexie/IndexedDB schema)

All IDs are `crypto.randomUUID()` strings. All timestamps ISO 8601.

```typescript
// db.ts — Dexie schema, version 1

interface Person {
  id: string;
  name: string;            // seeded: "Me", "Mom", "Dad", "Brother" — editable
  active: boolean;         // soft-delete / traveling family member
}

interface Recipe {
  id: string;
  name: string;                    // "Chicken Tacos"
  description: string;
  cuisineTags: string[];           // ["egyptian", "mexican", ...]
  method: 'airfryer' | 'stove' | 'oven' | 'grill' | 'slowcook' | 'nocook';
  servingsBase: number;            // always 4 for now
  ingredients: RecipeIngredient[];
  prepSteps: PrepStep[];           // ordered, with time offsets (see §5)
  nutrition: NutritionEstimate;    // per serving (see §7)
  status: 'active' | 'retired';    // retired = family disliked it; engine won't schedule it
  retiredReason?: string;          // "family didn't enjoy beef+sweet potato combo"
  version: number;                 // bumped every time the engine adjusts it
  changelog: RecipeChange[];       // audit trail of AI adjustments
  createdAt: string;
  updatedAt: string;
}

interface RecipeIngredient {
  name: string;              // normalized lowercase: "chicken breast"
  quantity: number;
  unit: string;              // "g", "tbsp", "pieces", "cans"
  isStaple: boolean;         // staples come from pantry, not auto-added to grocery list
  optional: boolean;
}

interface PrepStep {
  id: string;
  order: number;
  instruction: string;              // "Take chicken out of freezer"
  offsetMinutes: number;            // relative to serveTime. -480 = 8h before (freezer), -60 = start cooking
  durationMinutes?: number;         // for timers ("airfry 15 min")
  type: 'advance' | 'cook';         // advance steps (defrost/marinate) surface as early reminders
}

interface RecipeChange {
  date: string;
  source: 'ai' | 'manual';
  summary: string;           // "Reduced salt from 2 tsp to 1 tsp — feedback: too salty (Wed W3)"
}

interface WeekPlan {
  id: string;
  weekStartDate: string;     // ISO date of Sunday (Egyptian week: Sun–Sat, weekend Fri/Sat)
  status: 'draft' | 'active' | 'completed';
  generatedBy: 'ai' | 'manual';
  aiRationale?: string;      // the engine's explanation of what it changed and why — shown to user
  days: DayPlan[];
}

interface DayPlan {
  date: string;
  meals: PlannedMeal[];      // 1 main + 1 snack Sun–Thu; 2 meals Fri–Sat
}

interface PlannedMeal {
  id: string;
  recipeId: string;
  slot: 'main' | 'snack' | 'meal1' | 'meal2';
  serveTime: string;         // "18:00" — user-adjustable per day; drives the prep timeline
  status: 'planned' | 'cooked' | 'skipped';
}

interface MealFeedback {
  id: string;
  plannedMealId: string;
  recipeId: string;          // denormalized for fast history queries
  date: string;
  entries: PersonFeedback[];
  cookNotes: string;         // "ran long, sauce reduced too much"
  overallNote: string;       // "too salty" — feeds the engine directly
}

interface PersonFeedback {
  personId: string;
  ateAmount: 'none' | 'little' | 'half' | 'most' | 'all' | 'seconds';
  enjoyment: 1 | 2 | 3 | 4 | 5;   // 1 = hated, 5 = loved
  note?: string;                   // "Dad picked out the onions"
}

interface PantryStaple {
  id: string;
  name: string;              // "olive oil", "cumin", "salt", "rice"
  level: 'stocked' | 'low' | 'out';   // hybrid model: no quantities, just a 3-state level
  updatedAt: string;
}

interface GroceryItem {
  id: string;
  name: string;
  quantity?: string;         // freeform: "2kg", "3 cans"
  source: 'auto-recipe' | 'ran-out' | 'manual' | 'staple-low';
  linkedRecipeIds: string[];
  status: 'needed' | 'bought';
  addedAt: string;
}

interface PersonProfile {      // maintained BY the engine, one per person
  personId: string;
  likes: string[];             // ["crispy textures", "chicken", "lime/acid"]
  dislikes: string[];          // ["liver", "heavy salt", "raw onion"]
  patterns: string[];          // ["eats less at fish meals", "always finishes taco-style meals"]
  lastUpdated: string;
}

interface AppSettings {
  id: 'singleton';
  apiKey?: string;                    // localStorage actually, not IndexedDB — see §9
  defaultServeTimeWeekday: string;    // "18:00"
  defaultServeTimeWeekend: string[];  // ["13:00", "19:00"]
  aiMode: 'live' | 'manual';
  notificationsEnabled: boolean;
}
```

Dexie tables + indexes:
```typescript
db.version(1).stores({
  people: 'id',
  recipes: 'id, status, name',
  weekPlans: 'id, weekStartDate, status',
  feedback: 'id, recipeId, date, plannedMealId',
  pantry: 'id, name, level',
  grocery: 'id, status, addedAt',
  profiles: 'personId',
  settings: 'id'
});
```

### Seed data
On first run, seed: the 4 people; the finalized Week 1 plan (Sunday beef/sweet potato/cottage cheese/guacamole + chickpea snack, Monday chicken tacos + tuna/cottage cheese snack, Tuesday tilapia/lentils + egg bites, Wednesday liver/balady bread + cottage cheese/pita chips, Thursday slow-cooked beef shin over rice + ful dip, Friday shawarma strips + beef/sweet potato combo, Saturday tilapia/lentils + liver) as full Recipe records with real ingredients, prep steps, and nutrition estimates; and a starter staples list (oil, salt, cumin, paprika, coriander, garlic, rice, lentils, foul cans, tahini, lemon, onions, balady bread, honey).

---

## 4. Screens

Bottom tab navigation, 5 tabs. Mobile-first, thumb-reachable controls, large tap targets (kitchen use = wet/greasy hands).

### 4.1 Today (default/home tab)
- Header: date + "Today you're cooking: **Chicken Tacos**" (+ snack if weekday, both meals if weekend)
- **Prep timeline** rendered from `prepSteps` + `serveTime`:
  - Past-due advance steps highlighted red: "⚠ Take chicken out of freezer (was due 10:00)"
  - Upcoming steps with clock times: "17:15 — Marinate chicken", "18:00 — Serve"
  - Serve time editable inline (defaults from settings), timeline recalculates live
- **Cook mode** button → full-screen step-by-step: one step per screen, big text, built-in timer buttons for steps with `durationMinutes`, swipe/tap to advance
- Ingredients checklist for today (tap to check off while gathering)
- **"Ran out" quick action** on every ingredient row → one tap adds it to grocery list with `source: 'ran-out'` and, if it's a staple, sets pantry level to `out`
- After serve time passes: prominent **"Log feedback"** card

### 4.2 Week
- 7-day grid of the active week, each day showing meal names + status chips (planned/cooked/skipped)
- Tap a meal → recipe detail (ingredients, steps, nutrition, version history/changelog)
- Swap action: replace a planned meal with any active recipe
- **"Generate next week"** button (the engine, §6) — enabled once ≥1 feedback entry exists this week; shows the AI's rationale after generation and requires explicit "Accept plan" before it becomes active (user can edit the draft first)

### 4.3 Log (feedback)
- List of cooked-but-unlogged meals at top
- Per meal: 4 person rows, each with an `ateAmount` segmented control (none→seconds) and 1–5 enjoyment (emoji scale), optional note per person
- Meal-level: overall note + cook notes
- History view: past feedback grouped by week, filterable by person ("show me everything Dad disliked")

### 4.4 Grocery
- Two sections: **Needed** / **Bought** (tap to move; long-press to delete)
- Auto-populated when a week plan is accepted: union of all non-staple ingredients across the week's recipes, deduplicated by normalized name, quantities merged where units match
- Plus: ran-out items, staples marked low/out, manual adds (freeform input with quick-add)
- "Clear bought" action after a shopping run
- **Staples panel** (collapsible): the staple list with 3-state level toggles (stocked/low/out); low/out staples auto-appear in Needed

### 4.5 Settings
- People management (rename, toggle active)
- Default serve times (weekday / weekend meal 1 / weekend meal 2)
- AI mode toggle: Live (API key input, stored in localStorage, masked display, "test connection" button) / Manual
- Notifications toggle + permission request flow
- **Export data** (downloads full JSON dump) / **Import data** (restores from file) — prompt user to export weekly
- Per-person preference profiles (read-only view of what the engine has learned, §6.3) with a "correct this" edit option

---

## 5. Prep timeline logic

Each recipe's `prepSteps` carry `offsetMinutes` relative to serve time. Two types:

- **`advance` steps** (negative large offsets): defrosting (-480 to -720), marinating (-120), soaking lentils (-240). These render at the top of the Today view from app-open onward, with a checkbox. If current time > due time and unchecked → red warning state.
- **`cook` steps** (offsets within ~-90 to 0): the actual cooking sequence. These power Cook Mode.

Computation: `stepClockTime = serveTime + offsetMinutes`. All client-side, recomputed on serveTime edit. No scheduling infrastructure needed — the Today view *is* the reminder system, plus optional local notifications (§8).

When the AI generates recipes it must output `prepSteps` with sensible offsets (prompt contract, §6.2, enforces this).

---

## 6. The self-improvement engine (core differentiator)

### 6.1 What "self-improving" means concretely
Three feedback loops, all running at weekly-generation time:

1. **Recipe retirement.** Any recipe whose latest feedback shows average enjoyment ≤ 2, or where ≥2 people ate 'little' or less, is a retirement candidate. The engine either retires it (`status: 'retired'` + reason) or proposes a modified variant if the notes indicate a fixable cause ("too salty" → fixable; "nobody likes liver" → retire).
2. **Recipe adjustment.** Notes like "too salty" / "chicken was dry" / "kids wanted more sauce" produce a new recipe **version**: ingredient quantities or steps changed, `version` bumped, change appended to `changelog` with the triggering feedback cited. The old version is preserved in the changelog for rollback.
3. **Preference profile accretion.** After each generation, the engine updates each `PersonProfile` (likes/dislikes/patterns) from the accumulated `PersonFeedback`. Profiles are then *inputs* to the next generation ("Dad consistently rates fish ≤2 → cap fish at 1×/week and pair with a backup protein").

### 6.2 Generation flow (Live mode)

Trigger: user taps "Generate next week."

Client assembles a prompt containing:
- The constitution (fixed constraints): 4 servings; Sun–Thu = 1 main + 1 protein-forward snack, Fri–Sat = 2 meals; budget-conscious Egyptian ingredients with the cheap-protein rotation; every meal has a clear protein source; airfryer available; oven/grill/stove over frying; target ~40–50g protein/person at mains; calorie control via portions and oil, not protein cuts
- All active recipes (name, ingredients, version, method) + retired recipes with reasons (so it doesn't re-propose them)
- Last 2–4 weeks of feedback (structured: per person ateAmount + enjoyment + notes, meal-level notes)
- Current person profiles
- Pantry staples state (prefer recipes using stocked staples)
- Instruction set: retire/adjust/keep per the rules in 6.1; introduce at most 2 brand-new recipes per week (novelty without chaos); explain every change

Response contract: **strict JSON only** (no prose, no markdown fences), schema:

```json
{
  "weekPlan": { "days": [ { "date": "...", "meals": [ { "recipeRef": "existing:<id> | new:<index>", "slot": "main", "serveTimeSuggestion": "18:00" } ] } ] },
  "newRecipes": [ { "name": "...", "description": "...", "method": "...", "ingredients": [...], "prepSteps": [...], "nutrition": {...} } ],
  "recipeAdjustments": [ { "recipeId": "...", "changes": { "ingredients": [...], "prepSteps": [...] }, "summary": "Reduced salt 2tsp→1tsp", "triggeringFeedback": "Wed: 'too salty' (overall note)" } ],
  "retirements": [ { "recipeId": "...", "reason": "Avg enjoyment 1.8 across 2 servings; notes indicate dislike of liver flavor itself, not preparation" } ],
  "profileUpdates": [ { "personId": "...", "likes": [...], "dislikes": [...], "patterns": [...] } ],
  "rationale": "Plain-language summary of everything changed and why"
}
```

Client-side handling:
- `fetch` to `https://api.anthropic.com/v1/messages`, model `claude-sonnet-4-6`, with the direct-browser-access header; strip accidental ```json fences; `JSON.parse` in try/catch; validate against schema (lightweight manual validation or zod); on failure, one automatic retry with the parse error appended; on second failure, fall back to Manual mode flow with the prompt pre-assembled
- On success: write draft WeekPlan + new/adjusted recipes (as pending), show rationale, await user "Accept" → commits everything atomically (Dexie transaction) and regenerates the grocery list

### 6.3 Manual mode (fully free path)
Identical prompt assembly. Instead of calling the API: "Copy prompt" button → user pastes into claude.ai → copies the JSON reply → pastes into an import textarea → same validation + draft/accept flow. The app must make this genuinely pleasant: one-tap copy, clear instructions, forgiving paste parsing (strip fences, trim).

### 6.4 Cold start
Week 1 is seeded (§3). The engine only runs from Week 2 onward, so there is always feedback to work with.

---

## 7. Nutrition estimates

Deliberately "somewhat accurate, not precise" per the requirement:

```typescript
interface NutritionEstimate {
  caloriesPerServing: number;   // rounded to nearest 25
  proteinPerServing: number;    // grams, rounded to nearest 5
  confidence: 'rough';          // always — set expectations in UI
}
```

- Values come from Claude at recipe-creation/adjustment time (it estimates from the ingredient list) — no food-database API, no per-gram tracking. Seed recipes get hand-checked estimates.
- UI: shown on recipe cards and Today view as "≈ 550 kcal · ≈ 45g protein / serving", with a persistent "estimates are rough" footnote.
- Week view shows a per-day total and a weekly average per person, same rough framing.
- Do NOT build logging of actual consumed grams in v1. The `ateAmount` feedback field is the proxy.

---

## 8. Notifications (in-app first, local push optional)

- Primary mechanism: the Today view. Opening the app each morning is the agreed flow.
- Optional enhancement (build last): PWA local notifications for advance steps ("Take chicken out of freezer") scheduled while the app is open/installed. Reality check to implement honestly: iOS requires home-screen install + iOS 16.4+, and **scheduled** notifications without a push server are unreliable — service workers can't guarantee timed delivery when the app is closed. Implement as: notification fired if the app/SW is alive at due time; otherwise the red past-due state in Today view catches it. Do not build a push server; that violates the $0 constraint.
- Badge the app icon (where supported) when there's an unlogged cooked meal.

---

## 9. Security & privacy notes

- API key: localStorage only, never in exports, masked in UI. In-app warning: "Your key lives only on this device. Anyone with your unlocked phone can read it. Use a key with a low spend limit."
- All personal data (family names, feedback) stays on-device. No analytics, no third-party calls except api.anthropic.com in Live mode.
- Export files contain family data — name them clearly (`mealos-backup-2026-07-14.json`).

---

## 10. Tech implementation notes for Claude Code

- **Stack:** Vite + React 18 + TypeScript + Tailwind + Dexie + `vite-plugin-pwa` (autoUpdate registration, manifest with icons, standalone display).
- **State:** Dexie live queries (`dexie-react-hooks` `useLiveQuery`) — no Redux needed.
- **Routing:** react-router, 5 routes matching tabs + `/recipe/:id` + `/cook/:plannedMealId`.
- **Date handling:** date-fns. Week starts **Sunday** (Egyptian work week); weekend = Friday/Saturday. This is load-bearing everywhere — do not default to Monday-start or Sat/Sun weekends.
- **Testing:** vitest for the pure logic (timeline computation, grocery merge/dedupe, retirement rules, JSON response validation). Skip E2E in v1.
- **Grocery dedupe:** normalize ingredient names (lowercase, trim, singularize common cases); merge quantities only when units match, else list both ("chicken breast — 800g + 4 pieces").
- **Deploy:** GitHub repo, GitHub Pages via Actions (or Vercel free — user's choice at deploy time). Vite `base` config must match Pages subpath.

---

## 11. Build phases (execute in order)

**Phase 1 — Scaffold & data layer.** Vite/React/TS/Tailwind/PWA scaffold. Dexie schema + seed data (people, Week 1 recipes with full prep steps and nutrition, staples). Export/import. Settings screen skeleton.

**Phase 2 — Today view + Cook mode.** Prep timeline computation (+ unit tests), serve-time editing, past-due states, cook mode with timers, ingredient checklist, ran-out quick action.

**Phase 3 — Week view + feedback logging.** Week grid, recipe detail with changelog, meal swap. Full feedback flow (per-person + meal-level), history with per-person filter, unlogged-meal surfacing.

**Phase 4 — Grocery + pantry.** Auto-generation from accepted plans, dedupe/merge, ran-out + staple-level integration, bought/needed flow, staples panel.

**Phase 5 — The engine.** Prompt assembly from DB state, Live mode API call + validation + retry + atomic accept flow, Manual mode copy/paste flow, recipe versioning + changelog, retirement logic, profile updates, rationale display.

**Phase 6 — Polish & deploy.** PWA install banner + iOS instructions, `navigator.storage.persist()`, optional local notifications, icon/manifest, empty states, deploy pipeline, backup-reminder nudge.

Each phase must end with the app in a working, usable state — Phases 1–4 are fully useful with zero AI.

---

## 12. v2 backlog (do not build now)

- Family members rating meals from their own phones (requires backend or share-link hack)
- WhatsApp daily reminders via n8n hitting an API layer (requires backend — natural moment to migrate Dexie → Supabase)
- Cross-device sync / cloud backup
- Leftovers tracking, recipe photo capture, cost-per-meal tracking against grocery receipts
- Per-person portion targets in grams (needs bodyweights — pending from user)
