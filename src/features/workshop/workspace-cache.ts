export type WorkshopMemory = {
  done: string[];
  events: string[];
  steps: Record<string, number>;
  received: string[];
  resultIds: Record<string, string>;
  interrupted: string | null;
};
const key = 'e-content-workshop-v1';
export function readWorkshopMemory(): WorkshopMemory | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (
      !value ||
      !Array.isArray(value.done) ||
      !Array.isArray(value.events) ||
      !Array.isArray(value.received) ||
      !value.steps ||
      !value.resultIds ||
      typeof value.steps !== 'object' ||
      typeof value.resultIds !== 'object'
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
export function writeWorkshopMemory(value: WorkshopMemory) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Results remain available in IndexedDB and the current session. */
  }
}
