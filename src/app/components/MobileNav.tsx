import { NavLink } from 'react-router';
import {
  Activity,
  BarChart3,
  Brain,
  Calendar,
  Cpu,
  Home,
  Menu,
  Settings,
  Star,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetClose } from './ui/sheet';

export function MobileNav() {
  const navItems = [
    { to: '/', icon: Home, label: 'Início' },
    { to: '/today', icon: Calendar, label: 'Hoje' },
    { to: '/week', icon: TrendingUp, label: 'Esta Semana' },
    { to: '/month', icon: BarChart3, label: 'Este Mês' },
    { to: '/panorama', icon: Activity, label: 'Panorama do Dia' },
    { to: '/leagues', icon: Trophy, label: 'Ligas' },
    { to: '/agents', icon: Brain, label: 'Agentes IA' },
    { to: '/training', icon: Cpu, label: 'Treinamento' },
    { to: '/favorites', icon: Star, label: 'Favoritos' },
  ];

  return (
    <div className="sticky top-0 z-40 bg-white border-b border-gray-200">
      <div className="h-14 px-4 flex items-center justify-between">
        <Sheet>
          <SheetTrigger asChild>
            <button
              className="p-2 rounded-md hover:bg-gray-100"
              aria-label="Abrir menu"
              title="Menu"
            >
              <Menu className="w-5 h-5" />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0">
            <SheetHeader className="border-b">
              <SheetTitle>AI Football</SheetTitle>
            </SheetHeader>
            <nav className="p-3 space-y-1">
              {navItems.map((item) => (
                <SheetClose key={item.to} asChild>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-3 rounded-lg transition-colors ${
                        isActive ? 'bg-blue-600 text-white' : 'text-gray-800 hover:bg-gray-100'
                      }`
                    }
                  >
                    <item.icon className="w-5 h-5" />
                    <span className="font-medium">{item.label}</span>
                  </NavLink>
                </SheetClose>
              ))}
            </nav>
            <div className="p-3 border-t">
              <SheetClose asChild>
                <NavLink
                  to="/settings"
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-3 rounded-lg transition-colors ${
                      isActive ? 'bg-blue-600 text-white' : 'text-gray-800 hover:bg-gray-100'
                    }`
                  }
                >
                  <Settings className="w-5 h-5" />
                  <span className="font-medium">Configurações</span>
                </NavLink>
              </SheetClose>
            </div>
          </SheetContent>
        </Sheet>

        <div className="flex items-center gap-2">
          <div className="p-2 bg-blue-600 rounded-lg">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <div className="leading-tight">
            <div className="font-bold text-gray-900">AI Football</div>
            <div className="text-xs text-gray-500">Previsões Inteligentes</div>
          </div>
        </div>

        <NavLink
          to="/settings"
          className="p-2 rounded-md hover:bg-gray-100"
          aria-label="Configurações"
          title="Configurações"
        >
          <Settings className="w-5 h-5" />
        </NavLink>
      </div>
    </div>
  );
}

