import { useMemo, useRef, useState, type RefObject } from 'react';
import { useInView, useReducedMotion } from 'motion/react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { StatusIcon, type StatusKind } from '../shared';
import { stations, type Station, type ViewProps } from './stations';

const P = 1.9; // platform size
const SPREAD = 1.22;
const CLAY = '#d2d2d2';
const DARK = '#3a3a3a';
const stateColor: Record<StatusKind, string> = {
  wait: '#2e3136',
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
function useStationTime(live: boolean) {
  const t = useRef(0);
  const reduced = useReducedMotion();
  useFrame((_, dt) => {
    t.current += reduced ? 0 : Math.min(dt, 0.1) * (live ? 1 : 0.12);
  });
  return t;
}

function Clay({
  color = CLAY,
  emissive,
  glow = 0,
}: {
  color?: string;
  emissive?: string;
  glow?: number;
}) {
  return (
    <meshStandardMaterial
      color={color}
      roughness={0.62}
      metalness={0.05}
      emissive={emissive ?? '#000'}
      emissiveIntensity={glow}
    />
  );
}

function Mast({ live, tint }: { live: boolean; tint: string }) {
  const t = useStationTime(live);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(() => {
    rings.current.forEach((ring, i) => {
      if (!ring) return;
      const p = (t.current * 0.7 + i / 3) % 1;
      ring.scale.setScalar(0.6 + p * 1.1);
      ring.position.y = 1.55 + p * 0.35;
      (ring.material as THREE.MeshStandardMaterial).opacity = (1 - p) * (live ? 0.9 : 0.35);
    });
  });
  return (
    <group position-y={0.3}>
      <mesh position-y={0.1}>
        <cylinderGeometry args={[0.42, 0.5, 0.2, 6]} />
        <Clay color={DARK} />
      </mesh>
      <mesh position-y={0.8}>
        <cylinderGeometry args={[0.05, 0.08, 1.3, 8]} />
        <Clay />
      </mesh>
      <mesh position-y={1.5}>
        <icosahedronGeometry args={[0.15, 1]} />
        <Clay color={tint} emissive={tint} glow={live ? 1.6 : 0.5} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(m) => void (rings.current[i] = m)} rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.3, 0.012, 6, 40]} />
          <meshStandardMaterial
            color={tint}
            emissive={tint}
            emissiveIntensity={1.2}
            transparent
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function Reels({ live, tint }: { live: boolean; tint: string }) {
  const t = useStationTime(live);
  const panels = useRef<(THREE.Group | null)[]>([]);
  useFrame(() => {
    panels.current.forEach((panel, i) => {
      if (panel) panel.position.y = 0.78 + Math.max(0, Math.sin(t.current * 3 - i * 0.9)) * 0.18;
    });
  });
  return (
    <group position-y={0.3} rotation-y={Math.PI / 4}>
      {[-1, 0, 1].map((n, i) => (
        <group
          key={n}
          ref={(g) => void (panels.current[i] = g)}
          position={[n * 0.42, 0.78, n * -0.06]}
          rotation-y={n * -0.12}
        >
          <RoundedBox args={[0.36, 0.66, 0.06]} radius={0.04} smoothness={3}>
            <Clay />
          </RoundedBox>
          <mesh position={[0, 0.04, 0.032]}>
            <planeGeometry args={[0.28, 0.48]} />
            <Clay color="#141414" />
          </mesh>
          <mesh position={[0, -0.25, 0.033]}>
            <planeGeometry args={[0.2, 0.025]} />
            <meshBasicMaterial color={tint} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Hopper({ live }: { live: boolean }) {
  const t = useStationTime(live);
  const cubes = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(() => {
    cubes.current.forEach((cube, i) => {
      if (!cube) return;
      const p = (t.current * 0.8 + i / 3) % 1;
      cube.position.y = 2.2 - p * 1.1;
      cube.rotation.set(p * 2, p * 3 + i, 0);
      cube.scale.setScalar(live ? Math.min(1, (1 - p) * 4) : 0.001);
    });
  });
  return (
    <group position-y={0.3}>
      <RoundedBox args={[1.05, 0.42, 1.05]} radius={0.06} smoothness={3} position-y={0.21}>
        <Clay color={DARK} />
      </RoundedBox>
      <mesh position-y={0.5}>
        <cylinderGeometry args={[0.2, 0.2, 0.18, 24]} />
        <Clay />
      </mesh>
      <mesh position-y={0.88}>
        <cylinderGeometry args={[0.62, 0.22, 0.6, 32, 1, true]} />
        <meshStandardMaterial color={CLAY} roughness={0.6} side={THREE.DoubleSide} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(m) => void (cubes.current[i] = m)} position-x={(i - 1) * 0.14}>
          <boxGeometry args={[0.16, 0.2, 0.03]} />
          <Clay color="#f4f4f4" />
        </mesh>
      ))}
    </group>
  );
}

function Bubbles({ live }: { live: boolean }) {
  const t = useStationTime(live);
  const slabs = useRef<(THREE.Group | null)[]>([]);
  useFrame(() => {
    slabs.current.forEach((slab, i) => {
      if (slab) slab.position.y = 0.42 + i * 0.32 + Math.sin(t.current * 4 + i * 1.2) * 0.05;
    });
  });
  return (
    <group position-y={0.3}>
      {[0, 1, 2].map((i) => (
        <group
          key={i}
          ref={(g) => void (slabs.current[i] = g)}
          position={[(i % 2 ? 0.14 : -0.12) * 1, 0.42 + i * 0.32, i % 2 ? -0.1 : 0.08]}
          rotation-y={i * 0.35}
        >
          <RoundedBox args={[0.95 - i * 0.12, 0.17, 0.62 - i * 0.06]} radius={0.07} smoothness={4}>
            <Clay color={i === 2 ? '#efefef' : CLAY} />
          </RoundedBox>
          <mesh position={[-0.3 + i * 0.04, -0.07, 0.32 - i * 0.03]} rotation-x={Math.PI}>
            <coneGeometry args={[0.08, 0.14, 4]} />
            <Clay color={i === 2 ? '#efefef' : CLAY} />
          </mesh>
        </group>
      ))}
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
    <group position-y={0.3}>
      <mesh position-y={0.15}>
        <cylinderGeometry args={[0.18, 0.32, 0.3, 6]} />
        <Clay color={DARK} />
      </mesh>
      <mesh ref={core} position-y={0.85}>
        <icosahedronGeometry args={[0.36, 0]} />
        <Clay color="#eeeeee" />
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
            <Clay />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function Sheets({ live }: { live: boolean }) {
  const t = useStationTime(live);
  const top = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (!top.current) return;
    const p = (t.current * 0.6) % 1;
    const eased = 1 - Math.pow(1 - Math.min(1, p * 1.6), 3);
    top.current.position.y = live ? 1.55 - eased * 0.9 : 0.65;
    top.current.rotation.y = live ? (1 - eased) * 0.8 : 0.06;
  });
  return (
    <group position-y={0.3} rotation-y={Math.PI / 4}>
      {Array.from({ length: 6 }, (_, i) => (
        <mesh key={i} position-y={0.04 + i * 0.09} rotation-y={Math.sin(i * 2.1) * 0.08}>
          <boxGeometry args={[0.78, 0.06, 1.0]} />
          <Clay color={i % 2 ? '#e6e6e6' : CLAY} />
        </mesh>
      ))}
      <mesh ref={top} position-y={0.65}>
        <boxGeometry args={[0.78, 0.06, 1.0]} />
        <Clay color="#fafafa" />
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
    <group position-y={0.3} rotation-y={Math.PI / 4}>
      {base.map((_, i) => (
        <group key={i} ref={(g) => void (bars.current[i] = g)} position={[(i - 1.5) * 0.3, 0, 0]}>
          <mesh position-y={0.5}>
            <boxGeometry args={[0.2, 1, 0.34]} />
            <Clay color={i === 3 ? '#f2f2f2' : CLAY} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Machine({ station, live }: { station: Station; live: boolean }) {
  switch (station.id) {
    case 'telegram':
      return <Mast live={live} tint={station.hex!} />;
    case 'tiktok':
      return <Reels live={live} tint={station.hex!} />;
    case 'collector':
      return <Hopper live={live} />;
    case 'comments':
      return <Bubbles live={live} />;
    case 'ideas':
      return <Cluster live={live} />;
    case 'materials':
      return <Sheets live={live} />;
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
  const strip = useRef<THREE.MeshStandardMaterial>(null);
  const halo = useRef<THREE.MeshBasicMaterial>(null);
  const reduced = useReducedMotion();
  useFrame(({ clock }, dt) => {
    const k = reduced ? 1 : 1 - Math.exp(-dt * 9);
    if (lift.current)
      lift.current.position.y += ((hovered || selected ? 0.16 : 0) - lift.current.position.y) * k;
    if (strip.current)
      strip.current.emissiveIntensity =
        state === 'run' && !reduced ? 1.4 + Math.sin(clock.elapsedTime * 6) * 0.8 : 1.3;
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
        <RoundedBox args={[P, 0.3, P]} radius={0.07} smoothness={3} position-y={0.15}>
          <Clay color="#1a1a1a" />
        </RoundedBox>
        <mesh position-y={0.302}>
          <boxGeometry args={[P - 0.24, 0.01, P - 0.24]} />
          <Clay color={selected ? '#2c2c2c' : '#202020'} />
        </mesh>
        <mesh position={[P / 2 + 0.004, 0.15, 0]}>
          <boxGeometry args={[0.01, 0.05, P * 0.5]} />
          <meshStandardMaterial
            ref={strip}
            color={color}
            emissive={color}
            emissiveIntensity={1.3}
            toneMapped={false}
          />
        </mesh>
        <mesh position={[0, 0.15, P / 2 + 0.004]}>
          <boxGeometry args={[P * 0.5, 0.05, 0.01]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={1.3}
            toneMapped={false}
          />
        </mesh>
        <Machine station={station} live={active} />
      </group>
    </group>
  );
}

/** Orthographic iso camera that fits the floor and glides to the selected station. */
function Rig({ focus }: { focus: [number, number] | null }) {
  const { camera, size } = useThree();
  const target = useRef(new THREE.Vector3(0, 0.4, 0));
  const goal = useRef(new THREE.Vector3());
  const reduced = useReducedMotion();
  const first = useRef(true);
  useFrame((_, dt) => {
    const fit = Math.min(size.width / (size.width < 700 ? 13.5 : 15.5), size.height / 7.2);
    const zoom = focus ? fit * 1.3 : fit;
    goal.current.set(focus ? focus[0] : 0.2, 0.45, focus ? focus[1] : 0.2);
    // keep the station clear of the fixed process panel on wide screens
    if (focus && size.width > 900) goal.current.addScaledVector(RIGHT, 210 / zoom);
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

function RunGlow({ at }: { at: [number, number] | null }) {
  const light = useRef<THREE.PointLight>(null);
  useFrame((_, dt) => {
    if (!light.current) return;
    light.current.intensity += ((at ? 6 : 0) - light.current.intensity) * (1 - Math.exp(-dt * 5));
    if (at) light.current.position.set(at[0] + 0.6, 1.1, at[1] + 0.6);
  });
  return <pointLight ref={light} color="#9a8cf2" intensity={0} distance={4.5} decay={1.6} />;
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
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={-0.002}>
      <planeGeometry args={[20, 20]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

/** Pins the DOM labels under each platform's front corner every frame. */
function LabelSync({ labels }: { labels: RefObject<(HTMLButtonElement | null)[]> }) {
  const point = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    stations.forEach((s, i) => {
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

export default function IsoView({ selected, active, states, choose }: ViewProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const labels = useRef<(HTMLButtonElement | null)[]>([]);
  const visible = useInView(box, { margin: '120px' });
  const focusStation = stations.find((s) => s.id === selected);
  const activeStation = stations.find((s) => s.id === active);
  return (
    <div ref={box} className="wg-iso">
      <Canvas
        orthographic
        dpr={[1, 2]}
        frameloop={visible ? 'always' : 'never'}
        camera={{ position: [10, 10, 10], zoom: 70, near: -50, far: 100 }}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.5} />
        <hemisphereLight args={['#ffffff', '#1a1a1a', 0.7]} />
        <directionalLight position={[5, 11, 3]} intensity={1.7} />
        <directionalLight position={[-7, 5, -6]} intensity={0.35} />
        <Rig focus={focusStation ? toWorld(focusStation.at) : null} />
        <RunGlow at={activeStation ? toWorld(activeStation.at) : null} />
        <Floor />
        <ContactShadows
          position-y={0.001}
          scale={26}
          resolution={1024}
          blur={2.4}
          far={2.6}
          opacity={0.7}
          color="#000000"
        />
        {stations.map((s) => (
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
        <LabelSync labels={labels} />
      </Canvas>
      <div className="wg-iso-labels">
        {stations.map((s, i) => (
          <button
            type="button"
            key={s.id}
            ref={(el) => void (labels.current[i] = el)}
            className={`wg-iso-label ${selected === s.id ? 'wg-selected' : ''} ${active === s.id ? 'wg-active' : ''} ${hovered === s.id ? 'is-hovered' : ''}`}
            style={{ ['--tint' as string]: s.tint }}
            aria-label={`Открыть участок ${s.name}`}
            aria-expanded={selected === s.id}
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
            <small>{s.sub}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
