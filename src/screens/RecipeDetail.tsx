// Recipe detail: ingredients, steps, nutrition, version history.

import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, Screen } from '../components/Screen';
import { recipesRepo } from '../db/repo';
import { IconChevronLeft } from '../components/Icons';

export function RecipeDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const recipe = useLiveQuery(() => (id ? recipesRepo.byId(id) : undefined), [id]);

  if (!recipe) {
    return (
      <Screen title="Recipe">
        <Card><p className="text-ink-soft">Recipe not found.</p></Card>
      </Screen>
    );
  }

  return (
    <main className="px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-28">
      <button
        onClick={() => navigate(-1)}
        className="mb-3 flex min-h-11 cursor-pointer items-center gap-1 font-semibold text-primary"
      >
        <IconChevronLeft size={20} /> Back
      </button>
      <h1 className="font-display text-2xl">{recipe.name}</h1>
      <p className="mt-1 text-sm text-ink-soft">{recipe.description}</p>
      {recipe.status === 'retired' && (
        <p className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
          Retired{recipe.retiredReason ? `: ${recipe.retiredReason}` : ''}
        </p>
      )}
      <p className="mt-2 text-sm font-semibold text-secondary">
        ≈ {recipe.nutrition.caloriesPerServing} kcal · ≈ {recipe.nutrition.proteinPerServing}g protein /
        serving <span className="font-normal text-ink-soft">(rough estimate)</span>
      </p>

      <h2 className="mt-5 mb-2 font-display text-lg">Ingredients</h2>
      <Card>
        <ul className="flex flex-col divide-y divide-line">
          {recipe.ingredients.map((ing) => (
            <li key={ing.name} className="flex items-baseline justify-between py-2.5">
              <span className="capitalize">
                {ing.name}
                {ing.optional && <span className="text-xs text-ink-soft"> (optional)</span>}
              </span>
              <span className="text-sm text-ink-soft">
                {ing.quantity} {ing.unit}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <h2 className="mt-5 mb-2 font-display text-lg">Steps</h2>
      <Card>
        <ol className="flex flex-col gap-3">
          {recipe.prepSteps
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((step) => (
              <li key={step.id} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-mist text-sm font-bold text-secondary">
                  {step.order}
                </span>
                <div>
                  <p>{step.instruction}</p>
                  <p className="text-xs text-ink-soft">
                    {step.type === 'advance' ? 'Ahead of time · ' : ''}
                    {formatOffset(step.offsetMinutes)} before serving
                    {step.durationMinutes ? ` · ${step.durationMinutes} min` : ''}
                  </p>
                </div>
              </li>
            ))}
        </ol>
      </Card>

      <h2 className="mt-5 mb-2 font-display text-lg">History</h2>
      <Card>
        <p className="text-sm font-semibold">Version {recipe.version}</p>
        {recipe.changelog.length === 0 ? (
          <p className="mt-1 text-sm text-ink-soft">No adjustments yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2 border-l-2 border-line pl-3">
            {recipe.changelog
              .slice()
              .reverse()
              .map((change, i) => (
                <li key={i}>
                  <p className="text-sm">{change.summary}</p>
                  <p className="text-xs text-ink-soft">
                    {change.date.slice(0, 10)} · {change.source === 'ai' ? 'engine' : 'manual'}
                  </p>
                </li>
              ))}
          </ul>
        )}
      </Card>
    </main>
  );
}

function formatOffset(offsetMinutes: number): string {
  const mins = Math.abs(offsetMinutes);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
