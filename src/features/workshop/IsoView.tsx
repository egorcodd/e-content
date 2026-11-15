import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { useInView, useReducedMotion } from 'motion/react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Edges, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { StatusIcon, type StatusKind } from '../../shared/ui';
import { stations, hubStations, type Station, type ViewProps } from './stations';
import { Connections } from './Connections';
import {
  connections,
  hubConnections,
  type StationId,
  type WorkshopTransfer,
  type WorkshopArrival,
} from './workflow';

const P = 1.9; // platform size
const SPREAD = 1.22;
const CLAY = '#d2d2d2';
const DARK = '#3a3a3a';
const FRAGMENT_COLORS = ['#7d91a6', '#a08794'] as const;
export type SurfaceStyle = 'contour' | 'mesh' | 'smoke';
const SurfaceContext = createContext<SurfaceStyle>('smoke');
const stateColor: Record<StatusKind, string> = {
  wait: '#454545',
  run: '#9a8cf2',
  done: '#2fbf71',
  pause: '#f2b02c',
  err: '#e5534b',
};
const OFFSET = new THREE.Vector3(10, 10, 10);
const RIGHT = new THREE.Vector3(1, 0, -1).normalize();
/** Screen position (right, down) on the iso stage → world x/z on the floor. */
function toWorld([h, v]: readonly [number, number]): [number, number] {
  const r = h * SPREAD * Math.SQRT2;
  const d = v * SPREAD * Math.sqrt(6);
  return [(r + d) / 2, (d - r) / 2];
}

/** Time that runs at full speed while live and barely drifts when idle. */
function useStationTime(live: boolean, idleRate = 0.12) {
  const t = useRef(0);
  const reduced = useReducedMotion();
  useFrame((_, dt) => {
    t.current += reduced ? 0 : Math.min(dt, 0.1) * (live ? 1 : idleRate);
  });
  return t;
}

/** Every station shares one surface treatment; no separate logo brightness or stroke. */
function Surface({ color = CLAY, tint }: { color?: string; tint?: string }) {
  const style = useContext(SurfaceContext);
  const dark = color === DARK || color === '#141414';
  return (
    <>
      <meshBasicMaterial
        color={tint ?? (dark ? '#555555' : '#b8b8b8')}
        transparent
        opacity={style === 'mesh' ? 0.07 : style === 'smoke' ? 0.095 : 0.035}
        wireframe={style === 'mesh'}
        depthWrite={false}
        toneMapped={false}
        side={THREE.DoubleSide}
      />
      <Edges
        threshold={24}
        color={tint ?? (dark ? '#777777' : '#c4c4c4')}
        lineWidth={style === 'mesh' ? 0.6 : 0.7}
        transparent
        opacity={style === 'smoke' ? 0.18 : style === 'mesh' ? 0.32 : dark ? 0.3 : 0.48}
        depthWrite={false}
        toneMapped={false}
      />
    </>
  );
}

function Base({ color = '#5a5a5a' }: { color?: string }) {
  return (
    <>
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.12}
        depthWrite={false}
        toneMapped={false}
      />
      <Edges
        threshold={30}
        color="#999999"
        transparent
        opacity={0.2}
        lineWidth={0.6}
        depthWrite={false}
      />
    </>
  );
}

function TelegramSource({ live }: { live: boolean }) {
  const t = useStationTime(live);
  const plane = useRef<THREE.Group>(null);
  const geometry = useMemo(() => {
    const tip = [0, 0.08, -0.85],
      left = [-0.72, 0, 0.55],
      right = [0.72, 0, 0.55];
    const ridge = [0, 0.24, 0.25],
      keel = [0, -0.18, 0.5];
    const mesh = new THREE.BufferGeometry();
    mesh.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [...tip, ...left, ...ridge, ...tip, ...ridge, ...right, ...tip, ...keel, ...ridge],
        3,
      ),
    );
    mesh.computeVertexNormals();
    return mesh;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame(() => {
    if (!plane.current) return;
    plane.current.position.y = 0.92 + Math.sin(t.current * 2) * (live ? 0.08 : 0.025);
    plane.current.rotation.z = Math.sin(t.current * 1.4) * 0.025;
  });
  return (
    <group ref={plane} position-y={0.92} rotation-y={-0.35}>
      <mesh geometry={geometry}>
        <Surface />
      </mesh>
    </group>
  );
}

function VideoSource({ live }: { live: boolean }) {
  const t = useStationTime(live);
  const card = useRef<THREE.Group>(null);
  const play = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-0.12, -0.17);
    shape.lineTo(0.16, 0);
    shape.lineTo(-0.12, 0.17);
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, { depth: 0.014, bevelEnabled: false });
  }, []);
  useEffect(() => () => play.dispose(), [play]);
  useFrame(() => {
    if (card.current)
      card.current.position.y = 0.82 + Math.sin(t.current * 2) * (live ? 0.06 : 0.02);
  });
  return (
    <group ref={card} position-y={0.82} rotation-y={-0.1} rotation-x={-0.12}>
      <RoundedBox args={[0.85, 1.12, 0.1]} radius={0.035} smoothness={1} bevelSegments={1}>
        <Surface />
      </RoundedBox>
      <mesh position={[0, 0, 0.058]} geometry={play}>
        <Surface />
      </mesh>
      <mesh position={[0, -0.37, 0.058]}>
        <boxGeometry args={[0.53, 0.018, 0.008]} />
        <Surface />
      </mesh>
      <mesh position={[-0.14, -0.37, 0.066]}>
        <boxGeometry args={[0.035, 0.055, 0.012]} />
        <Surface />
      </mesh>
    </group>
  );
}

function Hopper({ live }: { live: boolean }) {
  const t = useStationTime(live, 0.42);
  const fragments = useRef<(THREE.Group | null)[]>([]);
  const sheets = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(() => {
    fragments.current.forEach((fragment, i) => {
      if (!fragment) return;
      const p = (t.current * 0.7 + i / 4) % 1;
      const envelope =
        THREE.MathUtils.smoothstep(p, 0, 0.12) * (1 - THREE.MathUtils.smoothstep(p, 0.78, 1));
      fragment.position.y = 2.2 - p * 1.06;
      fragment.scale.setScalar(envelope * (live ? 1 : 0.8));
      if (sheets.current[i])
        sheets.current[i]!.rotation.set(0.18 + p * 0.45, i * 0.6 + p * 0.8, 0.1);
    });
  });
  return (
    <group position-y={0.11}>
      <RoundedBox
        args={[1.05, 0.42, 1.05]}
        radius={0.06}
        smoothness={1}
        bevelSegments={1}
        position-y={0.21}
      >
        <Surface color={DARK} />
      </RoundedBox>
      <mesh position-y={0.5}>
        <cylinderGeometry args={[0.2, 0.2, 0.18, 24]} />
        <Surface />
      </mesh>
      <mesh position-y={0.88}>
        <cylinderGeometry args={[0.62, 0.22, 0.6, 12, 2, true]} />
        <Surface />
      </mesh>
      {[0, 1, 2, 3].map((i) => (
        <group
          key={i}
          ref={(g) => void (fragments.current[i] = g)}
          position={[(i - 1.5) * 0.14, 2, i % 2 ? 0.08 : -0.08]}
        >
          <mesh ref={(m) => void (sheets.current[i] = m)}>
            <boxGeometry args={[0.18, 0.22, 0.025]} />
            <meshBasicMaterial
              color={FRAGMENT_COLORS[i % 2]}
              transparent
              opacity={0.3}
              depthWrite={false}
              toneMapped={false}
            />
            <Edges
              threshold={25}
              color={FRAGMENT_COLORS[i % 2]}
              transparent
              opacity={0.42}
              lineWidth={0.7}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          <mesh position-y={0.22}>
            <boxGeometry args={[0.008, 0.25, 0.008]} />
            <meshBasicMaterial
              color={FRAGMENT_COLORS[i % 2]}
              transparent
              opacity={0.1}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function CommentFeed({ live }: { live: boolean }) {
  const scroll = useRef(0);
  const rows = useRef<(THREE.Group | null)[]>([]);
  const inks = useRef<(THREE.MeshBasicMaterial | null)[][]>([]);
  const reduced = useReducedMotion();
  const inkRef = (row: number, part: number) => (material: THREE.MeshBasicMaterial | null) => {
    (inks.current[row] ??= [])[part] = material;
  };
  useFrame((_, dt) => {
    const delta = Math.min(dt, 0.1);
    if (reduced) scroll.current = 0;
    else if (live) scroll.current += delta * 0.85;
    else {
      const resting = Math.ceil(scroll.current);
      scroll.current = THREE.MathUtils.damp(scroll.current, resting, 9, delta);
      if (resting - scroll.current < 0.001) scroll.current = resting;
    }
    rows.current.forEach((row, i) => {
      if (!row) return;
      const slot = (i + scroll.current) % 4;
      const y = -0.59 + slot * 0.32;
      const fade =
        THREE.MathUtils.smoothstep(y, -0.5, -0.27) *
        (1 - THREE.MathUtils.smoothstep(y, 0.37, 0.53));
      row.position.y = y;
      row.visible = fade > 0.005;
      inks.current[i]?.forEach((material) => {
        if (material) material.opacity = 0.26 * fade;
      });
    });
  });
  return (
    <group position-y={0.85} rotation-y={-0.1} rotation-x={-0.06}>
      <RoundedBox args={[1.36, 1.28, 0.04]} radius={0.045} smoothness={1} bevelSegments={1}>
        <Surface />
      </RoundedBox>
      {[0, 1, 2, 3].map((i) => {
        const reply = i !== 3;
        const width = reply ? 0.57 : 0.75;
        return (
          <group
            key={i}
            ref={(row) => void (rows.current[i] = row)}
            position={[reply ? -0.33 : -0.51, -0.59 + i * 0.32, 0.026]}
          >
            <mesh position={[0, 0.04, 0]}>
              <circleGeometry args={[0.04, 20]} />
              <meshBasicMaterial
                ref={inkRef(i, 0)}
                color="#bcbcbc"
                transparent
                opacity={0}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
            {[0, 1].map((line) => (
              <mesh
                key={line}
                position={[0.1 + (line ? width * 0.68 : width) / 2, 0.055 - line * 0.1, 0]}
              >
                <planeGeometry args={[line ? width * 0.68 : width, 0.014]} />
                <meshBasicMaterial
                  ref={inkRef(i, line + 1)}
                  color="#bcbcbc"
                  transparent
                  opacity={0}
                  depthWrite={false}
                  toneMapped={false}
                />
              </mesh>
            ))}
            {reply && (
              <>
                <mesh position={[-0.12, 0.045, 0]}>
                  <planeGeometry args={[0.008, 0.2]} />
                  <meshBasicMaterial
                    ref={inkRef(i, 3)}
                    color="#bcbcbc"
                    transparent
                    opacity={0}
                    depthWrite={false}
                    toneMapped={false}
                  />
                </mesh>
                <mesh position={[-0.08, -0.05, 0]}>
                  <planeGeometry args={[0.08, 0.008]} />
                  <meshBasicMaterial
                    ref={inkRef(i, 4)}
                    color="#bcbcbc"
                    transparent
                    opacity={0}
                    depthWrite={false}
                    toneMapped={false}
                  />
                </mesh>
              </>
            )}
          </group>
        );
      })}
    </group>
  );
}

function Cluster({ live }: { live: boolean }) {
  const t = useStationTime(live);
  const orbit = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (orbit.current) orbit.current.rotation.y = t.current * 1.4;
    if (core.current) core.current.rotation.set(t.current * 0.6, t.current, 0);
  });
  return (
    <group position-y={0.11}>
      <mesh position-y={0.15}>
        <cylinderGeometry args={[0.18, 0.32, 0.3, 6]} />
        <Surface color={DARK} />
      </mesh>
      <mesh ref={core} position-y={0.85}>
        <icosahedronGeometry args={[0.36, 0]} />
        <Surface color="#eeeeee" />
      </mesh>
      <group ref={orbit} position-y={0.85}>
        {[0, 1, 2, 3].map((i) => (
          <mesh
            key={i}
            position={[
              Math.cos((i / 4) * Math.PI * 2) * 0.66,
              (i % 2) * 0.24 - 0.1,
              Math.sin((i / 4) * Math.PI * 2) * 0.66,
            ]}
          >
            <icosahedronGeometry args={[0.1 + (i % 2) * 0.04, 0]} />
            <Surface tint={i === 0 ? '#7097bc' : i === 2 ? '#b77a94' : undefined} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function MaterialFolder({ live }: { live: boolean }) {
  const t = useStationTime(live);
  const documents = useRef<THREE.Group>(null);
  const [back, front] = useMemo(() => {
    const rear = new THREE.Shape();
    rear.moveTo(-0.62, 0);
    rear.lineTo(0.62, 0);
    rear.lineTo(0.62, 0.73);
    rear.lineTo(-0.14, 0.73);
    rear.lineTo(-0.28, 0.88);
    rear.lineTo(-0.62, 0.88);
    rear.closePath();
    const flap = new THREE.Shape();
    flap.moveTo(-0.62, 0);
    flap.lineTo(0.62, 0);
    flap.lineTo(0.68, 0.65);
    flap.lineTo(-0.68, 0.65);
    flap.closePath();
    return [rear, flap].map(
      (shape) => new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: false }),
    );
  }, []);
  useEffect(
    () => () => {
      back.dispose();
      front.dispose();
    },
    [back, front],
  );
  useFrame(() => {
    if (documents.current)
      documents.current.position.y = 0.38 + Math.sin(t.current * 2.5) * (live ? 0.1 : 0.015);
  });
  return (
    <group position-y={0.18} rotation-y={-0.12}>
      <mesh geometry={back} position-z={-0.2}>
        <Surface />
      </mesh>
      <mesh position={[0, 0.02, 0.04]}>
        <boxGeometry args={[1.24, 0.025, 0.5]} />
        <Surface />
      </mesh>
      <group ref={documents} position-y={0.38}>
        {[0, 1].map((i) => (
          <group
            key={i}
            position={[i ? 0.06 : -0.05, i * 0.12, i ? 0.07 : -0.09]}
            rotation-z={i ? -0.06 : 0.06}
          >
            <mesh position-y={0.3}>
              <boxGeometry args={[0.88, 0.7, 0.014]} />
              <Surface />
            </mesh>
            {[0, 1, 2].map((row) => (
              <mesh key={row} position={[-0.08, 0.48 - row * 0.1, 0.012]}>
                <boxGeometry args={[row === 2 ? 0.32 : 0.52, 0.012, 0.006]} />
                <Surface />
              </mesh>
            ))}
          </group>
        ))}
      </group>
      <mesh geometry={front} position-z={0.24} rotation-x={0.32}>
        <Surface />
      </mesh>
    </group>
  );
}

function Bars({ live }: { live: boolean }) {
  const t = useStationTime(live);
  const bars = useRef<(THREE.Group | null)[]>([]);
  const base = [0.45, 0.8, 0.6, 1.15];
  useFrame(() => {
    bars.current.forEach((bar, i) => {
      if (bar)
        bar.scale.y = base[i] * (1 + Math.sin(t.current * 2.4 + i * 1.3) * (live ? 0.28 : 0.05));
    });
  });
  return (
    <group position-y={0.11} rotation-y={0.28}>
      {base.map((_, i) => (
        <group key={i} ref={(g) => void (bars.current[i] = g)} position={[(i - 1.5) * 0.46, 0, 0]}>
          <mesh position-y={0.5}>
            <boxGeometry args={[0.22, 1, 0.38]} />
            <Surface color={i === 3 ? '#f2f2f2' : CLAY} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function OrchestratorModel({ live }: { live: boolean }) {
  const t = useStationTime(live);
  const core = useRef<THREE.Group>(null);
  useFrame(() => {
    if (core.current) core.current.rotation.y = t.current * 0.65;
  });
  return (
    <group position-y={0.12}>
      {[0, 1, 2].map((i) => (
        <RoundedBox
          key={i}
          args={[1.18 - i * 0.1, 0.07, 1.18 - i * 0.1]}
          position-y={0.13 + i * 0.16}
          radius={0.03}
          smoothness={1}
          bevelSegments={1}
        >
          <Surface />
        </RoundedBox>
      ))}
      <group ref={core} position-y={0.95}>
        <mesh>
          <boxGeometry args={[0.5, 0.5, 0.5]} />
          <Surface />
        </mesh>
        {[0, 1, 2].map((i) => (
          <mesh key={i} rotation={[i === 0 ? Math.PI / 2 : 0, i === 1 ? Math.PI / 2 : 0, 0]}>
            <torusGeometry args={[0.47, 0.007, 4, 40]} />
            <meshBasicMaterial
              color="#bcbcbc"
              transparent
              opacity={0.22}
              toneMapped={false}
              depthWrite={false}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function Machine({ station, live }: { station: Station; live: boolean }) {
  switch (station.id) {
    case 'orchestrator':
      return <OrchestratorModel live={live} />;
    case 'telegram':
      return <TelegramSource live={live} />;
    case 'tiktok':
      return <VideoSource live={live} />;
    case 'collector':
      return <Hopper live={live} />;
    case 'comments':
      return <CommentFeed live={live} />;
    case 'ideas':
      return <Cluster live={live} />;
    case 'materials':
      return <MaterialFolder live={live} />;
    default:
      return <Bars live={live} />;
  }
}

function StationNode({
  station,
  state,
  selected,
  active,
  hovered,
  setHovered,
  choose,
}: {
  station: Station;
  state: StatusKind;
  selected: boolean;
  active: boolean;
  hovered: boolean;
  setHovered: (id: string | null) => void;
  choose: (id: string) => void;
}) {
  const [x, z] = toWorld(station.at);
  const lift = useRef<THREE.Group>(null);
  const strip = useRef<THREE.MeshBasicMaterial>(null);
  const halo = useRef<THREE.MeshBasicMaterial>(null);
  const reduced = useReducedMotion();
  useFrame(({ clock }, dt) => {
    const k = reduced ? 1 : 1 - Math.exp(-dt * 9);
    if (lift.current)
      lift.current.position.y += ((hovered || selected ? 0.16 : 0) - lift.current.position.y) * k;
    if (strip.current)
      strip.current.opacity =
        state === 'run' && !reduced ? 0.4 + Math.sin(clock.elapsedTime * 6) * 0.12 : 0.35;
    if (halo.current)
      halo.current.opacity += ((selected ? 0.09 : hovered ? 0.05 : 0) - halo.current.opacity) * k;
  });
  const color = stateColor[state];
  return (
    <group position={[x, 0, z]}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.004}>
        <planeGeometry args={[P + 0.6, P + 0.6]} />
        <meshBasicMaterial ref={halo} color="#fff" transparent opacity={0} depthWrite={false} />
      </mesh>
      <group
        ref={lift}
        onClick={(e) => {
          e.stopPropagation();
          choose(station.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(station.id);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHovered(null);
          document.body.style.cursor = '';
        }}
      >
        <RoundedBox
          args={[P, 0.09, P]}
          radius={0.025}
          smoothness={1}
          bevelSegments={1}
          position-y={0.045}
        >
          <Base />
        </RoundedBox>
        <mesh position-y={0.092}>
          <boxGeometry args={[P - 0.24, 0.003, P - 0.24]} />
          <Base color={selected ? '#888888' : '#404040'} />
        </mesh>
        <mesh position={[P / 2 + 0.004, 0.045, 0]}>
          <boxGeometry args={[0.004, 0.018, P * 0.3]} />
          <meshBasicMaterial
            ref={strip}
            color={color}
            transparent
            opacity={0.35}
            toneMapped={false}
          />
        </mesh>
        <mesh position={[0, 0.045, P / 2 + 0.004]}>
          <boxGeometry args={[P * 0.3, 0.018, 0.004]} />
          <meshBasicMaterial color={color} transparent opacity={0.35} toneMapped={false} />
        </mesh>
        <Machine station={station} live={active || hovered} />
      </group>
    </group>
  );
}

/** Orthographic iso camera that fits the floor and glides to the selected station. */
function Rig({
  focus,
  reservePanel = false,
  hub = false,
}: {
  focus: [number, number] | null;
  reservePanel?: boolean;
  hub?: boolean;
}) {
  const { camera, size } = useThree();
  const target = useRef(new THREE.Vector3(0, 0.4, 0));
  const goal = useRef(new THREE.Vector3());
  const reduced = useReducedMotion();
  const first = useRef(true);
  useFrame((_, dt) => {
    const reserved = reservePanel && size.width > 900 ? Math.min(360, size.width * 0.3) : 0;
    const fit = Math.min(
      (size.width - reserved) / (size.width < 700 && !hub ? 13.5 : 15.5),
      size.height / (hub ? 9.3 : 7.2),
    );
    const zoom = focus ? fit * 1.3 : fit;
    goal.current.set(focus ? focus[0] : 0.2, 0.45, focus ? focus[1] : 0.2);
    // keep the station clear of the fixed process panel on wide screens
    if (focus && size.width > 900) goal.current.addScaledVector(RIGHT, 210 / zoom);
    if (reserved) goal.current.addScaledVector(RIGHT, reserved / (2 * zoom));
    const k = reduced || first.current ? 1 : 1 - Math.exp(-dt * 3.2);
    first.current = false;
    target.current.lerp(goal.current, k);
    camera.zoom += (zoom - camera.zoom) * k;
    camera.position.copy(target.current).add(OFFSET);
    camera.lookAt(target.current);
    camera.updateProjectionMatrix();
  });
  return null;
}

/** Dotted floor that fades out radially — no grid lines. */
function Floor() {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1024;
    const g = canvas.getContext('2d')!;
    const glow = g.createRadialGradient(512, 512, 0, 512, 512, 512);
    glow.addColorStop(0, 'rgba(255,255,255,0.03)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, 1024, 1024);
    for (let x = 16; x < 1024; x += 32)
      for (let y = 16; y < 1024; y += 32) {
        const d = Math.hypot(x - 512, y - 512) / 512;
        if (d >= 1) continue;
        g.fillStyle = `rgba(255,255,255,${0.2 * (1 - d) ** 1.6})`;
        g.beginPath();
        g.arc(x, y, 1.7, 0, Math.PI * 2);
        g.fill();
      }
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    return map;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={-0.002}>
      <planeGeometry args={[20, 20]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

/** Pins the DOM labels under each platform's front corner every frame. */
function LabelSync({
  labels,
  items = stations,
}: {
  labels: RefObject<(HTMLButtonElement | null)[]>;
  items?: readonly Station[];
}) {
  const point = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    items.forEach((s, i) => {
      const el = labels.current[i];
      if (!el) return;
      const [x, z] = toWorld(s.at);
      point.set(x + P / 2, 0, z + P / 2).project(camera);
      el.style.transform = `translate3d(${((point.x + 1) / 2) * size.width}px, ${((1 - point.y) / 2) * size.height}px, 0)`;
      el.style.opacity = '1';
    });
  });
  return null;
}

function SceneReady({ onReady }: { onReady?: () => void }) {
  const frames = useRef(0);
  const reported = useRef(false);
  useFrame(() => {
    if (!onReady || reported.current || ++frames.current < 3) return;
    reported.current = true;
    onReady();
  });
  return null;
}

export default function IsoView({
  selected,
  active,
  states,
  choose,
  surface = 'smoke',
  transfer = null,
  arrival = null,
  fullCycle = false,
  layout = 'chain',
  transfers = [],
  arrivals = [],
  receivedCount = 0,
  onReady,
}: ViewProps & {
  surface?: SurfaceStyle;
  transfer?: WorkshopTransfer | null;
  arrival?: WorkshopArrival | null;
  fullCycle?: boolean;
  layout?: 'chain' | 'hub';
  transfers?: WorkshopTransfer[];
  arrivals?: WorkshopArrival[];
  receivedCount?: number;
  onReady?: () => void;
}) {
  const items = layout === 'hub' ? hubStations : stations;
  const edges = layout === 'hub' ? hubConnections : connections;
  const [hovered, setHovered] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const labels = useRef<(HTMLButtonElement | null)[]>([]);
  const visible = useInView(box, { margin: '120px' });
  const focusStation = items.find((s) => s.id === selected);
  const positions = useMemo(
    () =>
      Object.fromEntries(items.map((s) => [s.id, toWorld(s.at)])) as Record<
        StationId,
        [number, number]
      >,
    [layout],
  );
  useEffect(
    () => () => {
      document.body.style.cursor = '';
    },
    [],
  );
  return (
    <div ref={box} className="wg-iso" data-surface={surface} data-layout={layout}>
      <Canvas
        orthographic
        dpr={[1, 2]}
        frameloop={visible ? 'always' : 'never'}
        camera={{ position: [10, 10, 10], zoom: 70, near: -50, far: 100 }}
        gl={{ antialias: true, alpha: true }}
      >
        <SurfaceContext.Provider value={surface}>
          <Rig
            focus={!fullCycle && focusStation ? toWorld(focusStation.at) : null}
            reservePanel={fullCycle && !!selected}
            hub={layout === 'hub'}
          />
          <Floor />
          <Connections
            positions={positions}
            edges={edges}
            transfers={transfers}
            arrivals={arrivals}
            transfer={transfer}
            arrival={arrival}
            focus={hovered}
            halfSize={P / 2 + 0.06}
          />
          {items.map((s) => (
            <StationNode
              key={s.id}
              station={s}
              state={states[s.id]}
              selected={selected === s.id}
              active={active === s.id}
              hovered={hovered === s.id}
              setHovered={setHovered}
              choose={choose}
            />
          ))}
          <LabelSync labels={labels} items={items} />
          <SceneReady onReady={onReady} />
        </SurfaceContext.Provider>
      </Canvas>
      <div className="wg-iso-labels">
        {items.map((s, i) => (
          <button
            type="button"
            key={s.id}
            ref={(el) => void (labels.current[i] = el)}
            className={`wg-iso-label ${selected === s.id ? 'wg-selected' : ''} ${active === s.id ? 'wg-active' : ''} ${hovered === s.id ? 'is-hovered' : ''}`}
            aria-label={`Открыть участок ${s.name}`}
            aria-expanded={selected === s.id}
            aria-describedby={hovered === s.id ? 'wg-route-hint' : undefined}
            onClick={() => choose(s.id)}
            onFocus={() => setHovered(s.id)}
            onBlur={() => setHovered(null)}
            onPointerEnter={() => setHovered(s.id)}
            onPointerLeave={() => setHovered(null)}
          >
            <span>
              <StatusIcon kind={states[s.id]} size={14} key={states[s.id]} />
              <strong>{s.name}</strong>
            </span>
            <small>
              {s.id === 'orchestrator'
                ? receivedCount > 0
                  ? `Получено: ${receivedCount}`
                  : 'Общий результат'
                : s.sub}
            </small>
          </button>
        ))}
      </div>
      <span id="wg-route-hint" className="sr-only">
        {hovered &&
          `Входящие: ${
            edges
              .filter((edge) => edge.to === hovered)
              .map((edge) => items.find((s) => s.id === edge.from)?.name)
              .join(', ') || 'нет'
          }. Исходящие: ${
            edges
              .filter((edge) => edge.from === hovered)
              .map((edge) => items.find((s) => s.id === edge.to)?.name)
              .join(', ') || 'нет'
          }.`}
      </span>
    </div>
  );
}
