import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend
} from 'recharts';
import type { ForecastHorizon } from '../api/client';
import { getCongestionColor } from '../lib/congestion';

interface HistoricalPoint {
  timestamp: string;
  score: number;
}

interface Props {
  historical?: HistoricalPoint[];
  horizons?: ForecastHorizon[];
  loading?: boolean;
  height?: number;
}

interface ChartPoint {
  label: string;
  score?: number;
  forecast?: number;
  low?: number;
  high?: number;
  isForecast?: boolean;
}

export function ForecastChart({ historical, horizons, loading, height = 260 }: Props) {
  if (loading) {
    return <div className="skeleton rounded-lg" style={{ height }} />;
  }

  const data: ChartPoint[] = [];

  // Historical points (API does NOT return historical — but keep for future)
  if (historical?.length) {
    historical.slice(-20).forEach((h) => {
      const label = (() => {
        try { return new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
        catch { return h.timestamp; }
      })();
      data.push({ label, score: Number((h.score ?? 0).toFixed(3)) });
    });
  }

  // Forecast points — API returns: horizon_minutes, predicted_value, congestion_state, lower_bound, upper_bound
  if (horizons?.length) {
    if (data.length === 0) {
      // Anchor point using current predicted value
      data.push({ label: 'Now', score: horizons[0]?.predicted_value });
    }
    horizons.forEach((h) => {
      const val = h.predicted_value ?? 0;
      data.push({
        label: `+${h.horizon_minutes}m`,
        forecast: Number(val.toFixed(3)),
        low: Number((h.lower_bound ?? val * 0.9).toFixed(3)),
        high: Number((h.upper_bound ?? val * 1.1).toFixed(3)),
        isForecast: true,
      });
    });
  }

  if (!data.length) {
    return (
      <div className="flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm" style={{ height }}>
        No forecast data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="confBand" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f97316" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#f97316" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(107,114,128,0.2)" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="rgba(107,114,128,0.5)" />
        <YAxis domain={[0, 1]} tickCount={6} tick={{ fontSize: 11 }} stroke="rgba(107,114,128,0.5)" />
        <Tooltip
          contentStyle={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            fontSize: 12,
          }}
          formatter={(val: number, name: string) => [(val ?? 0).toFixed(3), name]}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <ReferenceLine y={0.6} stroke="#f97316" strokeDasharray="4 3" label={{ value: 'High', fill: '#f97316', fontSize: 10 }} />
        <ReferenceLine y={0.75} stroke="#ef4444" strokeDasharray="4 3" label={{ value: 'Severe', fill: '#ef4444', fontSize: 10 }} />
        <Area
          type="monotone"
          dataKey="score"
          name="Historical"
          stroke="#4f46e5"
          fill="url(#scoreGrad)"
          strokeWidth={2}
          dot={false}
          connectNulls
        />
        <Area
          type="monotone"
          dataKey="high"
          name="Conf. High"
          stroke="transparent"
          fill="url(#confBand)"
          strokeWidth={0}
          dot={false}
          connectNulls
          legendType="none"
        />
        <Area
          type="monotone"
          dataKey="low"
          name="Conf. Low"
          stroke="transparent"
          fill="transparent"
          strokeWidth={0}
          dot={false}
          connectNulls
          legendType="none"
        />
        <Area
          type="monotone"
          dataKey="forecast"
          name="Forecast"
          stroke="#f97316"
          fill="url(#forecastGrad)"
          strokeWidth={2}
          strokeDasharray="5 3"
          dot={{ r: 4, fill: '#f97316' }}
          connectNulls
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
