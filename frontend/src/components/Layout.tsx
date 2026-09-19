import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { SimBanner } from './SimBanner';
import { DemoControls } from './DemoControls';

const PAGE_TITLES: Record<string, string> = {
  '/': 'Command Center',
  '/network': 'Live Network',
  '/forecast': 'Forecast Intelligence',
  '/incidents': 'Incident Intelligence',
  '/diversion': 'Diversion Advisor',
  '/bottlenecks': 'Bottleneck Analytics',
  '/planning': 'Planning Lab',
  '/performance': 'Model Performance',
  '/data-health': 'Data Health',
};

export function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const title = PAGE_TITLES[location.pathname] ?? 'FlowGuard AI';

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
      <SimBanner />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
        <div className="flex flex-col flex-1 overflow-hidden">
          <Header title={title} />
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
      <DemoControls />
    </div>
  );
}
