// Turns a shared MapDef into merged toon meshes (one draw call per color).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapDef, Prim } from '@splat/shared';
import { addOutline, toon } from './toon';

function primGeometry(p: Prim): THREE.BufferGeometry {
  switch (p.shape) {
    case 'box':
      return new THREE.BoxGeometry(p.s[0], p.s[1], p.s[2]);
    case 'cyl':
      return new THREE.CylinderGeometry(p.s[0], p.s[0], p.s[1], 40);
    case 'cone':
      return new THREE.ConeGeometry(p.s[0], p.s[1], 28);
    case 'sphere':
      return new THREE.SphereGeometry(p.s[0], 24, 16);
  }
}

export function buildMapView(map: MapDef): THREE.Group {
  const group = new THREE.Group();
  const byColor = new Map<number, THREE.BufferGeometry[]>();
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  for (const prim of map.prims) {
    const g = primGeometry(prim).toNonIndexed();
    pos.set(prim.p[0], prim.p[1], prim.p[2]);
    if (prim.q) q.set(prim.q[0], prim.q[1], prim.q[2], prim.q[3]);
    else q.identity();
    g.applyMatrix4(m.compose(pos, q, one));
    let list = byColor.get(prim.color);
    if (!list) byColor.set(prim.color, (list = []));
    list.push(g);
  }
  for (const [color, list] of byColor) {
    const merged = mergeGeometries(list, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, toon(color));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    addOutline(mesh);
    group.add(mesh);
  }
  return group;
}

export function buildSky(map: MapDef): THREE.Mesh {
  const geo = new THREE.SphereGeometry(400, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color(map.skyTop) }, bottom: { value: new THREE.Color(map.skyBottom) } },
    vertexShader: `varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying float h; uniform vec3 top; uniform vec3 bottom; void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.1, 0.55, h)), 1.0); }`,
  });
  return new THREE.Mesh(geo, mat);
}
