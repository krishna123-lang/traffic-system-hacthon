import { Link } from 'react-router-dom';
import { useJourneyStore } from '../stores/journeyStore';
import { Navigation } from 'lucide-react';

export function JourneyBanner() {
  const { analysis, sourceNode, targetNode, departureTime } = useJourneyStore();
  if (!analysis) return null;
  return (
    <div className="mb-4 p-3 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 flex items-center gap-3">
      <Navigation className="w-4 h-4 text-indigo-500" />
      <span className="text-sm font-medium text-indigo-800 dark:text-indigo-300">
        Active Journey: {sourceNode} → {targetNode} · {departureTime.slice(5, 16)}
      </span>
      <Link to="/network" className="ml-auto text-xs text-indigo-600 hover:underline">View Journey →</Link>
    </div>
  );
}
