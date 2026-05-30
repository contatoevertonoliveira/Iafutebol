import { NavLink } from 'react-router';
import { 
  Home, 
  Bot,
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
    { to: '/panorama', icon: Activity, label: 'Panorama do Dia' },
    { to: '/general', icon: Globe, label: 'Jogos em Geral' },
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
