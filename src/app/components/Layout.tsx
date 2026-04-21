import { Outlet } from 'react-router';
import { Sidebar } from './Sidebar';
import { MobileHeader } from './MobileHeader';
import { MobileBottomNav } from './MobileBottomNav';

export function Layout() {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <div className="hidden md:block">
        <Sidebar />
      </div>
      <main className="flex-1 overflow-x-hidden pb-20 md:pb-0">
        <MobileHeader />
        <Outlet />
      </main>
      <MobileBottomNav />
    </div>
  );
}
