import { createBrowserRouter } from 'react-router';
import { Layout } from './components/Layout';
import Home from './pages/HomeEnhanced';
import Settings from './pages/Settings';
import AIAgentsPage from './pages/AIAgentsPage';
import TrainingDashboard from './pages/TrainingDashboard';

// Páginas placeholder para outras rotas
function TodayPage() {
  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-4">Partidas de Hoje</h1>
      <p className="text-gray-600">Visualização focada nas partidas de hoje com previsões em tempo real.</p>
    </div>
  );
}

function WeekPage() {
  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-4">Esta Semana</h1>
      <p className="text-gray-600">Previsões para os próximos 7 dias.</p>
    </div>
  );
}

function MonthPage() {
  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-4">Este Mês</h1>
      <p className="text-gray-600">Previsões para os próximos 30 dias.</p>
    </div>
  );
}

function LeaguesPage() {
  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-4">Ligas e Campeonatos</h1>
      <p className="text-gray-600">Visualize todas as ligas disponíveis organizadas por país.</p>
    </div>
  );
}

function FavoritesPage() {
  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-4">Favoritos</h1>
      <p className="text-gray-600">Suas partidas e times favoritos em um só lugar.</p>
    </div>
  );
}

function SettingsPage() {
  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-4">Configurações</h1>
      <p className="text-gray-600">Personalize sua experiência e preferências de notificação.</p>
    </div>
  );
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