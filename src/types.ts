// Domain types — mirrors MEALPLAN_APP_BUILD_SPEC.md §3 exactly.

export interface Person {
  id: string;
  name: string;
  active: boolean;
}

export type CookMethod = 'airfryer' | 'stove' | 'oven' | 'grill' | 'slowcook' | 'nocook';

export interface NutritionEstimate {
  caloriesPerServing: number; // rounded to nearest 25
  proteinPerServing: number; // grams, rounded to nearest 5
  carbsPerServing?: number; // grams, rounded to nearest 5 (optional: pre-v2 rows lack it)
  fatPerServing?: number; // grams, rounded to nearest 5 (optional: pre-v2 rows lack it)
  confidence: 'rough';
}

export interface RecipeIngredient {
  name: string; // normalized lowercase
  quantity: number;
  unit: string;
  isStaple: boolean;
  optional: boolean;
}

export type PrepStepType = 'advance' | 'cook';

export interface PrepStep {
  id: string;
  order: number;
  instruction: string;
  offsetMinutes: number; // relative to serveTime; negative = before
  durationMinutes?: number;
  type: PrepStepType;
}

export interface RecipeChange {
  date: string;
  source: 'ai' | 'manual';
  summary: string;
}

export interface Recipe {
  id: string;
  name: string;
  description: string;
  cuisineTags: string[];
  method: CookMethod;
  servingsBase: number;
  ingredients: RecipeIngredient[];
  prepSteps: PrepStep[];
  nutrition: NutritionEstimate;
  status: 'active' | 'retired';
  retiredReason?: string;
  version: number;
  changelog: RecipeChange[];
  createdAt: string;
  updatedAt: string;
}

export type MealSlot = 'main' | 'snack' | 'meal1' | 'meal2';
export type MealStatus = 'planned' | 'cooked' | 'skipped';

export interface PlannedMeal {
  id: string;
  recipeId: string;
  slot: MealSlot;
  serveTime: string; // "18:00"
  status: MealStatus;
}

export interface DayPlan {
  date: string; // ISO date
  meals: PlannedMeal[];
}

export interface WeekPlan {
  id: string;
  weekStartDate: string; // ISO date of Sunday
  status: 'draft' | 'active' | 'completed';
  generatedBy: 'ai' | 'manual';
  aiRationale?: string;
  days: DayPlan[];
}

export type AteAmount = 'none' | 'little' | 'half' | 'most' | 'all' | 'seconds';
export type Enjoyment = 1 | 2 | 3 | 4 | 5;

export interface PersonFeedback {
  personId: string;
  ateAmount: AteAmount;
  enjoyment: Enjoyment;
  note?: string;
}

export interface MealFeedback {
  id: string;
  plannedMealId: string;
  recipeId: string;
  date: string;
  entries: PersonFeedback[];
  cookNotes: string;
  overallNote: string;
}

/** A family member's self-rating, received via the share-link flow. */
export interface MemberRating {
  id: string;
  plannedMealId: string;
  recipeId: string;
  personId: string;
  date: string; // meal date (ISO)
  rating: number; // 1–10
  enjoyed: string; // "what did you enjoy about it?"
  improve: string; // "how should it improve next time?"
  receivedAt: string;
}

export type StapleLevel = 'stocked' | 'low' | 'out';

export interface PantryStaple {
  id: string;
  name: string;
  level: StapleLevel;
  updatedAt: string;
}

export type GrocerySource = 'auto-recipe' | 'ran-out' | 'manual' | 'staple-low';

export interface GroceryItem {
  id: string;
  name: string;
  quantity?: string;
  source: GrocerySource;
  linkedRecipeIds: string[];
  status: 'needed' | 'bought';
  addedAt: string;
}

export interface PersonProfile {
  personId: string;
  likes: string[];
  dislikes: string[];
  patterns: string[];
  lastUpdated: string;
}

// Stored in IndexedDB. The API key is deliberately NOT here — it lives in
// localStorage only (hard rule #2) so it can never leak into exports.
export interface AppSettings {
  id: 'singleton';
  defaultServeTimeWeekday: string; // "18:00"
  defaultServeTimeWeekend: [string, string]; // ["13:00", "19:00"]
  defaultSnackTime: string; // "16:30"
  aiMode: 'live' | 'manual';
  notificationsEnabled: boolean;
}
