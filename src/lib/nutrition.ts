// Macro rounding + display helpers. Hard rule #7: nutrition is rough by
// design — kcal rounds to 25, grams to 5, always labelled an estimate.

import type { NutritionEstimate } from '../types';

export function roundKcal(n: number): number {
  return Math.round(n / 25) * 25;
}

export function roundGrams(n: number): number {
  return Math.round(n / 5) * 5;
}

/** "≈ 650 kcal · 45g protein · 35g carbs · 35g fat" (macros only when known). */
export function formatMacros(n: NutritionEstimate): string {
  const parts = [`≈ ${n.caloriesPerServing} kcal`, `${n.proteinPerServing}g protein`];
  if (n.carbsPerServing !== undefined) parts.push(`${n.carbsPerServing}g carbs`);
  if (n.fatPerServing !== undefined) parts.push(`${n.fatPerServing}g fat`);
  return parts.join(' · ');
}

/** Compact chips variant for tight rows: "650 kcal · P45 C35 F35". */
export function formatMacrosCompact(n: NutritionEstimate): string {
  let s = `${n.caloriesPerServing} kcal · P${n.proteinPerServing}`;
  if (n.carbsPerServing !== undefined) s += ` C${n.carbsPerServing}`;
  if (n.fatPerServing !== undefined) s += ` F${n.fatPerServing}`;
  return s;
}
