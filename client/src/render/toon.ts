// Cartoon look: 3-band toon shading + inverted-hull outlines.
import * as THREE from 'three';
import { RENDER } from '@splat/shared';

function makeGradient(): THREE.DataTexture {
  const data = new Uint8Array([120, 190, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
const gradient = makeGradient();

const materials = new Map<number, THREE.MeshToonMaterial>();
export function toon(color: number): THREE.MeshToonMaterial {
  let m = materials.get(color);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: gradient });
    materials.set(color, m);
  }
  return m;
}

/** Back-face hull pushed along normals in the vertex shader. Shared by everything. */
export const outlineMaterial = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  uniforms: { width: { value: RENDER.outlineWidth }, color: { value: new THREE.Color(0x1d1b2e) } },
  vertexShader: /* glsl */ `
    uniform float width;
    void main() {
      vec4 view = modelViewMatrix * vec4(position, 1.0);
      vec3 n = normalize(normalMatrix * normal);
      view.xyz += n * width;
      gl_Position = projectionMatrix * view;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    void main() { gl_FragColor = vec4(color, 1.0); }`,
});

export const quality = { outlines: true };

export function addOutline(mesh: THREE.Mesh): THREE.Mesh {
  const hull = new THREE.Mesh(mesh.geometry, outlineMaterial);
  hull.userData.isOutline = true;
  hull.visible = quality.outlines;
  hull.castShadow = false;
  mesh.add(hull);
  return mesh;
}

export function setOutlineWidth(w: number): void {
  outlineMaterial.uniforms.width.value = w;
}

/** Toon mesh with an outline hull. */
export function part(geo: THREE.BufferGeometry, color: number, outline = true): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, toon(color));
  mesh.castShadow = true;
  if (outline) addOutline(mesh);
  return mesh;
}
