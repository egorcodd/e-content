import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { useReducedMotion } from 'motion/react';
import * as THREE from 'three';
import type { Line2, LineSegments2 } from 'three-stdlib';
import {
  connections,
  type StationId,
  type WorkshopTransfer,
  type WorkshopArrival,
  type WorkshopConnection,
} from './workflow';

type Positions = Record<StationId, readonly [number, number]>;

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

function Route({
  from,
  to,
  positions,
  transfer,
  arrival,
  focus,
  halfSize,
}: {
  from: StationId;
  to: StationId;
  positions: Positions;
  transfer: WorkshopTransfer | null;
  arrival: WorkshopArrival | null;
  focus: string | null;
  halfSize: number;
}) {
  const route = useMemo(
    () => createRoute(positions[from], positions[to], halfSize, to === 'orchestrator'),
    [positions, from, to, halfSize],
  );
  const points = useMemo(() => route.getPoints(48), [route]);
  const arrow = useMemo(() => {
    const point = route.getPointAt(0.6);
    const direction = route.getTangentAt(0.6).multiplyScalar(0.12);
    const side = new THREE.Vector3(-direction.z, 0, direction.x).multiplyScalar(0.48);
    return [point.clone().sub(direction).add(side), point, point.clone().sub(direction).sub(side)];
  }, [route]);
  const packet = useRef<THREE.Group>(null);
  const line = useRef<Line2 | LineSegments2>(null);
  const arrowLine = useRef<Line2 | LineSegments2>(null);
  const ports = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const pulse = useRef<THREE.Mesh>(null);
  const reduced = useReducedMotion();
  const active = transfer?.from === from && transfer.to === to;
  const related = focus === from || focus === to;
  useFrame((_, dt) => {
    const opacity = active ? 0.82 : focus ? (related ? 0.66 : 0.13) : 0.34;
    const arrowOpacity = active ? 0.82 : focus ? (related ? 0.72 : 0.16) : 0.42;
    const fade = (material: { opacity: number } | undefined | null, target: number) => {
      if (material)
        material.opacity = reduced
          ? target
          : THREE.MathUtils.damp(material.opacity, target, 9, Math.min(dt, 0.1));
    };
    fade(line.current?.material, opacity);
    fade(arrowLine.current?.material, arrowOpacity);
    const age =
      arrival?.from === from && arrival.to === to
        ? (performance.now() - arrival.receivedAt) / 520
        : 2;
    const received = age >= 0 && age < 1;
    ports.current.forEach((port, i) =>
      fade(
        port,
        i === 1 && received ? 0.85 : active ? 0.7 : focus ? (related ? 0.65 : 0.16) : 0.38,
      ),
    );
    if (pulse.current) {
      pulse.current.visible = received;
      if (received) {
        pulse.current.scale.setScalar(reduced ? 1.8 : 0.8 + 2.3 * (1 - Math.pow(1 - age, 3)));
        (pulse.current.material as THREE.MeshBasicMaterial).opacity = reduced
          ? 0.25
          : 0.5 * Math.pow(1 - age, 1.5);
      }
    }
    if (!packet.current) return;
    if (!active || !transfer || reduced) {
      packet.current.visible = false;
      return;
    }
    const progress = THREE.MathUtils.clamp(
      (performance.now() - transfer.startedAt) / transfer.duration,
      0,
      1,
    );
    const eased = progress * progress * (3 - 2 * progress);
    packet.current.visible = progress < 1;
    packet.current.position.copy(route.getPointAt(eased));
    const tangent = route.getTangentAt(eased);
    packet.current.rotation.y = Math.atan2(tangent.x, tangent.z);
    packet.current.scale.setScalar(Math.min(1, progress * 8, (1 - progress) * 8));
  });
  return (
    <group>
      <Line
        ref={line}
        dashed={to === 'orchestrator'}
        dashSize={0.09}
        gapSize={0.11}
        points={points}
        color="#a4a4a4"
        lineWidth={1}
        transparent
        opacity={0.34}
        depthWrite={false}
        toneMapped={false}
      />
      <Line
        ref={arrowLine}
        points={arrow}
        color="#bcbcbc"
        lineWidth={1}
        transparent
        opacity={0.42}
        depthWrite={false}
        toneMapped={false}
      />
      {[points[0], points[points.length - 1]].map((point, i) => (
        <mesh key={i} position={point} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.025, 0.04, 16]} />
          <meshBasicMaterial
            ref={(material) => void (ports.current[i] = material)}
            color="#bcbcbc"
            transparent
            opacity={0.38}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
      <mesh
        ref={pulse}
        visible={false}
        position={points[points.length - 1]}
        rotation-x={-Math.PI / 2}
      >
        <ringGeometry args={[0.06, 0.075, 32]} />
        <meshBasicMaterial
          color="#d2d2d2"
          transparent
          opacity={0}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <group ref={packet} visible={false}>
        <mesh rotation-x={-Math.PI / 2} position-y={0.012}>
          <planeGeometry args={[0.075, 0.105]} />
          <meshBasicMaterial
            color="#dedede"
            transparent
            opacity={0.85}
            side={THREE.DoubleSide}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh rotation-x={-Math.PI / 2}>
          <circleGeometry args={[0.12, 24]} />
          <meshBasicMaterial
            color="#c8c8c8"
            transparent
            opacity={0.07}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  );
}

export function Connections({
  positions,
  transfer,
  arrival,
  focus,
  halfSize,
  edges = connections,
  transfers = [],
  arrivals = [],
}: {
  positions: Positions;
  transfer: WorkshopTransfer | null;
  arrival: WorkshopArrival | null;
  focus: string | null;
  halfSize: number;
  edges?: readonly WorkshopConnection[];
  transfers?: WorkshopTransfer[];
  arrivals?: WorkshopArrival[];
}) {
  return (
    <group>
      {edges.map((edge) => (
        <Route
          key={edge.from + '-' + edge.to}
          {...edge}
          positions={positions}
          transfer={
            transfers.find((item) => item.from === edge.from && item.to === edge.to) ?? transfer
          }
          arrival={
            arrivals.find((item) => item.from === edge.from && item.to === edge.to) ?? arrival
          }
          focus={focus}
          halfSize={halfSize}
        />
      ))}
    </group>
  );
}
