// First-run seed data: 4 people, Week 1 recipes + plan, starter staples, settings.
// Runs inside Dexie's populate transaction — synchronous adds only.

import type { MealDB } from './db';
import type {
  AppSettings,
  DayPlan,
  PantryStaple,
  Person,
  PrepStep,
  Recipe,
  RecipeIngredient,
  WeekPlan,
} from '../types';
import { weekStartISO, weekDates, isWeekendDate } from '../lib/dates';

const now = () => new Date().toISOString();

function ing(
  name: string,
  quantity: number,
  unit: string,
  opts: { staple?: boolean; optional?: boolean } = {}
): RecipeIngredient {
  return {
    name, // seed names are pre-normalized lowercase singulars
    quantity,
    unit,
    isStaple: opts.staple ?? false,
    optional: opts.optional ?? false,
  };
}

let stepCounter = 0;
function step(
  order: number,
  instruction: string,
  offsetMinutes: number,
  type: PrepStep['type'],
  durationMinutes?: number
): PrepStep {
  stepCounter += 1;
  return { id: `seed-step-${stepCounter}`, order, instruction, offsetMinutes, type, durationMinutes };
}

function recipe(
  id: string,
  name: string,
  description: string,
  cuisineTags: string[],
  method: Recipe['method'],
  ingredients: RecipeIngredient[],
  prepSteps: PrepStep[],
  calories: number,
  protein: number
): Recipe {
  return {
    id,
    name,
    description,
    cuisineTags,
    method,
    servingsBase: 4,
    ingredients,
    prepSteps,
    nutrition: { caloriesPerServing: calories, proteinPerServing: protein, confidence: 'rough' },
    status: 'active',
    version: 1,
    changelog: [],
    createdAt: now(),
    updatedAt: now(),
  };
}

// ---------------------------------------------------------------------------
// Recipes — Week 1 (hand-checked rough nutrition, per serving of 4)
// ---------------------------------------------------------------------------

export const R = {
  beefSweetPotato: 'seed-beef-sweet-potato',
  chickenTacos: 'seed-chicken-tacos',
  tilapiaLentils: 'seed-tilapia-lentils',
  liverBalady: 'seed-liver-balady',
  beefShinRice: 'seed-beef-shin-rice',
  shawarmaStrips: 'seed-shawarma-strips',
  roastedChickpeas: 'seed-roasted-chickpeas',
  tunaCottageBowl: 'seed-tuna-cottage-bowl',
  eggBites: 'seed-egg-bites',
  cottagePitaChips: 'seed-cottage-pita-chips',
  fulDip: 'seed-ful-dip',
} as const;

function buildRecipes(): Recipe[] {
  return [
    recipe(
      R.beefSweetPotato,
      'Beef & Sweet Potato Skillet',
      'Cumin-spiced minced beef with airfried sweet potato wedges, served with cottage cheese and quick guacamole.',
      ['egyptian', 'fusion'],
      'stove',
      [
        ing('minced beef', 500, 'g'),
        ing('sweet potato', 600, 'g'),
        ing('cottage cheese', 400, 'g'),
        ing('avocado', 2, 'pieces'),
        ing('lemon', 1, 'pieces', { staple: true }),
        ing('onion', 1, 'pieces', { staple: true }),
        ing('garlic', 3, 'cloves', { staple: true }),
        ing('cumin', 1, 'tsp', { staple: true }),
        ing('paprika', 1, 'tsp', { staple: true }),
        ing('salt', 1, 'tsp', { staple: true }),
        ing('olive oil', 2, 'tbsp', { staple: true }),
      ],
      [
        step(1, 'Move minced beef from freezer to fridge to defrost', -600, 'advance'),
        step(2, 'Peel sweet potatoes, cut into wedges, toss with oil, paprika and salt', -55, 'cook', 10),
        step(3, 'Airfry sweet potato wedges at 200°C, shake halfway', -45, 'cook', 25),
        step(4, 'Dice onion, mince garlic', -40, 'cook', 5),
        step(5, 'Brown beef with onion, garlic, cumin and salt', -30, 'cook', 15),
        step(6, 'Mash avocados with lemon juice and a pinch of salt', -15, 'cook', 8),
        step(7, 'Plate beef and wedges with cottage cheese and guacamole', -5, 'cook', 5),
      ],
      650,
      45
    ),

    recipe(
      R.chickenTacos,
      'Chicken Tacos',
      'Spiced seared chicken strips in warm tortillas with crunchy salad and yogurt-lemon drizzle.',
      ['mexican'],
      'stove',
      [
        ing('chicken breast', 600, 'g'),
        ing('tortilla', 8, 'pieces'),
        ing('plain yogurt', 150, 'g'),
        ing('tomato', 2, 'pieces'),
        ing('white cabbage', 0.25, 'pieces'),
        ing('onion', 1, 'pieces', { staple: true }),
        ing('lemon', 1, 'pieces', { staple: true }),
        ing('garlic', 2, 'cloves', { staple: true }),
        ing('cumin', 1, 'tsp', { staple: true }),
        ing('paprika', 2, 'tsp', { staple: true }),
        ing('coriander', 1, 'tsp', { staple: true }),
        ing('salt', 1, 'tsp', { staple: true }),
        ing('olive oil', 1.5, 'tbsp', { staple: true }),
      ],
      [
        step(1, 'Move chicken breast from freezer to fridge to defrost', -600, 'advance'),
        step(2, 'Slice chicken into strips, marinate with spices, garlic, lemon and oil', -120, 'advance', 10),
        step(3, 'Shred cabbage, dice tomato and onion; mix yogurt with lemon and salt', -35, 'cook', 10),
        step(4, 'Sear chicken strips on high heat until charred at the edges', -25, 'cook', 12),
        step(5, 'Warm tortillas in a dry pan or directly over flame', -10, 'cook', 5),
        step(6, 'Assemble tacos: chicken, salad, yogurt drizzle', -6, 'cook', 5),
      ],
      550,
      45
    ),

    recipe(
      R.tilapiaLentils,
      'Tilapia with Spiced Lentils',
      'Pan-seared tilapia fillets over cumin-coriander brown lentils with caramelized onion and lemon.',
      ['egyptian'],
      'stove',
      [
        ing('tilapia fillet', 600, 'g'),
        ing('brown lentil', 300, 'g', { staple: true }),
        ing('onion', 2, 'pieces', { staple: true }),
        ing('garlic', 3, 'cloves', { staple: true }),
        ing('cumin', 2, 'tsp', { staple: true }),
        ing('coriander', 1, 'tsp', { staple: true }),
        ing('lemon', 2, 'pieces', { staple: true }),
        ing('salt', 1, 'tsp', { staple: true }),
        ing('olive oil', 2, 'tbsp', { staple: true }),
      ],
      [
        step(1, 'Move tilapia from freezer to fridge to defrost', -480, 'advance'),
        step(2, 'Rinse lentils and soak in cold water', -240, 'advance', 5),
        step(3, 'Simmer lentils with garlic, cumin and salt until tender', -50, 'cook', 30),
        step(4, 'Slice onions and caramelize slowly in oil', -45, 'cook', 20),
        step(5, 'Pat fish dry, season with cumin, coriander, salt', -22, 'cook', 5),
        step(6, 'Sear tilapia 3–4 min per side', -15, 'cook', 10),
        step(7, 'Serve fish over lentils, top with onions and lemon', -5, 'cook', 5),
      ],
      525,
      45
    ),

    recipe(
      R.liverBalady,
      'Alexandrian Liver with Balady Bread',
      'Kebda eskandarani: hot-seared beef liver with garlic, green pepper and chili, stuffed into warm balady bread.',
      ['egyptian'],
      'stove',
      [
        ing('beef liver', 500, 'g'),
        ing('balady bread', 4, 'pieces', { staple: true }),
        ing('green pepper', 2, 'pieces'),
        ing('green chili', 1, 'pieces', { optional: true }),
        ing('garlic', 4, 'cloves', { staple: true }),
        ing('lemon', 1, 'pieces', { staple: true }),
        ing('cumin', 2, 'tsp', { staple: true }),
        ing('salt', 1, 'tsp', { staple: true }),
        ing('olive oil', 1.5, 'tbsp', { staple: true }),
      ],
      [
        step(1, 'Move liver from freezer to fridge to defrost', -480, 'advance'),
        step(2, 'Slice liver into thin strips; slice peppers, chili and garlic', -35, 'cook', 10),
        step(3, 'Sear liver in batches on very high heat, 2–3 min per batch', -22, 'cook', 8),
        step(4, 'Add garlic, peppers, cumin and lemon; toss 3–4 min', -12, 'cook', 5),
        step(5, 'Warm balady bread and stuff or serve alongside', -6, 'cook', 4),
      ],
      475,
      40
    ),

    recipe(
      R.beefShinRice,
      'Slow-Cooked Beef Shin over Rice',
      'Fall-apart beef shin braised with onion, garlic and tomato paste, served over fluffy white rice.',
      ['egyptian'],
      'slowcook',
      [
        ing('beef shin', 800, 'g'),
        ing('rice', 300, 'g', { staple: true }),
        ing('onion', 2, 'pieces', { staple: true }),
        ing('garlic', 4, 'cloves', { staple: true }),
        ing('tomato paste', 2, 'tbsp'),
        ing('cumin', 1, 'tsp', { staple: true }),
        ing('paprika', 1, 'tsp', { staple: true }),
        ing('salt', 1.5, 'tsp', { staple: true }),
        ing('olive oil', 1, 'tbsp', { staple: true }),
      ],
      [
        step(1, 'Move beef shin from freezer to fridge to defrost', -720, 'advance'),
        step(2, 'Start slow cooker: shin, onion, garlic, tomato paste, spices, water to cover', -330, 'advance', 15),
        step(3, 'Rinse rice and cook with a pinch of salt', -35, 'cook', 25),
        step(4, 'Shred beef into the sauce; reduce if too thin', -15, 'cook', 10),
        step(5, 'Serve beef and sauce over rice', -5, 'cook', 5),
      ],
      600,
      45
    ),

    recipe(
      R.shawarmaStrips,
      'Chicken Shawarma Strips',
      'Yogurt-marinated chicken thigh strips airfried until charred, with tahini sauce, chopped salad and warm bread.',
      ['levantine', 'egyptian'],
      'airfryer',
      [
        ing('chicken thigh', 700, 'g'),
        ing('plain yogurt', 150, 'g'),
        ing('balady bread', 4, 'pieces', { staple: true }),
        ing('tahini', 3, 'tbsp', { staple: true }),
        ing('cucumber', 2, 'pieces'),
        ing('tomato', 2, 'pieces'),
        ing('garlic', 3, 'cloves', { staple: true }),
        ing('lemon', 2, 'pieces', { staple: true }),
        ing('cumin', 1, 'tsp', { staple: true }),
        ing('paprika', 2, 'tsp', { staple: true }),
        ing('coriander', 1, 'tsp', { staple: true }),
        ing('salt', 1, 'tsp', { staple: true }),
      ],
      [
        step(1, 'Move chicken thighs from freezer to fridge to defrost', -600, 'advance'),
        step(2, 'Slice chicken; marinate in yogurt, garlic, lemon and spices', -180, 'advance', 10),
        step(3, 'Airfry chicken at 200°C until edges char, shaking twice', -30, 'cook', 18),
        step(4, 'Whisk tahini with lemon, garlic and water to a pourable sauce', -15, 'cook', 5),
        step(5, 'Chop cucumber-tomato salad', -12, 'cook', 8),
        step(6, 'Warm bread; assemble with chicken, salad and tahini', -6, 'cook', 5),
      ],
      600,
      45
    ),

    // --- Snacks -----------------------------------------------------------

    recipe(
      R.roastedChickpeas,
      'Spiced Roasted Chickpeas',
      'Crunchy airfried chickpeas tossed in cumin, paprika and salt.',
      ['egyptian'],
      'airfryer',
      [
        ing('chickpea', 2, 'cans'),
        ing('cumin', 1, 'tsp', { staple: true }),
        ing('paprika', 1, 'tsp', { staple: true }),
        ing('salt', 0.5, 'tsp', { staple: true }),
        ing('olive oil', 1, 'tbsp', { staple: true }),
      ],
      [
        step(1, 'Drain, rinse and pat chickpeas completely dry', -30, 'cook', 5),
        step(2, 'Airfry at 200°C until crunchy, shaking twice', -25, 'cook', 18),
        step(3, 'Toss hot chickpeas with oil and spices', -4, 'cook', 2),
      ],
      200,
      10
    ),

    recipe(
      R.tunaCottageBowl,
      'Tuna & Cottage Cheese Bowl',
      'Protein bowl: drained tuna folded into cottage cheese with cucumber, lemon and black pepper.',
      ['fusion'],
      'nocook',
      [
        ing('canned tuna', 2, 'cans'),
        ing('cottage cheese', 300, 'g'),
        ing('cucumber', 2, 'pieces'),
        ing('lemon', 1, 'pieces', { staple: true }),
        ing('black pepper', 0.5, 'tsp', { staple: true }),
        ing('olive oil', 1, 'tbsp', { staple: true, optional: true }),
      ],
      [
        step(1, 'Drain tuna well', -10, 'cook', 2),
        step(2, 'Dice cucumber; fold everything together with lemon and pepper', -8, 'cook', 5),
      ],
      250,
      30
    ),

    recipe(
      R.eggBites,
      'Oven Egg Bites',
      'Muffin-tin egg bites with cottage cheese, pepper and onion — eat warm or cold.',
      ['fusion'],
      'oven',
      [
        ing('egg', 8, 'pieces'),
        ing('cottage cheese', 150, 'g'),
        ing('green pepper', 1, 'pieces'),
        ing('onion', 0.5, 'pieces', { staple: true }),
        ing('salt', 0.5, 'tsp', { staple: true }),
        ing('olive oil', 0.5, 'tbsp', { staple: true }),
      ],
      [
        step(1, 'Preheat oven to 180°C; oil a muffin tin', -40, 'cook', 10),
        step(2, 'Whisk eggs with cottage cheese; stir in diced pepper and onion', -30, 'cook', 8),
        step(3, 'Fill tin and bake until just set', -20, 'cook', 18),
      ],
      200,
      15
    ),

    recipe(
      R.cottagePitaChips,
      'Cottage Cheese with Pita Chips',
      'Airfried balady bread chips with paprika, served over seasoned cottage cheese.',
      ['egyptian'],
      'airfryer',
      [
        ing('cottage cheese', 400, 'g'),
        ing('balady bread', 2, 'pieces', { staple: true }),
        ing('paprika', 1, 'tsp', { staple: true }),
        ing('salt', 0.25, 'tsp', { staple: true }),
        ing('olive oil', 1, 'tbsp', { staple: true }),
      ],
      [
        step(1, 'Cut bread into triangles, brush with oil and paprika', -20, 'cook', 5),
        step(2, 'Airfry at 180°C until golden and crisp', -15, 'cook', 8),
        step(3, 'Season cottage cheese; serve with warm chips', -5, 'cook', 3),
      ],
      250,
      15
    ),

    recipe(
      R.fulDip,
      'Ful Dip with Veggie Sticks',
      'Warm mashed ful medames with tahini, lemon and cumin, served with carrot and cucumber sticks.',
      ['egyptian'],
      'stove',
      [
        ing('foul can', 2, 'cans', { staple: true }),
        ing('tahini', 2, 'tbsp', { staple: true }),
        ing('lemon', 1, 'pieces', { staple: true }),
        ing('cumin', 1, 'tsp', { staple: true }),
        ing('garlic', 1, 'cloves', { staple: true }),
        ing('carrot', 3, 'pieces'),
        ing('cucumber', 2, 'pieces'),
        ing('olive oil', 1, 'tbsp', { staple: true }),
      ],
      [
        step(1, 'Warm ful in a pot with a splash of water', -20, 'cook', 8),
        step(2, 'Mash with tahini, lemon, cumin and garlic; drizzle oil', -10, 'cook', 5),
        step(3, 'Cut carrot and cucumber sticks', -8, 'cook', 5),
      ],
      225,
      12
    ),
  ];
}

// ---------------------------------------------------------------------------
// Week 1 plan — current week, Sun–Sat (weekend = Fri/Sat)
// ---------------------------------------------------------------------------

const WEEK1_MAINS: string[] = [
  R.beefSweetPotato, // Sun
  R.chickenTacos, // Mon
  R.tilapiaLentils, // Tue
  R.liverBalady, // Wed
  R.beefShinRice, // Thu
  R.shawarmaStrips, // Fri meal 1
  R.tilapiaLentils, // Sat meal 1
];

const WEEK1_SECOND: string[] = [
  R.roastedChickpeas, // Sun snack
  R.tunaCottageBowl, // Mon snack
  R.eggBites, // Tue snack
  R.cottagePitaChips, // Wed snack
  R.fulDip, // Thu snack
  R.beefSweetPotato, // Fri meal 2
  R.liverBalady, // Sat meal 2
];

function buildWeekPlan(settings: AppSettings): WeekPlan {
  const weekStart = weekStartISO(new Date());
  const dates = weekDates(weekStart);

  const days: DayPlan[] = dates.map((date, i) => {
    const weekend = isWeekendDate(date);
    const meals = weekend
      ? [
          {
            id: crypto.randomUUID(),
            recipeId: WEEK1_MAINS[i],
            slot: 'meal1' as const,
            serveTime: settings.defaultServeTimeWeekend[0],
            status: 'planned' as const,
          },
          {
            id: crypto.randomUUID(),
            recipeId: WEEK1_SECOND[i],
            slot: 'meal2' as const,
            serveTime: settings.defaultServeTimeWeekend[1],
            status: 'planned' as const,
          },
        ]
      : [
          {
            id: crypto.randomUUID(),
            recipeId: WEEK1_MAINS[i],
            slot: 'main' as const,
            serveTime: settings.defaultServeTimeWeekday,
            status: 'planned' as const,
          },
          {
            id: crypto.randomUUID(),
            recipeId: WEEK1_SECOND[i],
            slot: 'snack' as const,
            serveTime: settings.defaultSnackTime,
            status: 'planned' as const,
          },
        ];
    return { date, meals };
  });

  return {
    id: crypto.randomUUID(),
    weekStartDate: weekStart,
    status: 'active',
    generatedBy: 'manual',
    days,
  };
}

// ---------------------------------------------------------------------------

const STARTER_STAPLES = [
  'olive oil',
  'salt',
  'cumin',
  'paprika',
  'coriander',
  'garlic',
  'rice',
  'brown lentil',
  'foul can',
  'tahini',
  'lemon',
  'onion',
  'balady bread',
  'honey',
  'black pepper',
];

export function seedDatabase(database: MealDB): void {
  const people: Person[] = [
    { id: crypto.randomUUID(), name: 'Me', active: true },
    { id: crypto.randomUUID(), name: 'Mom', active: true },
    { id: crypto.randomUUID(), name: 'Dad', active: true },
    { id: crypto.randomUUID(), name: 'Brother', active: true },
  ];

  const settings: AppSettings = {
    id: 'singleton',
    defaultServeTimeWeekday: '18:00',
    defaultServeTimeWeekend: ['13:00', '19:00'],
    defaultSnackTime: '16:30',
    aiMode: 'manual',
    notificationsEnabled: false,
  };

  const staples: PantryStaple[] = STARTER_STAPLES.map((name) => ({
    id: crypto.randomUUID(),
    name,
    level: 'stocked',
    updatedAt: now(),
  }));

  database.people.bulkAdd(people);
  database.settings.add(settings);
  database.recipes.bulkAdd(buildRecipes());
  database.weekPlans.add(buildWeekPlan(settings));
  database.pantry.bulkAdd(staples);
  database.profiles.bulkAdd(
    people.map((p) => ({ personId: p.id, likes: [], dislikes: [], patterns: [], lastUpdated: now() }))
  );
}
