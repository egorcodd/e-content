import type { Station } from './stations';
import { stations } from './stations';

export type StationId = Station['id'];
export const connections = [
  { from: 'telegram', to: 'collector' },
  { from: 'tiktok', to: 'collector' },
  { from: 'collector', to: 'comments' },
  { from: 'comments', to: 'ideas' },
  { from: 'ideas', to: 'materials' },
  { from: 'materials', to: 'analytics' },
] as const satisfies ReadonlyArray<{ from: StationId; to: StationId }>;
export type WorkshopConnection = { from: StationId; to: StationId };
export const hubConnections: readonly WorkshopConnection[] = [
  ...connections,
  ...stations.map((station) => ({ from: station.id, to: 'orchestrator' as const })),
];

export type WorkshopTransfer = {
  from: StationId;
  to: StationId;
  startedAt: number;
  duration: number;
};

export type WorkshopArrival = Pick<WorkshopTransfer, 'from' | 'to'> & { receivedAt: number };

/** Aborting processing or a handoff uses the same controller and removes its listener. */
export function waitForStage(duration: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, duration);
    signal.addEventListener('abort', finish, { once: true });
  });
}
