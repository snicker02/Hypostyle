// engine/renderer.js
// WebGL1, no extensions, no dependencies. Two passes: opaque merged quads, then
// translucent ghost geometry for the symmetry images, then overlay lines.
//
// The c axis is up. Crystallographic convention keeps the operation strings in
// this app identical to the ones in the tables, and the export is where the
// axis swap to Minecraft's y-up happens - once, in one function, rather than
// scattered through the editor.

import { perspective, lookAt, multiply, invert } from './mat4.js';

const VERT = `
precision highp float;
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec3 aColor;
uniform mat4 uMVP;
varying vec3 vNormal;
varying vec3 vColor;
varying vec3 vWorld;
void main() {
  vNormal = aNormal;
  vColor = aColor;
  vWorld = aPos;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec3 vNormal;
varying vec3 vColor;
varying vec3 vWorld;
uniform vec3 uLight;
uniform float uAlpha;
uniform float uUnlit;
uniform vec3 uFog;
uniform float uFogScale;
uniform vec3 uEye;
void main() {
  vec3 base = vColor;
  if (uUnlit < 0.5) {
    vec3 n = normalize(vNormal);
    float key = max(dot(n, normalize(uLight)), 0.0);
    float fill = max(dot(n, normalize(vec3(-0.4, -0.7, 0.3))), 0.0);
    base *= 0.34 + 0.72 * key + 0.16 * fill;
  }
  float d = length(vWorld - uEye) * uFogScale;
  float fog = clamp(1.0 - exp(-d * d), 0.0, 0.82);
  gl_FragColor = vec4(mix(base, uFog, fog), uAlpha);
}`;

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl', {
      antialias: true, alpha: false, depth: true, preserveDrawingBuffer: true,
    }) || canvas.getContext('experimental-webgl');
    if (!gl) throw new Error('WebGL is not available in this browser');
    this.canvas = canvas;
    this.gl = gl;
    this.program = buildProgram(gl, VERT, FRAG);
    this.attrib = {
      pos: gl.getAttribLocation(this.program, 'aPos'),
      normal: gl.getAttribLocation(this.program, 'aNormal'),
      color: gl.getAttribLocation(this.program, 'aColor'),
    };
    this.uniform = {
      mvp: gl.getUniformLocation(this.program, 'uMVP'),
      light: gl.getUniformLocation(this.program, 'uLight'),
      alpha: gl.getUniformLocation(this.program, 'uAlpha'),
      unlit: gl.getUniformLocation(this.program, 'uUnlit'),
      fog: gl.getUniformLocation(this.program, 'uFog'),
      fogScale: gl.getUniformLocation(this.program, 'uFogScale'),
      eye: gl.getUniformLocation(this.program, 'uEye'),
    };
    this.batches = new Map();
    this.background = [0.055, 0.058, 0.070];
    this.fog = [0.075, 0.080, 0.098];
    this.viewProj = new Float32Array(16);
    this.invViewProj = new Float32Array(16);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  }

  /**
   * @param {string} name
   * @param {{positions:Float32Array, normals:Float32Array, colors:Float32Array}|null} mesh
   * @param {object} opts alpha, mode ('triangles'|'lines'), unlit
   */
  setBatch(name, mesh, opts = {}) {
    const gl = this.gl;
    let batch = this.batches.get(name);
    if (!mesh || mesh.positions.length === 0) {
      if (batch) batch.count = 0;
      return;
    }
    if (!batch) {
      batch = {
        pos: gl.createBuffer(), normal: gl.createBuffer(), color: gl.createBuffer(),
        count: 0, alpha: 1, mode: 'triangles', unlit: false, order: 0,
      };
      this.batches.set(name, batch);
    }
    upload(gl, batch.pos, mesh.positions);
    upload(gl, batch.normal, mesh.normals || new Float32Array(mesh.positions.length));
    upload(gl, batch.color, mesh.colors);
    batch.count = mesh.positions.length / 3;
    batch.alpha = opts.alpha === undefined ? 1 : opts.alpha;
    batch.mode = opts.mode || 'triangles';
    batch.unlit = !!opts.unlit;
    batch.order = opts.order || 0;
  }

  clearBatch(name) {
    const batch = this.batches.get(name);
    if (batch) batch.count = 0;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return { w, h, aspect: w / Math.max(1, h) };
  }

  /** @param {{eye:number[], target:number[], fov:number, near:number, far:number}} camera */
  render(camera) {
    const gl = this.gl;
    const { w, h, aspect } = this.resize();
    gl.viewport(0, 0, w, h);
    gl.clearColor(this.background[0], this.background[1], this.background[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const proj = perspective(camera.fov || 0.85, aspect, camera.near || 0.4, camera.far || 6000);
    const view = lookAt(camera.eye, camera.target, [0, 0, 1]);
    multiply(proj, view, this.viewProj);
    invert(this.viewProj, this.invViewProj);

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniform.mvp, false, this.viewProj);
    gl.uniform3fv(this.uniform.light, [0.42, 0.28, 0.86]);
    gl.uniform3fv(this.uniform.fog, this.fog);
    gl.uniform3fv(this.uniform.eye, camera.eye);
    gl.uniform1f(this.uniform.fogScale, camera.fogScale || 0.0045);

    const batches = [...this.batches.values()].filter((b) => b.count > 0)
      .sort((a, b) => a.order - b.order);

    for (const batch of batches) {
      const translucent = batch.alpha < 0.999;
      if (translucent) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
      } else {
        gl.disable(gl.BLEND);
        gl.depthMask(true);
      }
      if (batch.mode === 'lines') gl.disable(gl.CULL_FACE);
      else gl.enable(gl.CULL_FACE);

      gl.uniform1f(this.uniform.alpha, batch.alpha);
      gl.uniform1f(this.uniform.unlit, batch.unlit ? 1 : 0);

      bind(gl, this.attrib.pos, batch.pos, 3);
      bind(gl, this.attrib.normal, batch.normal, 3);
      bind(gl, this.attrib.color, batch.color, 3);

      gl.drawArrays(batch.mode === 'lines' ? gl.LINES : gl.TRIANGLES, 0, batch.count);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /** Normalised device coordinates from a pointer event. */
  ndcFromEvent(event) {
    const rect = this.canvas.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    ];
  }
}

function upload(gl, buffer, data) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
}

function bind(gl, location, buffer, size) {
  if (location < 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
}

function buildProgram(gl, vertSrc, fragSrc) {
  const vert = compile(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error('shader link failed: ' + gl.getProgramInfoLog(program));
  }
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  return program;
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error('shader compile failed: ' + gl.getShaderInfoLog(shader));
  }
  return shader;
}

/* ------------------------- overlay line helpers ------------------------- */

/** Wireframe box from min corner and size, as a line batch. */
export function boxLines(min, size, color, out = { positions: [], colors: [] }) {
  const [x0, y0, z0] = min;
  const [sx, sy, sz] = size;
  const x1 = x0 + sx, y1 = y0 + sy, z1 = z0 + sz;
  const corners = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const edges = [
    0, 1, 1, 2, 2, 3, 3, 0,
    4, 5, 5, 6, 6, 7, 7, 4,
    0, 4, 1, 5, 2, 6, 3, 7,
  ];
  for (const i of edges) {
    out.positions.push(corners[i][0], corners[i][1], corners[i][2]);
    out.colors.push(color[0], color[1], color[2]);
  }
  return out;
}

/** A ground grid in the z = level plane. */
export function gridLines(min, size, step, color, level = 0, out = { positions: [], colors: [] }) {
  const [x0, y0] = min;
  const x1 = x0 + size[0], y1 = y0 + size[1];
  for (let x = x0; x <= x1; x += step) {
    out.positions.push(x, y0, level, x, y1, level);
    out.colors.push(color[0], color[1], color[2], color[0], color[1], color[2]);
  }
  for (let y = y0; y <= y1; y += step) {
    out.positions.push(x0, y, level, x1, y, level);
    out.colors.push(color[0], color[1], color[2], color[0], color[1], color[2]);
  }
  return out;
}

export function linesToMesh(out) {
  return {
    positions: new Float32Array(out.positions),
    normals: new Float32Array(out.positions.length),
    colors: new Float32Array(out.colors),
  };
}
