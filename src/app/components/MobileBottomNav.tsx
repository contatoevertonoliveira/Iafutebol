import { NavLink } from 'react-router';
import { ChartLine, Home, Trophy, User } from 'lucide-react';

export function MobileBottomNav() {
  const items = [
    { to: '/', label: 'Jogos', icon: Home },
    { to: '/panorama', label: 'Análises', icon: ChartLine },
    { to: '/leagues', label: 'Ligas', icon: Trophy },
    { to: '/settings', label: 'Perfil', icon: User },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 md:hidden">
      <div className="h-16 px-2 grid grid-cols-4">
        {items.map((item) => (
          <NavLink
            key={item.label}
            to={item.to}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-1 rounded-lg ${
                isActive ? 'text-blue-700' : 'text-gray-500'
              }`
            }
          >
            <item.icon className="w-5 h-5" />
            <span className="text-[11px] font-semibold">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
