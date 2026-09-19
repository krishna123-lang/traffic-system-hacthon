import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Radio, TrendingUp, AlertTriangle,
  Navigation, BarChart2, FlaskConical, Activity,
  Database, ChevronLeft, ChevronRight, Zap
} from 'lucide-react';
import clsx from 'clsx';
import { useJourneyStore } from '../stores/journeyStore';

const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Command Center' },
  { to: '/network', icon: Radio, label: 'Live Network' },
  { to: '/forecast', icon: TrendingUp, label: 'Forecast' },
  { to: '/incidents', icon: AlertTriangle, label: 'Incidents' },
  { to: '/diversion', icon: Navigation, label: 'Diversion Advisor' },
  { to: '/bottlenecks', icon: BarChart2, label: 'Bottleneck Analytics' },
  { to: '/planning', icon: FlaskConical, label: 'Planning Lab' },
  { to: '/performance', icon: Activity, label: 'Model Performance' },
  { to: '/data-health', icon: Database, label: 'Data Health' },
];

interface Props {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: Props) {
  const location = useLocation();
  const { analysis, sourceNode, targetNode } = useJourneyStore();

  return (
    <aside
      className={clsx(
        'flex flex-col bg-gray-900 text-white transition-all duration-300 ease-in-out shrink-0',
        collapsed ? 'w-16' : 'w-56'
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-4 border-b border-gray-700">
        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shrink-0">
          <Zap className="w-4 h-4 text-white" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-sm font-bold truncate">FlowGuard AI</div>
            <div className="text-[10px] text-gray-400 truncate">Traffic Intelligence</div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 space-y-0.5 px-2">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
          const active = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              title={collapsed ? label : undefined}
              className={clsx(
                'flex items-center gap-3 px-2 py-2 rounded-lg text-sm font-medium transition-colors',
                active
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              )}
            >
              <div className="relative">
                <Icon className="w-4 h-4 shrink-0" />
                {to === '/network' && analysis && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full border border-gray-900" />
                )}
              </div>
              {!collapsed && <span className="truncate flex-1">{label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Mini Journey Summary */}
      {analysis && !collapsed && (
        <div className="mx-3 mb-3 p-3 rounded-xl bg-gray-800 border border-gray-700">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1 font-semibold flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Active Journey
          </p>
          <p className="text-xs font-mono font-bold text-gray-200">{sourceNode} → {targetNode}</p>
        </div>
      )}

      {/* Collapse toggle */}
      <button
        onClick={onToggle}
        className="flex items-center justify-center p-3 border-t border-gray-700 hover:bg-gray-700 transition-colors text-gray-400 hover:text-white"
      >
        {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>
    </aside>
  );
}
