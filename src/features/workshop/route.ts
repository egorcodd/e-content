import * as THREE from 'three';
import type { StationId } from './workflow';
export type Positions = Record<StationId, readonly [number, number]>;

function createRoute(
  a: readonly [number, number],
  b: readonly [number, number],
  halfSize: number,
  radial = false,
) {
  const dx = b[0] - a[0],
    dz = b[1] - a[1];
  const xAxis = Math.abs(dx) > Math.abs(dz);
  const offset = new THREE.Vector3(
    xAxis ? Math.sign(dx) * halfSize : 0,
    0,
    xAxis ? 0 : Math.sign(dz) * halfSize,
  );
  if (radial) offset.set(dx, 0, dz).multiplyScalar(halfSize / Math.max(Math.abs(dx), Math.abs(dz)));
  const start = new THREE.Vector3(a[0], 0.06, a[1]).add(offset);
  const end = new THREE.Vector3(b[0], 0.06, b[1]).sub(offset);
  const handle = Math.max(
    0.2,
    (xAxis ? Math.abs(end.x - start.x) : Math.abs(end.z - start.z)) * 0.55,
  );
  const direction = offset.clone().normalize().multiplyScalar(handle);
  return new THREE.CubicBezierCurve3(
    start,
    start.clone().add(direction),
    end.clone().sub(direction),
    end,
  );
}

export function createWorkshopRoute(
  from: StationId,
  to: StationId,
  positions: Positions,
  halfSize: number,
): THREE.Curve<THREE.Vector3> {
  if (from === 'collector' && to === 'analytics' && positions.orchestrator) {
    const a = positions[from],
      b = positions[to],
      c = positions.orchestrator;
    const right = new THREE.Vector3(1, 0, -1).normalize();
    const down = new THREE.Vector3(1, 0, 1).normalize();
    const start = new THREE.Vector3(a[0], 0.06, a[1] + halfSize);
    const end = new THREE.Vector3(b[0], 0.06, b[1] - halfSize);
    const outer = new THREE.Vector3(c[0], 0.06, c[1])
      .addScaledVector(right, halfSize * 2)
      .addScaledVector(down, halfSize * 1.25);
    const lower = new THREE.Vector3(c[0], 0.06, c[1])
      .addScaledVector(right, halfSize * 0.45)
      .addScaledVector(down, halfSize * 3.5);
    return new THREE.CatmullRomCurve3([start, outer, lower, end], false, 'centripetal');
  }
  return createRoute(positions[from], positions[to], halfSize, to === 'orchestrator');
}
