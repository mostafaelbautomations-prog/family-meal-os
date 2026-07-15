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

export default function App() {
  const location = useLocation();
  const inCookMode = location.pathname.startsWith('/cook/');
  return (
    <div className="mx-auto min-h-dvh max-w-md">
      <BackgroundEffects />
      {!inCookMode && <InstallBanner />}
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
      </Routes>
      {!inCookMode && <TabBar />}
    </div>
  );
}
