import { Sun, Moon, Bell, Wifi } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { useQuery } from '@tanstack/react-query';
import { healthCheck } from '../api/client';
import clsx from 'clsx';

interface Props {
  title: string;
}

export function Header({ title }: Props) {
  const { theme, toggleTheme } = useTheme();
  const { data: health, isError } = useQuery({
    queryKey: ['health'],
    queryFn: healthCheck,
    refetchInterval: 30000,
    retry: false,
  });

  const connected = !isError && health?.status === 'ok';

  return (
    <header className="h-14 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex items-center justify-between px-6 shrink-0">
      <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h1>

      <div className="flex items-center gap-3">
        {/* API Health */}
        <div
          className={clsx(
            'flex items-center gap-1.5 text-xs px-2 py-1 rounded-full',
            connected
              ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30'
              : 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30'
          )}
        >
          <Wifi className="w-3 h-3" />
          <span>{connected ? 'API Connected' : 'API Offline'}</span>
        </div>

        {/* Notifications */}
        <button className="relative p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors">
          <Bell className="w-4 h-4" />
        </button>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
          aria-label="Toggle theme"
        >
          {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
        </button>
      </div>
    </header>
  );
}
