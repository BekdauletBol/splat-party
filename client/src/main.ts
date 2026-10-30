// M1: local sandbox. One character, Rapier motor from shared/, over-the-shoulder camera.
import * as THREE from 'three';
import { Btn, CAMERA, CAPSULE_FOOT, MAPS, TICK_DT, buildMapWorld, initPhysics, makeMotorState, raycastStatic, stepMotor } from '@splat/shared';
import { buildMapView, buildSky } from './render/mapView';
import { part } from './render/toon';

async function start(): Promise<void> {
  await initPhysics();
  const map = MAPS[new URLSearchParams(location.search).get('map') ?? 'kitchen'] ?? MAPS.kitchen;
  const mw = buildMapWorld(map);

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(map.fog, 70, 240);
  scene.add(buildSky(map), buildMapView(map));
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb0a890, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(30, 60, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, far: 160 });
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 800);

  const body = part(new THREE.SphereGeometry(0.75, 24, 16), 0xffd23f);
  scene.add(body);

  const resize = (): void => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();

  const keys = new Set<string>();
  addEventListener('keydown', (e) => keys.add(e.code));
  addEventListener('keyup', (e) => keys.delete(e.code));
  let yaw = 0;
  let pitch = -0.2;
  canvas.addEventListener('click', () => canvas.requestPointerLock());
  addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return;
    yaw -= e.movementX * CAMERA.sensitivityDefault;
    pitch = Math.max(CAMERA.minPitch, Math.min(CAMERA.maxPitch, pitch - e.movementY * CAMERA.sensitivityDefault));
  });

  const s = makeMotorState(...map.spawns[0]);
  const prev = new THREE.Vector3(s.x, s.y, s.z);
  let acc = 0;
  let last = performance.now();
  const shown = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const pivot = new THREE.Vector3();

  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    acc += Math.min(0.25, (now - last) / 1000);
    last = now;
    while (acc >= TICK_DT) {
      acc -= TICK_DT;
      prev.set(s.x, s.y, s.z);
      const mx = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      const mz = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const b = (keys.has('Space') ? Btn.Jump : 0) | (keys.has('ShiftLeft') ? Btn.Dash : 0);
      stepMotor(s, { mx, mz, y: yaw, b }, 'duck', mw);
      if (s.y < map.killY) Object.assign(s, makeMotorState(...map.spawns[0]));
    }
    shown.copy(prev).lerp(right.set(s.x, s.y, s.z), acc / TICK_DT);
    body.position.copy(shown);
    body.position.y -= CAPSULE_FOOT - 0.75;
    forward.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    pivot.copy(shown).addScaledVector(right, CAMERA.shoulder);
    pivot.y += CAMERA.height;
    const hit = raycastStatic(mw, pivot, { x: -forward.x, y: -forward.y, z: -forward.z }, CAMERA.distance);
    const dist = hit >= 0 ? Math.max(0.5, hit - CAMERA.collisionMargin) : CAMERA.distance;
    camera.position.copy(pivot).addScaledVector(forward, -dist);
    camera.lookAt(pivot.clone().addScaledVector(forward, 10));
    renderer.render(scene, camera);
  };
  requestAnimationFrame(frame);
}

start();
