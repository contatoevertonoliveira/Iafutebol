import { NavLink } from 'react-router';
import { 
  Home, 
  TrendingUp, 
  Calendar, 
  BarChart3, 
  Bot,
  Trophy, 
  Activity,
  Globe,
  Star,
  Settings,
  Brain,
  Cpu,
  Zap,
  PanelLeftIcon
} from 'lucide-react';

export function Sidebar({ collapsed = false, onToggle }: { collapsed?: boolean; onToggle?: () => void }) {
  const navItems = [
    { to: '/', icon: Home, label: 'Início' },
    { to: '/today', icon: Calendar, label: 'Hoje' },
    { to: '/week', icon: TrendingUp, label: 'Esta Semana' },
    { to: '/month', icon: BarChart3, label: 'Este Mês' },
    { to: '/panorama', icon: Activity, label: 'Panorama do Dia' },
    { to: '/general', icon: Globe, label: 'Jogos em Geral' },
    { to: '/leagues', icon: Trophy, label: 'Ligas' },
    { to: '/agents', icon: Brain, label: 'Agentes IA' },
    { to: '/bots', icon: Bot, label: 'Bots' },
    { to: '/automation', icon: Zap, label: 'Automação' },
    { to: '/training', icon: Cpu, label: 'Treinamento' },
    { to: '/favorites', icon: Star, label: 'Favoritos' },
  ];

  return (
    <aside
      className={`bg-gradient-to-b from-gray-900 to-gray-800 text-white min-h-screen flex flex-col shrink-0 overflow-x-hidden transition-[width] duration-200 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Logo */}
      <div className={`${collapsed ? 'p-3' : 'p-6'} border-b border-gray-700`}>
        <div className={`flex ${collapsed ? 'flex-col items-center gap-3' : 'items-center justify-between gap-3'}`}>
          <div className={`flex ${collapsed ? 'flex-col items-center gap-3' : 'items-center gap-3'}`}>
            <div className="p-2 bg-blue-600 rounded-lg">
              <Brain className="w-6 h-6" />
            </div>
            {!collapsed ? (
              <div>
                <h1 className="font-bold text-xl">AI Football</h1>
                <p className="text-xs text-gray-400">Previsões Inteligentes</p>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onToggle}
            title={collapsed ? 'Expandir menu' : 'Recolher menu'}
            className="inline-flex items-center justify-center rounded-md p-2 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
          >
            <PanelLeftIcon className={`w-5 h-5 ${collapsed ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4">
        <div className="space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-4'} py-3 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                }`
              }
              title={item.label}
            >
              <item.icon className="w-5 h-5" />
              {!collapsed ? <span className="font-medium">{item.label}</span> : null}
            </NavLink>
          ))}
        </div>

        {/* Seção de Ligas Principais */}
        {!collapsed ? (
        <div className="mt-8">
          <div className="px-4 mb-3">
            <h3 className="text-xs uppercase text-gray-500 font-semibold">Ligas Principais</h3>
          </div>
          <div className="space-y-1">
            <NavLink
              to="/leagues?league=Premier%20League&country=Inglaterra"
              className="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
            >
              🏴 Premier League
            </NavLink>
            <NavLink
              to="/leagues?league=La%20Liga&country=Espanha"
              className="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
            >
              🇪🇸 La Liga
            </NavLink>
            <NavLink
              to="/leagues?league=Serie%20A&country=Itália"
              className="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
            >
              🇮🇹 Serie A
            </NavLink>
            <NavLink
              to="/leagues?league=Bundesliga&country=Alemanha"
              className="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
            >
              🇩🇪 Bundesliga
            </NavLink>
            <NavLink
              to="/leagues?league=Ligue%201&country=França"
              className="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
            >
              🇫🇷 Ligue 1
            </NavLink>
            <NavLink
              to="/leagues?league=Brasileirão%20Série%20A&country=Brasil"
              className="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
            >
              🇧🇷 Brasileirão
            </NavLink>
            <NavLink
              to="/leagues?league=UEFA%20Champions%20League"
              className="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
            >
              ⭐ Champions League
            </NavLink>
          </div>
        </div>
        ) : null}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-gray-700">
        <NavLink
          to="/settings"
          className={`flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-4'} py-3 rounded-lg text-gray-300 hover:bg-gray-700 hover:text-white transition-colors`}
          title="Configurações"
        >
          <Settings className="w-5 h-5" />
          {!collapsed ? <span className="font-medium">Configurações</span> : null}
        </NavLink>
      </div>
    </aside>
  );
}
