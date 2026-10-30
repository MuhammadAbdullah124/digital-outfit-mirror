import { Line } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import React, { useMemo, useRef } from "react";
import * as THREE from "three";

export interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface PoseFrame {
  timestamp: number;
  image: { width: number; height: number };
  landmarks: PoseLandmark[];
  gestures: { arm_raise: boolean; spin: boolean };
}

interface MirrorSceneProps {
  pose: PoseFrame | null;
}

type V3 = [number, number, number];

const GOLD = "#e8bc69";
const PALE_GOLD = "#ffe4a3";
const STEEL = "#52677b";
const DEEP_STEEL = "#26384d";
const CYAN = "#5cecff";
const VIOLET = "#b68cff";

function at(pose: PoseFrame | null, index: number): PoseLandmark | null {
  const point = pose?.landmarks[index];
  return point && point.visibility > 0.25 ? point : null;
}

function midpoint(a: V3, b: V3): V3 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

function distance(a: V3, b: V3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const SceneDataContext = React.createContext<PoseFrame | null>(null);

function useSceneData() {
  return React.useContext(SceneDataContext);
}

type WithPoint = { point: (index: number) => V3 | null };

function Limb({
  point,
  from,
  to,
  radius,
  color,
}: WithPoint & {
  from: number;
  to: number;
  radius: number;
  color: string;
}) {
  const start = point(from);
  const end = point(to);
  if (!start || !end) return null;
  const center = midpoint(start, end);
  const direction = new THREE.Vector3(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.clone().normalize(),
  );
  return (
    <group position={center} quaternion={quaternion}>
      <mesh>
        <cylinderGeometry args={[radius * 0.76, radius, direction.length(), 5]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh>
        <cylinderGeometry args={[radius * 1.12, radius * 1.08, direction.length() * 0.48, 5]} />
        <meshBasicMaterial color={DEEP_STEEL} />
      </mesh>
    </group>
  );
}

function Armor({ point }: WithPoint) {
  const leftShoulder = point(11);
  const rightShoulder = point(12);
  const leftHip = point(23);
  const rightHip = point(24);
  const shoulderCenter = leftShoulder && rightShoulder ? midpoint(leftShoulder, rightShoulder) : null;
  const hipCenter = leftHip && rightHip ? midpoint(leftHip, rightHip) : null;
  if (!shoulderCenter || !hipCenter) return null;
  const shoulderWidth = Math.max(0.24, distance(leftShoulder!, rightShoulder!));
  const torsoHeight = Math.max(0.38, distance(shoulderCenter, hipCenter));
  const center = midpoint(shoulderCenter, hipCenter);

  return (
    <group>
      <group position={center}>
        <mesh scale={[shoulderWidth * 0.48, torsoHeight * 0.52, shoulderWidth * 0.16]}>
          <icosahedronGeometry args={[1, 1]} />
          <meshBasicMaterial color={STEEL} />
        </mesh>
        <mesh position={[0, 0, shoulderWidth * 0.14]} scale={[shoulderWidth * 0.29, torsoHeight * 0.34, 0.035]}>
          <octahedronGeometry args={[1, 0]} />
          <meshBasicMaterial color={GOLD} />
        </mesh>
        <mesh position={[0, torsoHeight * 0.15, shoulderWidth * 0.17]} scale={[shoulderWidth * 0.06, torsoHeight * 0.16, 0.025]}>
          <coneGeometry args={[1, 1, 5]} />
          <meshBasicMaterial color={PALE_GOLD} />
        </mesh>
      </group>
      {[leftShoulder, rightShoulder].map((shoulder, index) =>
        shoulder ? (
          <group key={index} position={shoulder}>
            <mesh scale={[shoulderWidth * 0.23, shoulderWidth * 0.18, shoulderWidth * 0.2]}>
              <dodecahedronGeometry args={[1, 0]} />
              <meshBasicMaterial color={index === 0 ? DEEP_STEEL : STEEL} />
            </mesh>
            {[-1, 0, 1].map((spike) => (
              <mesh key={spike} position={[spike * shoulderWidth * 0.1, shoulderWidth * 0.16, 0]}>
                <coneGeometry args={[shoulderWidth * 0.035, shoulderWidth * 0.22, 4]} />
                <meshBasicMaterial color={PALE_GOLD} />
              </mesh>
            ))}
          </group>
        ) : null,
      )}
      <Limb point={point} from={13} to={15} radius={shoulderWidth * 0.075} color={STEEL} />
      <Limb point={point} from={14} to={16} radius={shoulderWidth * 0.075} color={STEEL} />
      {[15, 16].map((wrist) => {
        const position = point(wrist);
        return position ? (
          <mesh key={wrist} position={position} scale={[shoulderWidth * 0.085, shoulderWidth * 0.07, shoulderWidth * 0.07]}>
            <icosahedronGeometry args={[1, 0]} />
            <meshBasicMaterial color={GOLD} />
          </mesh>
        ) : null;
      })}
      <Limb point={point} from={25} to={27} radius={shoulderWidth * 0.095} color={STEEL} />
      <Limb point={point} from={26} to={28} radius={shoulderWidth * 0.095} color={STEEL} />
    </group>
  );
}

function HeadGear({ point }: WithPoint) {
  const nose = point(0);
  const leftEye = point(2);
  const rightEye = point(5);
  if (!nose) return null;
  const eyeCenter = leftEye && rightEye ? midpoint(leftEye, rightEye) : nose;
  const headWidth = leftEye && rightEye ? Math.max(0.1, distance(leftEye, rightEye) * 2.4) : 0.22;
  const top = [nose[0], nose[1] + headWidth * 1.55, nose[2]] as V3;
  return (
    <group>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[top[0] + side * headWidth * 0.31, top[1] + headWidth * 0.25, top[2]]} rotation={[0, 0, -side * 0.27]}>
          <coneGeometry args={[headWidth * 0.11, headWidth * 0.55, 5]} />
          <meshBasicMaterial color={DEEP_STEEL} />
        </mesh>
      ))}
      <mesh position={[top[0], top[1] + headWidth * 0.6, top[2]]} rotation={[0.12, 0, 0]}>
        <torusGeometry args={[headWidth * 0.42, headWidth * 0.035, 5, 28]} />
        <meshBasicMaterial color={GOLD} />
      </mesh>
      <mesh position={[eyeCenter[0], eyeCenter[1], eyeCenter[2] + 0.055]} scale={[headWidth * 0.56, headWidth * 0.16, 0.035]}>
        <octahedronGeometry args={[1, 0]} />
        <meshBasicMaterial color={CYAN} transparent opacity={0.76} />
      </mesh>
    </group>
  );
}

function BackRig({ point }: WithPoint) {
  const leftShoulder = point(11);
  const rightShoulder = point(12);
  const leftHip = point(23);
  const rightHip = point(24);
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return null;
  const neck = midpoint(leftShoulder, rightShoulder);
  const hips = midpoint(leftHip, rightHip);
  const width = Math.max(0.16, distance(leftShoulder, rightShoulder));
  const capeRef = useRef<THREE.Group>(null);
  const capeVelocity = useRef(0);
  const previous = useRef<V3>(hips);
  const flare = useSceneData()?.gestures.spin ?? false;

  useFrame((_, delta) => {
    const cape = capeRef.current;
    if (!cape) return;
    const dt = Math.min(delta, 0.05);
    const target = flare ? -0.5 : THREE.MathUtils.clamp((previous.current[0] - hips[0]) * 2.6, -0.3, 0.3);
    capeVelocity.current += (target - cape.rotation.z) * 16 * dt;
    capeVelocity.current *= Math.exp(-5.5 * dt);
    cape.rotation.z += capeVelocity.current * dt;
    previous.current = hips;
  });

  return (
    <group>
      <Line points={[neck, hips]} color={CYAN} lineWidth={2} transparent opacity={0.8} />
      <group ref={capeRef} position={neck}>
        <mesh position={[0, -distance(neck, hips) * 0.52, -0.18]} scale={[width * 0.82, distance(neck, hips) * 0.74, width * 0.035]}>
          <coneGeometry args={[1, 1, 4, 4]} />
          <meshBasicMaterial color="#6e315e" side={THREE.DoubleSide} transparent opacity={0.82} />
        </mesh>
        <mesh position={[0, -distance(neck, hips) * 0.06, -0.17]}>
          <icosahedronGeometry args={[width * 0.11, 0]} />
          <meshBasicMaterial color={GOLD} />
        </mesh>
      </group>
      <Wings point={point} />
    </group>
  );
}

function Wings({ point }: WithPoint) {
  const leftShoulder = point(11);
  const rightShoulder = point(12);
  const leftHip = point(23);
  const rightHip = point(24);
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return null;
  const origin = midpoint(leftShoulder, rightShoulder);
  const size = distance(leftShoulder, rightShoulder) * 0.72;
  const hipY = midpoint(leftHip, rightHip)[1];
  const previousY = useRef(hipY);
  const flap = useRef(0);
  const group = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const jumping = hipY - previousY.current > 0.002;
    flap.current += dt * (jumping ? 14 : 2);
    previousY.current = hipY;
    if (group.current) {
      group.current.rotation.y = Math.sin(flap.current) * (jumping ? 0.48 : 0.09);
    }
  });
  return (
    <group ref={group} position={[origin[0], origin[1] - size * 0.1, origin[2] - 0.2]}>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * size * 0.18, 0, 0]}>
          <mesh rotation={[0, 0, side * -0.32]} scale={[size * 0.45, size * 0.95, size * 0.08]}>
            <coneGeometry args={[1, 1, 5, 3]} />
            <meshBasicMaterial color="#7753a5" side={THREE.DoubleSide} transparent opacity={0.66} />
          </mesh>
          {[0, 1, 2].map((feather) => (
            <mesh key={feather} position={[side * size * (0.15 + feather * 0.12), -size * (0.18 + feather * 0.1), 0.03]} rotation={[0, 0, side * -0.26]}>
              <coneGeometry args={[size * 0.11, size * 0.55, 4]} />
              <meshBasicMaterial color={feather % 2 ? "#b68cff" : "#7f79ff"} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

interface ParticleFieldProps {
  anchors: V3[];
  color: string;
  count: number;
  spread: number;
  mode: "orb" | "smoke" | "orbit" | "dust" | "runes";
  active?: boolean;
}

function ParticleField({ anchors, color, count, spread, mode, active = true }: ParticleFieldProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const data = useMemo(
    () =>
      Array.from({ length: count }, (_, index) => ({
        angle: (index / count) * Math.PI * 2,
        offset: ((index * 37) % 101) / 101,
        speed: 0.35 + ((index * 19) % 11) * 0.07,
        scale: 0.018 + ((index * 13) % 9) * 0.004,
      })),
    [count],
  );
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const clock = useRef(0);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    clock.current += Math.min(delta, 0.05);
    const time = clock.current;
    data.forEach((particle, index) => {
      const anchor = anchors.length ? anchors[index % anchors.length] : [0, -1.5, 0];
      if (!active && mode !== "orbit") {
        dummy.position.set(0, -100, 0);
        dummy.scale.setScalar(0);
      } else {
        const phase = time * particle.speed + particle.angle;
        const radius = spread * (0.35 + particle.offset * 0.65);
        let x = anchor[0] + Math.cos(phase) * radius;
        let y = anchor[1] + Math.sin(phase * (mode === "smoke" ? 0.55 : 1)) * radius;
        let z = anchor[2] + Math.sin(phase) * radius;
        if (mode === "smoke") y += (time * particle.speed + particle.offset) % (spread * 2.4);
        if (mode === "dust") y -= (time * particle.speed + particle.offset) % spread;
        if (mode === "runes") y += Math.sin(phase * 2) * spread * 0.2;
        dummy.position.set(x, y, z);
        dummy.scale.setScalar(particle.scale * (active ? 1 : 0.3));
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <icosahedronGeometry args={[1, 0]} />
      <meshBasicMaterial color={color} transparent opacity={0.82} />
    </instancedMesh>
  );
}

function Effects({ point }: WithPoint) {
  const leftWrist = point(15);
  const rightWrist = point(16);
  const leftShoulder = point(11);
  const rightShoulder = point(12);
  const leftAnkle = point(27);
  const rightAnkle = point(28);
  const leftElbow = point(13);
  const leftHip = point(23);
  const rightHip = point(24);
  const pose = useSceneData();
  const armRaise = pose?.gestures.arm_raise ?? false;
  const spin = pose?.gestures.spin ?? false;
  const torsoCenter = leftHip && rightHip ? midpoint(leftHip, rightHip) : null;
  const wrists = [leftWrist, rightWrist].filter((value): value is V3 => value !== null);
  const shoulders = [leftShoulder, rightShoulder].filter((value): value is V3 => value !== null);
  const ankles = [leftAnkle, rightAnkle].filter((value): value is V3 => value !== null);

  return (
    <group>
      {armRaise && wrists.map((wrist, index) => (
        <group key={index}>
          <Line
            points={[
              wrist,
              [wrist[0] + 0.07, wrist[1] + 0.13, wrist[2]],
              [wrist[0] - 0.06, wrist[1] + 0.25, wrist[2] + 0.02],
              [wrist[0] + 0.04, wrist[1] + 0.37, wrist[2]],
            ]}
            color={CYAN}
            lineWidth={3}
          />
          <ParticleField anchors={[wrist]} color={CYAN} count={10} spread={0.1} mode="orb" />
        </group>
      ))}
      {wrists.length > 0 && (
        <>
          <ParticleField anchors={wrists} color={VIOLET} count={14} spread={0.22} mode="dust" />
          <ParticleField anchors={wrists} color="#ff9d67" count={12} spread={0.16} mode="orb" active={armRaise} />
        </>
      )}
      {shoulders.length > 0 && (
        <ParticleField anchors={shoulders} color="#9befff" count={18} spread={0.2} mode="orbit" />
      )}
      {ankles.length > 0 && (
        <ParticleField anchors={ankles} color="#a78bca" count={18} spread={0.12} mode="smoke" />
      )}
      {leftElbow && (
        <group position={leftElbow} rotation={[0, 0, -0.4]}>
          <mesh>
            <torusGeometry args={[0.17, 0.018, 5, 24]} />
            <meshBasicMaterial color={CYAN} transparent opacity={0.75} />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <circleGeometry args={[0.15, 6]} />
            <meshBasicMaterial color={CYAN} transparent opacity={0.14} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}
      {torsoCenter && (
        <>
          <mesh position={[torsoCenter[0], torsoCenter[1], torsoCenter[2] - 0.24]} rotation={[0, 0, 0]}>
            <torusGeometry args={[0.34, 0.012, 4, 48]} />
            <meshBasicMaterial color={GOLD} transparent opacity={0.65} />
          </mesh>
          <ParticleField anchors={[torsoCenter]} color={PALE_GOLD} count={12} spread={0.3} mode="runes" />
        </>
      )}
      {ankles.length > 0 && (
        <mesh
          position={[
            (ankles[0][0] + (ankles[1]?.[0] ?? ankles[0][0])) / 2,
            Math.min(...ankles.map((ankle) => ankle[1])) - 0.08,
            (ankles[0][2] + (ankles[1]?.[2] ?? ankles[0][2])) / 2,
          ]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.2, 0.26, 40]} />
          <meshBasicMaterial color={VIOLET} transparent opacity={0.68} side={THREE.DoubleSide} />
        </mesh>
      )}
      {spin && (
        <ParticleField
          anchors={[...(shoulders.length ? shoulders : []), ...(torsoCenter ? [torsoCenter] : [])]}
          color={PALE_GOLD}
          count={28}
          spread={0.55}
          mode="dust"
        />
      )}
    </group>
  );
}

function SceneContent({ pose }: { pose: PoseFrame | null }) {
  const { viewport } = useThree();
  const imageAspect =
    pose?.image.width && pose.image.height
      ? pose.image.width / pose.image.height
      : viewport.width / viewport.height;
  const fittedWidth = Math.min(viewport.width, viewport.height * imageAspect);
  const fittedHeight = fittedWidth / imageAspect;
  const scale = Math.min(viewport.width, viewport.height) / 6;
  const logicalWidth = fittedWidth / scale;
  const logicalHeight = fittedHeight / scale;
  const point = (index: number): V3 | null => {
    const landmark = at(pose, index);
    if (!landmark) return null;
    return [
      ((1 - landmark.x) - 0.5) * logicalWidth,
      (0.5 - landmark.y) * logicalHeight,
      -landmark.z * logicalWidth * 0.65,
    ];
  };

  return (
    <SceneDataContext.Provider value={pose}>
      <group scale={scale}>
        <group>
          <Armor point={point} />
          <HeadGear point={point} />
          <BackRig point={point} />
          <Effects point={point} />
        </group>
      </group>
    </SceneDataContext.Provider>
  );
}

export default function MirrorScene({ pose }: MirrorSceneProps) {
  return (
    <div className="scene-overlay" aria-hidden="true">
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 0, 10], fov: 45 }}
        gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
        }}
      >
        <SceneContent pose={pose} />
      </Canvas>
    </div>
  );
}
