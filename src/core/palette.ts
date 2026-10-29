import * as THREE from 'three';

export const PALETTE = {
  pumpkin: new THREE.Color(0xff6a00),
  ember: new THREE.Color(0xff3300),
  candle: new THREE.Color(0xffb347),
  toxic: new THREE.Color(0x39ff14),
  slime: new THREE.Color(0x7cff3a),
  purple: new THREE.Color(0x8a2be2),
  violet: new THREE.Color(0x4b0f7a),
  blood: new THREE.Color(0xb3001b),
  bone: new THREE.Color(0xf2e8cf),
  moon: new THREE.Color(0xfff1c1),
  ghost: new THREE.Color(0xbfe9ff),
  night: new THREE.Color(0x05010a),
} as const;

/** GLSL vec3 literal for a palette colour (linear). */
export const glslColor = (c: THREE.Color) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
