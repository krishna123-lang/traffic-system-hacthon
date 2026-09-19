import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Suspense, lazy } from 'react';

const CommandCenter = lazy(() => import('./pages/CommandCenter'));
const LiveNetwork = lazy(() => import('./pages/LiveNetwork'));
const ForecastIntelligence = lazy(() => import('./pages/ForecastIntelligence'));
const IncidentIntelligence = lazy(() => import('./pages/IncidentIntelligence'));
const DiversionAdvisor = lazy(() => import('./pages/DiversionAdvisor'));
const BottleneckAnalytics = lazy(() => import('./pages/BottleneckAnalytics'));
const PlanningLab = lazy(() => import('./pages/PlanningLab'));
const ModelPerformance = lazy(() => import('./pages/ModelPerformance'));
const DataHealth = lazy(() => import('./pages/DataHealth'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30000,
      refetchOnWindowFocus: false,
    },
  },
});

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-400 dark:text-gray-500">Loading...</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={
                <Suspense fallback={<PageLoader />}><CommandCenter /></Suspense>
              } />
              <Route path="network" element={
                <Suspense fallback={<PageLoader />}><LiveNetwork /></Suspense>
              } />
              <Route path="forecast" element={
                <Suspense fallback={<PageLoader />}><ForecastIntelligence /></Suspense>
              } />
              <Route path="incidents" element={
                <Suspense fallback={<PageLoader />}><IncidentIntelligence /></Suspense>
              } />
              <Route path="diversion" element={
                <Suspense fallback={<PageLoader />}><DiversionAdvisor /></Suspense>
              } />
              <Route path="bottlenecks" element={
                <Suspense fallback={<PageLoader />}><BottleneckAnalytics /></Suspense>
              } />
              <Route path="planning" element={
                <Suspense fallback={<PageLoader />}><PlanningLab /></Suspense>
              } />
              <Route path="performance" element={
                <Suspense fallback={<PageLoader />}><ModelPerformance /></Suspense>
              } />
              <Route path="data-health" element={
                <Suspense fallback={<PageLoader />}><DataHealth /></Suspense>
              } />
            </Route>
          </Routes>
        </ErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
