import Dexie, { type EntityTable } from 'dexie';
import type {
  AppSettings,
  GroceryItem,
  MealFeedback,
  MemberRating,
  PantryStaple,
  Person,
  PersonProfile,
  Recipe,
  WeekPlan,
} from '../types';
import { seedDatabase, SEED_MACROS } from './seed';

export class MealDB extends Dexie {
  people!: EntityTable<Person, 'id'>;
  recipes!: EntityTable<Recipe, 'id'>;
  weekPlans!: EntityTable<WeekPlan, 'id'>;
  feedback!: EntityTable<MealFeedback, 'id'>;
  pantry!: EntityTable<PantryStaple, 'id'>;
  grocery!: EntityTable<GroceryItem, 'id'>;
  profiles!: EntityTable<PersonProfile, 'personId'>;
  settings!: EntityTable<AppSettings, 'id'>;
  ratings!: EntityTable<MemberRating, 'id'>;

  constructor() {
    super('family-meal-os');
    this.version(1).stores({
      people: 'id',
      recipes: 'id, status, name',
      weekPlans: 'id, weekStartDate, status',
      feedback: 'id, recipeId, date, plannedMealId',
      pantry: 'id, name, level',
      grocery: 'id, status, addedAt',
      profiles: 'personId',
      settings: 'id',
    });

    // v2: nutrition gains carbs/fat. Additive-only backfill of the seed
    // recipes' hand-checked values — no row is removed or reshaped, so
    // existing data and old backups stay fully compatible.
    this.version(2)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table('recipes')
          .toCollection()
          .modify((recipe: { id: string; nutrition?: Record<string, unknown> }) => {
            const macros = SEED_MACROS[recipe.id];
            if (macros && recipe.nutrition && recipe.nutrition.carbsPerServing === undefined) {
              recipe.nutrition.carbsPerServing = macros.carbs;
              recipe.nutrition.fatPerServing = macros.fat;
            }
          });
      });

    // v3: family self-ratings received via share links. Purely additive.
    this.version(3).stores({
      ratings: 'id, plannedMealId, personId, date, recipeId',
    });

    // First-run seed: people, Week 1 plan + recipes, staples, settings.
    this.on('populate', () => seedDatabase(this));
  }
}

export const db = new MealDB();
