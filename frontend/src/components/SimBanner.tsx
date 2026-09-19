import { AlertTriangle } from 'lucide-react';

export function SimBanner() {
  return (
    <div className="flex items-center justify-center gap-2 bg-amber-500 dark:bg-amber-600 text-white text-xs font-medium py-1.5 px-4 z-50">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      <span>
        SIMULATION MODE — NEURAX Dataset v2 — Not live municipal data
      </span>
    </div>
  );
}
