import { createBrowserRouter } from 'react-router';
import { Layout } from './components/Layout';
import Home from './pages/HomeEnhanced';
import Settings from './pages/Settings';
import AIAgentsPage from './pages/AIAgentsPage';
import TrainingDashboard from './pages/TrainingDashboard';

function TodayPage() {
  return <Home initialSelectedDate="today" />;
}

function WeekPage() {
  return <Home initialSelectedDate="week" />;
}

function MonthPage() {
  return <Home initialSelectedDate="month" />;
}

function LeaguesPage() {
  return <Home initialSelectedDate="all" />;
}

function FavoritesPage() {
  return <Home initialSelectedDate="all" favoritesOnly={true} />;
}

function NotFound() {
  return (
    <div className="p-6 text-center">
      <h1 className="text-4xl font-bold mb-4">404</h1>
      <p className="text-gray-600">Página não encontrada.</p>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Layout,
    children: [
      { index: true, Component: Home },
      { path: 'today', Component: TodayPage },
      { path: 'week', Component: WeekPage },
      { path: 'month', Component: MonthPage },
      { path: 'leagues', Component: LeaguesPage },
      { path: 'favorites', Component: FavoritesPage },
      { path: 'agents', Component: AIAgentsPage },
      { path: 'settings', Component: Settings },
      { path: 'training', Component: TrainingDashboard },
      { path: '*', Component: NotFound },
    ],
  },
]);
