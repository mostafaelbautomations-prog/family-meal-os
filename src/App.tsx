import { Route, Routes, useLocation } from 'react-router-dom';
import { TabBar } from './components/TabBar';
import { InstallBanner } from './components/InstallBanner';
import { BackgroundEffects } from './components/BackgroundEffects';
import { TodayScreen } from './screens/Today';
import { WeekScreen } from './screens/Week';
import { LogScreen } from './screens/Log';
import { GroceryScreen } from './screens/Grocery';
import { SettingsScreen } from './screens/Settings';
import { RecipeDetailScreen } from './screens/RecipeDetail';
import { CookModeScreen } from './screens/CookMode';
import { GenerateScreen } from './screens/Generate';
import { ChefScreen } from './screens/Chef';
import { RateScreen, RateReturnScreen } from './screens/Rate';

export default function App() {
  const location = useLocation();
  const inCookMode = location.pathname.startsWith('/cook/');
  // /rate is opened on family members' phones from a shared link — no nav,
  // no install banner, just the form.
  const inRateFlow = location.pathname.startsWith('/rate');
  const chromeless = inCookMode || inRateFlow;
  return (
    <div className="mx-auto min-h-dvh max-w-md">
      <BackgroundEffects />
      {!chromeless && <InstallBanner />}
      <Routes>
        <Route path="/" element={<TodayScreen />} />
        <Route path="/week" element={<WeekScreen />} />
        <Route path="/log" element={<LogScreen />} />
        <Route path="/grocery" element={<GroceryScreen />} />
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="/recipe/:id" element={<RecipeDetailScreen />} />
        <Route path="/cook/:plannedMealId" element={<CookModeScreen />} />
        <Route path="/generate" element={<GenerateScreen />} />
        <Route path="/chef" element={<ChefScreen />} />
        <Route path="/rate" element={<RateScreen />} />
        <Route path="/rate/return" element={<RateReturnScreen />} />
      </Routes>
      {!chromeless && <TabBar />}
    </div>
  );
}
