import Dexie, { type EntityTable } from 'dexie';
import type {
  AppSettings,
  GroceryItem,
  MealFeedback,
  PantryStaple,
  Person,
  PersonProfile,
  Recipe,
  WeekPlan,
} from '../types';
import { seedDatabase } from './seed';

export class MealDB extends Dexie {
  people!: EntityTable<Person, 'id'>;
  recipes!: EntityTable<Recipe, 'id'>;
  weekPlans!: EntityTable<WeekPlan, 'id'>;
  feedback!: EntityTable<MealFeedback, 'id'>;
  pantry!: EntityTable<PantryStaple, 'id'>;
  grocery!: EntityTable<GroceryItem, 'id'>;
  profiles!: EntityTable<PersonProfile, 'personId'>;
  settings!: EntityTable<AppSettings, 'id'>;

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

    // First-run seed: people, Week 1 plan + recipes, staples, settings.
    this.on('populate', () => seedDatabase(this));
  }
}

export const db = new MealDB();
