import { create } from 'zustand';

export interface DemoStoreState {
  isPlaying: boolean;
  speed: 1 | 2 | 5;
  step: number;
  totalSteps: number;
  simulationTime: string;
  scenarioId: string;
  incidentActive: boolean;
  incidentSegment: string | null;
  propagationSegments: string[];
}

interface DemoStore extends DemoStoreState {
  play: () => void;
  pause: () => void;
  reset: () => void;
  setSpeed: (speed: 1 | 2 | 5) => void;
  setStep: (step: number) => void;
  setTotalSteps: (n: number) => void;
  setSimulationTime: (t: string) => void;
  setScenarioId: (id: string) => void;
  setIncidentActive: (v: boolean) => void;
  setIncidentSegment: (id: string | null) => void;
  setPropagationSegments: (ids: string[]) => void;
  nextStep: () => void;
}

export const useDemoStore = create<DemoStore>((set) => ({
  isPlaying: false,
  speed: 1,
  step: 0,
  totalSteps: 30,
  simulationTime: '06:00',
  scenarioId: 'DEMO_MORNING_PEAK_INCIDENT',
  incidentActive: false,
  incidentSegment: null,
  propagationSegments: [],

  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  reset: () =>
    set({
      isPlaying: false,
      step: 0,
      simulationTime: '06:00',
      incidentActive: false,
      incidentSegment: null,
      propagationSegments: [],
    }),
  setSpeed: (speed) => set({ speed }),
  setStep: (step) => set({ step }),
  setTotalSteps: (totalSteps) => set({ totalSteps }),
  setSimulationTime: (simulationTime) => set({ simulationTime }),
  setScenarioId: (scenarioId) => set({ scenarioId }),
  setIncidentActive: (incidentActive) => set({ incidentActive }),
  setIncidentSegment: (incidentSegment) => set({ incidentSegment }),
  setPropagationSegments: (propagationSegments) => set({ propagationSegments }),
  nextStep: () =>
    set((s) => ({
      step: s.step < s.totalSteps - 1 ? s.step + 1 : s.step,
      isPlaying: s.step < s.totalSteps - 1 ? s.isPlaying : false,
    })),
}));
