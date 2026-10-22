// Meridian 40: часы, построенные кодом, разбираются по прокрутке. three.js r160, студийный свет, PBR-материалы.
import * as THREE from './lib-three.module.js';
import { EffectComposer } from './lib-EffectComposer.js';
import { RenderPass } from './lib-RenderPass.js';
import { UnrealBloomPass } from './lib-UnrealBloomPass.js';
import { OutputPass } from './lib-OutputPass.js';
import { ShaderPass } from './lib-ShaderPass.js';
import { RoundedBoxGeometry } from './lib-RoundedBoxGeometry.js';

const TAU = Math.PI * 2;
const canvas = document.getElementById('gl');
const mobile = matchMedia('(max-width: 760px)').matches || matchMedia('(hover: none)').matches;
const Q = new URLSearchParams(location.search);

/* ---------------- рендер ---------------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const DPR0 = window.devicePixelRatio || 1;
let DPR = mobile ? Math.min(DPR0, 2) : Math.min(2, Math.max(1.5, DPR0));
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const maxAniso = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x09090b);
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 120);
camera.position.set(0, 0, 11);
scene.add(camera);

/* фон: мягкое тёплое пятно света за часами (привязано к камере) */
{
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  const gr = g.createRadialGradient(256, 236, 0, 256, 256, 256);
  gr.addColorStop(0, '#2a2622'); gr.addColorStop(0.35, '#16140f'); gr.addColorStop(1, '#09090b');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), new THREE.MeshBasicMaterial({ map: t, toneMapped: false, depthWrite: false }));
  bg.position.z = -40; camera.add(bg);
}

/* студийное окружение: софтбоксы и полосы света, из них PMREM для отражений */
function studioEnvironment() {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x030303);
  // мягкие края у софтбоксов: блики на металле и стекле без резких квадратов
  const soft = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    const gx = g.createLinearGradient(0, 0, 256, 0); gx.addColorStop(0, '#000'); gx.addColorStop(0.22, '#fff'); gx.addColorStop(0.78, '#fff'); gx.addColorStop(1, '#000');
    g.fillStyle = gx; g.fillRect(0, 0, 256, 256);
    g.globalCompositeOperation = 'multiply';
    const gy = g.createLinearGradient(0, 0, 0, 256); gy.addColorStop(0, '#000'); gy.addColorStop(0.22, '#fff'); gy.addColorStop(0.78, '#fff'); gy.addColorStop(1, '#000');
    g.fillStyle = gy; g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  })();
  const box = (w, h, power, color, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), map: soft, side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); s.add(m);
  };
  box(11, 7, 3.4, '#ffffff', [0, 7, 1.5]);      // большой верхний софтбокс
  box(1.8, 12, 6.0, '#ffffff', [-6.5, 1, 1.5]); // левая полоса: длинный блик на полировке
  box(1.4, 12, 4.0, '#ffe9d2', [6.5, 0.5, -0.5]);// правая тёплая полоса
  box(9, 2.6, 0.9, '#dfe6ff', [0, -3, 6.5]);    // нижняя холодная карточка спереди
  box(3, 3, 2.2, '#ffffff', [2.5, 3.5, -6.5]);  // контровой свет сзади
  box(2, 2, 0.6, '#ffd7a8', [-4, -4, -3]);      // тёплый отскок снизу
  const size = mobile ? 512 : 1024;
  const cubeRT = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
  new THREE.CubeCamera(0.1, 100, cubeRT).update(renderer, s);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromCubemap(cubeRT.texture);
  pm.dispose(); cubeRT.dispose();
  return rt.texture;
}
scene.environment = studioEnvironment();

const key = new THREE.DirectionalLight(0xffffff, 2.0);
key.position.set(-3.5, 6, 7);
key.castShadow = true;
key.shadow.mapSize.set(mobile ? 2048 : 4096, mobile ? 2048 : 4096);
Object.assign(key.shadow.camera, { left: -4.5, right: 4.5, top: 4.5, bottom: -4.5, near: 1, far: 25 });
key.shadow.bias = -0.0003; key.shadow.normalBias = 0.012;
scene.add(key);
const rim = new THREE.DirectionalLight(0xffe2c0, 1.4); rim.position.set(5, 2.5, -6); scene.add(rim);

/* ---------------- текстуры, нарисованные кодом ---------------- */
await Promise.all([document.fonts.load('80px "Tenor Sans"'), document.fonts.load('300 40px "Jost"')]).catch(() => {});
function tex(size, draw, srgb = true, repeat) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
  return t;
}
const S = mobile ? 2048 : (renderer.capabilities.maxTextureSize >= 8192 ? 4096 : 2048);
const dialTex = tex(S, (g, s) => {
  const R = s / 2;
  const base = g.createRadialGradient(R, R * 0.92, 0, R, R, R);
  base.addColorStop(0, '#22304a'); base.addColorStop(0.55, '#141c2d'); base.addColorStop(1, '#070a12');
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  // солнечные лучи: тонкие радиальные штрихи + широкий конический блеск
  g.save(); g.translate(R, R);
  for (let i = 0; i < 1800; i++) {
    const a = (i / 1800) * TAU; const v = 0.5 + 0.5 * Math.cos(2 * a + 0.6);
    g.strokeStyle = `rgba(190,210,255,${0.012 + 0.03 * v + Math.random() * 0.012})`; g.lineWidth = 1.1;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * R, Math.sin(a) * R); g.stroke();
  }
  const cg = g.createConicGradient(0.6, 0, 0);
  [[0, 0.0], [0.12, 0.10], [0.25, 0.0], [0.5, 0.0], [0.62, 0.08], [0.75, 0.0], [1, 0.0]].forEach(([o, a]) => cg.addColorStop(o, `rgba(170,195,255,${a})`));
  g.fillStyle = cg; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
  // минутная дорожка
  for (let i = 0; i < 300; i++) {
    const a = (i / 300) * TAU - Math.PI / 2, big = i % 25 === 0, mid = i % 5 === 0;
    const r1 = R * (big ? 0.915 : mid ? 0.93 : 0.945), r2 = R * 0.975;
    g.strokeStyle = `rgba(236,230,218,${big ? 0.95 : mid ? 0.8 : 0.35})`; g.lineWidth = big ? 5 : mid ? 3 : 1.4;
    g.beginPath(); g.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); g.lineTo(Math.cos(a) * r2, Math.sin(a) * r2); g.stroke();
  }
  // счётчики: «азурирование» (концентрические бороздки)
  for (const sx of [-1, 1]) {
    const cx = sx * 0.447 * R, rr = 0.262 * R;
    const sg = g.createRadialGradient(cx, 0, 0, cx, 0, rr);
    sg.addColorStop(0, '#0e1422'); sg.addColorStop(1, '#0a0f1a'); g.fillStyle = sg;
    g.beginPath(); g.arc(cx, 0, rr, 0, TAU); g.fill();
    for (let r = 6; r < rr; r += 5) { g.strokeStyle = `rgba(200,215,255,${0.05 + 0.03 * Math.sin(r * 0.7)})`; g.lineWidth = 1.6; g.beginPath(); g.arc(cx, 0, r, 0, TAU); g.stroke(); }
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * TAU - Math.PI / 2, big = i % 10 === 0;
      g.strokeStyle = `rgba(236,230,218,${big ? 0.9 : 0.5})`; g.lineWidth = big ? 3.5 : 1.6;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * rr * (big ? 0.78 : 0.86), Math.sin(a) * rr * (big ? 0.78 : 0.86)); g.lineTo(cx + Math.cos(a) * rr * 0.96, Math.sin(a) * rr * 0.96); g.stroke();
    }
    g.fillStyle = 'rgba(236,230,218,.85)'; g.font = `300 ${Math.round(R * 0.045)}px Jost`; g.textAlign = 'center'; g.textBaseline = 'middle';
    [['60', 0], ['20', 1 / 3], ['40', 2 / 3]].forEach(([t, f]) => { const a = f * TAU - Math.PI / 2; g.fillText(t, cx + Math.cos(a) * rr * 0.6, Math.sin(a) * rr * 0.6); });
  }
  // надписи
  g.fillStyle = 'rgba(236,230,218,.96)'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `${Math.round(R * 0.085)}px "Tenor Sans"`;
  if ('letterSpacing' in g) g.letterSpacing = `${Math.round(R * 0.03)}px`;
  g.fillText('MERIDIAN', 0, -R * 0.43);
  g.font = `300 ${Math.round(R * 0.036)}px Jost`; if ('letterSpacing' in g) g.letterSpacing = `${Math.round(R * 0.016)}px`;
  g.fillStyle = 'rgba(217,185,138,.95)'; g.fillText('AUTOMATIC  CHRONOGRAPH', 0, -R * 0.33);
  g.fillStyle = 'rgba(236,230,218,.7)'; g.fillText('SAPPHIRE · 100 M', 0, R * 0.46);
  g.restore();
});
const insertTex = tex(S, (g, s) => {
  const R = s / 2; g.translate(R, R);
  const gr = g.createRadialGradient(0, 0, R * 0.9, 0, 0, R); gr.addColorStop(0, '#050506'); gr.addColorStop(0.6, '#141416'); gr.addColorStop(1, '#060607');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
  g.fillStyle = 'rgba(232,226,214,.92)'; g.strokeStyle = 'rgba(232,226,214,.92)';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * TAU - Math.PI / 2; if (i % 10 === 0) continue;
    g.lineWidth = i % 5 === 0 ? 5 : 2.5; const r1 = R * (i % 5 === 0 ? 0.945 : 0.958);
    g.beginPath(); g.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); g.lineTo(Math.cos(a) * R * 0.985, Math.sin(a) * R * 0.985); g.stroke();
  }
  g.font = `${Math.round(R * 0.036)}px "Tenor Sans"`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let n = 10; n < 60; n += 10) { const a = (n / 60) * TAU - Math.PI / 2; g.save(); g.rotate(a + Math.PI / 2); g.fillText(String(n), 0, -R * 0.961); g.restore(); }
  g.fillStyle = '#eef6ea'; g.beginPath(); g.moveTo(0, -R * 0.93); g.lineTo(-R * 0.022, -R * 0.99); g.lineTo(R * 0.022, -R * 0.99); g.closePath(); g.fill();
});
const perlage = tex(1024, (g, s) => {
  g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, s, s);
  for (let y = 0; y < s + 40; y += 26) for (let x = 0; x < s + 40; x += 26) {
    const cx = x + (Math.random() - 0.5) * 6, cy = y + (Math.random() - 0.5) * 6, r = 24;
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    gr.addColorStop(0, '#5a5a5a'); gr.addColorStop(0.6, '#8c8c8c'); gr.addColorStop(1, 'rgba(140,140,140,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
  }
}, false, 5);
const cotes = tex(1024, (g, s) => {
  for (let y = 0; y < s; y += 64) { const gr = g.createLinearGradient(0, y, 0, y + 64); gr.addColorStop(0, '#6a6a6a'); gr.addColorStop(0.5, '#8e8e8e'); gr.addColorStop(1, '#6a6a6a'); g.fillStyle = gr; g.fillRect(0, y, s, 64); }
}, false, 1.1);
const leatherBump = tex(512, (g, s) => {
  g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 14000; i++) { const v = 100 + Math.random() * 60; g.fillStyle = `rgba(${v},${v},${v},.5)`; g.beginPath(); g.arc(Math.random() * s, Math.random() * s, 0.6 + Math.random() * 1.8, 0, TAU); g.fill(); }
}, false, 3);
cotes.rotation = 0.5;
// карта нормалей из карты высот: зерно кожи, матовое золото
function normalFromHeight(size, drawHeight, strength, repeat) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'); drawHeight(g, size);
  const src = g.getImageData(0, 0, size, size).data, out = g.createImageData(size, size), d = out.data;
  const h = (x, y) => src[((((y + size) % size) * size) + ((x + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * strength, dy = (h(x, y + 1) - h(x, y - 1)) * strength, l = Math.hypot(dx, dy, 1), i = (y * size + x) * 4;
    d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (-dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  const hc = document.createElement('canvas'); hc.width = hc.height = size; hc.getContext('2d').drawImage(c, 0, 0);
  g.putImageData(out, 0, 0);
  const mk = (cv) => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = maxAniso; return t; };
  return { normal: mk(c), height: mk(hc) };
}
const leatherMaps = normalFromHeight(1024, (g, s) => {
  g.fillStyle = '#5a5a5a'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 26000; i++) { // «пупырышки» зернистой кожи
    const x = Math.random() * s, y = Math.random() * s, r = 2 + Math.random() * 3.5;
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(0.7, 'rgba(160,160,160,.2)'); gr.addColorStop(1, 'rgba(90,90,90,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  g.strokeStyle = 'rgba(40,40,40,.35)'; g.lineWidth = 1.2;
  for (let i = 0; i < 260; i++) { const x = Math.random() * s, y = Math.random() * s, a = Math.random() * TAU, L = 10 + Math.random() * 40; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + 0.6) * L * 0.5, y + Math.sin(a + 0.6) * L * 0.5, x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke(); }
}, 1.6, 0.42);
const frost = normalFromHeight(512, (g, s) => {
  const im = g.createImageData(s, s); for (let i = 0; i < im.data.length; i += 4) { const v = 110 + Math.random() * 40; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; } g.putImageData(im, 0, 0);
}, 1.4, 8);
function soleil(r) { // «солнечная» шлифовка для круглой детали радиуса r (UV в координатах фигуры)
  const t = tex(1024, (g, s) => { g.fillStyle = '#7d7d7d'; g.fillRect(0, 0, s, s); g.translate(s / 2, s / 2); for (let i = 0; i < 900; i++) { const a = (i / 900) * TAU; const v = 90 + Math.random() * 90; g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = 1.4; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * s, Math.sin(a) * s); g.stroke(); } }, false);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.repeat.set(1 / (2 * r), 1 / (2 * r)); t.offset.set(0.5, 0.5); return t;
}
function decal(w, h, draw) { // прозрачная надпись/гравировка
  const t = tex(2048, (g, s) => { g.clearRect(0, 0, s, s); draw(g, s); });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshPhysicalMaterial({ map: t, transparent: true, metalness: 1, roughness: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
}
function arcText(g, cx, cy, r, text, a0, a1, font, color, outward = true) {
  g.font = font; g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  const chars = [...text], step = (a1 - a0) / Math.max(1, chars.length - 1);
  chars.forEach((ch, i) => { const a = a0 + i * step; g.save(); g.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.rotate(a + (outward ? Math.PI / 2 : -Math.PI / 2)); g.fillText(ch, 0, 0); g.restore(); });
}

/* ---------------- материалы ---------------- */
const M = {
  polish: new THREE.MeshPhysicalMaterial({ color: 0xeceef1, metalness: 1, roughness: 0.07 }),
  satin: new THREE.MeshPhysicalMaterial({ color: 0xe2e4e7, metalness: 1, roughness: 0.26, anisotropy: 0.65 }),
  graphite: new THREE.MeshPhysicalMaterial({ color: 0x1a1d24, metalness: 0.5, roughness: 0.42 }),
  gold: new THREE.MeshPhysicalMaterial({ color: 0xf2c47e, metalness: 1, roughness: 0.18 }),
  rose: new THREE.MeshPhysicalMaterial({ color: 0xe8b08f, metalness: 1, roughness: 0.2 }),
  rhodium: new THREE.MeshPhysicalMaterial({ color: 0xc8cbd1, metalness: 1, roughness: 0.55, roughnessMap: perlage }),
  bridge: new THREE.MeshPhysicalMaterial({ color: 0xb4b8bf, metalness: 1, roughness: 0.55, roughnessMap: cotes }),
  blued: new THREE.MeshPhysicalMaterial({ color: 0x2a52c4, metalness: 1, roughness: 0.18 }),
  ruby: new THREE.MeshPhysicalMaterial({ color: 0xb00d28, metalness: 0, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0, ior: 1.76, sheen: 1, sheenColor: new THREE.Color(0xff4060), emissive: 0x3a0008, emissiveIntensity: 0.6 }),
  crystal: new THREE.MeshPhysicalMaterial({ color: 0x000000, metalness: 0, roughness: 0, ior: 1.77, specularIntensity: 1, envMapIntensity: 1.6, clearcoat: 1, clearcoatRoughness: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  dial: new THREE.MeshPhysicalMaterial({ map: dialTex, metalness: 0.2, roughness: 0.4, clearcoat: 0.9, clearcoatRoughness: 0.06 }),
  insert: new THREE.MeshPhysicalMaterial({ map: insertTex, metalness: 0, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.04 }),
  lume: new THREE.MeshStandardMaterial({ color: 0xeef5e8, roughness: 0.55, emissive: 0xb9f5c8, emissiveIntensity: 0.06 }),
  red: new THREE.MeshPhysicalMaterial({ color: 0xd8462a, metalness: 0.1, roughness: 0.35, clearcoat: 0.7 }),
  black: new THREE.MeshPhysicalMaterial({ color: 0x0b0b0c, metalness: 0.2, roughness: 0.5 }),
  leather: new THREE.MeshPhysicalMaterial({ color: 0x3a2417, vertexColors: true, roughness: 0.55, normalMap: leatherMaps.normal, normalScale: new THREE.Vector2(0.45, 0.45), sheen: 0.5, sheenColor: new THREE.Color(0x8a5a3a), sheenRoughness: 0.4, clearcoat: 0.22, clearcoatRoughness: 0.42 }),
  thread: new THREE.MeshPhysicalMaterial({ color: 0xd8c4a2, roughness: 0.7, sheen: 1, sheenColor: new THREE.Color(0xfff2d8), sheenRoughness: 0.6 }),
  goldFrost: new THREE.MeshPhysicalMaterial({ color: 0xf0c27c, metalness: 1, roughness: 0.32, normalMap: frost.normal, normalScale: new THREE.Vector2(0.35, 0.35) }),
  goldPolish: new THREE.MeshPhysicalMaterial({ color: 0xf6cd8a, metalness: 1, roughness: 0.06 }),
  steelBlack: new THREE.MeshPhysicalMaterial({ color: 0x9a9ea6, metalness: 1, roughness: 0.04 })
};
M.bridge.normalMap = null;

/* ---------------- геометрия ---------------- */
// профиль вращения: [r, y, острый_угол?]; острые точки дублируются, чтобы у граней были чёткие блики
function lathe(pts, seg = 256) {
  const v = [];
  for (const [r, y, s] of pts) { v.push(new THREE.Vector2(r, y)); if (s) v.push(new THREE.Vector2(r, y)); }
  return new THREE.LatheGeometry(v, seg);
}
function mesh(geo, mat, cast = true, recv = true) { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = recv; return m; }
function knurl(r, h, n) {
  const g = new THREE.CylinderGeometry(r, r, h, n * 10, 1, false);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), rr = Math.hypot(x, z);
    if (rr > r * 0.98) { const a = Math.atan2(z, x); const k = r * (0.965 + 0.05 * Math.pow(Math.abs(Math.cos(n * a / 2)), 0.7)); p.setXYZ(i, Math.cos(a) * k, p.getY(i), Math.sin(a) * k); }
  }
  g.computeVertexNormals(); return g;
}
function gearShape(n, rOut, rRoot, rHub, spokes, rRim) {
  const s = new THREE.Shape(), st = TAU / n;
  for (let i = 0; i < n; i++) {
    const a = i * st, P = (ang, r) => [Math.cos(ang) * r, Math.sin(ang) * r];
    const pts = [P(a, rRoot), P(a + st * 0.18, rRoot), P(a + st * 0.3, rOut), P(a + st * 0.56, rOut), P(a + st * 0.68, rRoot)];
    pts.forEach(([x, y], j) => (i === 0 && j === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
  }
  s.closePath();
  if (spokes) {
    const w = 0.42 / spokes * 2.2;
    for (let k = 0; k < spokes; k++) {
      const a0 = (k / spokes) * TAU + w / 2, a1 = ((k + 1) / spokes) * TAU - w / 2, h = new THREE.Path();
      h.absarc(0, 0, rRim, a0, a1, false); h.absarc(0, 0, rHub, a1, a0, true); h.closePath(); s.holes.push(h);
    }
  }
  const c = new THREE.Path(); c.absarc(0, 0, rHub * 0.35, 0, TAU, true); s.holes.push(c);
  return s;
}
function extr(shape, depth, bevel = 0.006, seg = 24) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: seg });
  g.rotateX(-Math.PI / 2); // плоскость фигуры ложится в XZ, толщина вверх по Y
  return g;
}

const watch = new THREE.Group(); scene.add(watch);
const parts = []; // { o, dy, dx, base }
function part(o, dy, extra = {}) { watch.add(o); parts.push({ o, dy, base: o.position.clone(), ...extra }); return o; }

// корпус
const caseMid = new THREE.Group();
caseMid.add(mesh(lathe([[1.6, 0.06, 1], [1.9, 0.06, 1], [1.965, 0.1], [2.015, 0.2], [2.04, 0.36], [2.035, 0.5], [2.0, 0.64], [1.955, 0.74], [1.915, 0.8, 1], [1.6, 0.8, 1], [1.6, 0.06, 1]]), M.polish));
{ // ушки
  const s = new THREE.Shape(); s.moveTo(1.3, 0.1); s.lineTo(1.3, 0.74); s.bezierCurveTo(1.8, 0.77, 2.2, 0.7, 2.44, 0.5); s.lineTo(2.47, 0.4); s.bezierCurveTo(2.46, 0.28, 2.39, 0.21, 2.28, 0.19); s.bezierCurveTo(2.0, 0.16, 1.7, 0.1, 1.3, 0.1);
  const lg = new THREE.ExtrudeGeometry(s, { depth: 0.24, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.035, bevelSegments: 6, curveSegments: 64 });
  lg.translate(0, 0, -0.12);
  for (const side of [-1, 1]) for (const xs of [-1, 1]) {
    const m = mesh(lg, M.satin); m.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2; m.position.x = xs * 1.12; caseMid.add(m);
  }
  for (const side of [-1, 1]) { const b = mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.1, 24), M.polish); b.rotation.z = Math.PI / 2; b.position.set(0, 0.33, side * 2.3); caseMid.add(b); }
}
part(caseMid, 0);
// заводная головка и кнопки хронографа (выезжают вбок)
const crown = new THREE.Group();
{ const k = mesh(knurl(0.27, 0.3, 26), M.polish); k.rotation.z = -Math.PI / 2; k.position.x = 0.15; crown.add(k);
  const cap = mesh(new THREE.CylinderGeometry(0.205, 0.22, 0.03, 96), M.satin); cap.rotation.z = -Math.PI / 2; cap.position.x = 0.315; crown.add(cap);
  const st = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.2, 48), M.polish); st.rotation.z = -Math.PI / 2; st.position.x = -0.05; crown.add(st);
  crown.position.set(2.1, 0.43, 0); }
part(crown, 0, { dx: 0.9 });
for (const sgn of [-1, 1]) {
  const a = sgn * 0.62, p = new THREE.Group();
  const stem = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.2, 48), M.polish); stem.rotation.z = -Math.PI / 2; stem.position.x = 0.08; p.add(stem);
  const head = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 64), M.polish); head.rotation.z = -Math.PI / 2; head.position.x = 0.22; p.add(head);
  p.rotation.y = -a; p.position.set(Math.cos(a) * 1.98, 0.43, Math.sin(a) * 1.98);
  part(p, 0, { dr: [Math.cos(a) * 0.55, Math.sin(a) * 0.55] });
}
// безель с керамической вставкой
const bezel = new THREE.Group();
bezel.add(mesh(lathe([[1.7, 0.8, 1], [1.955, 0.8, 1], [1.99, 0.83], [1.99, 0.91], [1.96, 0.975], [1.91, 1.0, 1], [1.735, 1.0, 1], [1.7, 0.97], [1.7, 0.8, 1]]), M.polish));
{ const ins = mesh(new THREE.RingGeometry(1.75, 1.9, 256, 1), M.insert); ins.rotation.x = -Math.PI / 2; ins.position.y = 1.004; bezel.add(ins); }
part(bezel, 2.25);
// стекло
const crystal = mesh(lathe([[0.001, 1.172], [0.55, 1.166], [1.05, 1.148], [1.42, 1.12], [1.62, 1.088], [1.715, 1.04, 1], [1.715, 0.985, 1], [1.665, 0.985, 1], [1.6, 1.03], [1.3, 1.07], [0.8, 1.1], [0.001, 1.112]], 192), M.crystal, false, false);
part(crystal, 2.9);
// внутренний конус (рехаут)
part(mesh(lathe([[1.58, 0.7, 1], [1.665, 0.7, 1], [1.715, 0.975, 1], [1.672, 0.975, 1], [1.58, 0.7, 1]]), M.graphite), 1.2);
// циферблат с накладными метками и кольцами счётчиков
const dial = new THREE.Group();
{ const d = mesh(new THREE.CircleGeometry(1.6, 256), M.dial, false, true); d.rotation.x = -Math.PI / 2; d.position.y = 0.7; dial.add(d);
  for (const sx of [-1, 1]) { const r = mesh(new THREE.TorusGeometry(0.42, 0.011, 16, 160), M.polish); r.rotation.x = -Math.PI / 2; r.position.set(sx * 0.72, 0.706, 0); dial.add(r); }
  const ig = new RoundedBoxGeometry(0.078, 0.05, 0.27, 4, 0.018), lg = new RoundedBoxGeometry(0.032, 0.014, 0.19, 2, 0.006);
  for (let h = 0; h < 12; h++) {
    if (h === 3 || h === 9) continue;
    const a = (h / 12) * TAU;
    const offs = h === 0 ? [-0.065, 0.065] : [0];
    for (const o of offs) {
      const x = Math.sin(a) * 1.33 + Math.cos(a) * o, z = -Math.cos(a) * 1.33 + Math.sin(a) * o;
      const m = mesh(ig, M.polish); m.position.set(x, 0.727, z); m.rotation.y = Math.PI - a; dial.add(m);
      const l = mesh(lg, M.lume, false, true); l.position.set(x, 0.756, z); l.rotation.y = Math.PI - a; dial.add(l);
    }
  }
}
part(dial, 0.75);
// стрелки
function handShape(len, w, tail) { const s = new THREE.Shape(); s.moveTo(-w, 0); s.lineTo(0, len); s.lineTo(w, 0); s.lineTo(0, -tail); s.closePath(); return s; }
// гранёная стрелка: центральное ребро выше краёв, две грани ловят свет по-разному
function facet(geo, w, ridge, top) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > top) p.setY(i, y + ridge * Math.max(0, 1 - Math.abs(p.getX(i)) / w)); }
  geo.computeVertexNormals(); return geo;
}
function makeHand(len, w, tail, y, lumeK) {
  const g = new THREE.Group();
  g.add(mesh(facet(extr(handShape(len, w, tail), 0.014, 0.006, 4), w + 0.006, 0.016, 0.01), M.polish));
  const l = mesh(extr(handShape(len * 0.74, w * 0.34, 0), 0.006, 0, 4), M.lume, false, false); l.position.set(0, 0.037, -len * 0.14); g.add(l);
  const hub = mesh(new THREE.CylinderGeometry(w * 0.9, w * 0.9, 0.02, 48), M.polish); hub.position.y = 0.007; g.add(hub);
  g.position.y = y; return g;
}
const hourHand = makeHand(0.92, 0.075, 0.16, 0.765);
const minHand = makeHand(1.38, 0.058, 0.2, 0.79);
hourHand.rotation.y = -((10 + 10 / 60) / 12) * TAU; minHand.rotation.y = -(10 / 60) * TAU;
part(hourHand, 1.35); part(minHand, 1.6);
const secHand = new THREE.Group();
{ const s = new THREE.Shape(); s.moveTo(-0.011, -0.3); s.lineTo(-0.007, 1.47); s.lineTo(0.007, 1.47); s.lineTo(0.011, -0.3); s.closePath();
  secHand.add(mesh(extr(s, 0.008, 0.003, 2), M.polish));
  const cw = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 48), M.polish); cw.position.set(0, 0.006, 0.24); secHand.add(cw);
  const tip = mesh(new THREE.BoxGeometry(0.016, 0.012, 0.22), M.red); tip.position.set(0, 0.014, -1.34); secHand.add(tip);
  const cap = mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.03, 48), M.polish); cap.position.y = 0.02; secHand.add(cap);
  secHand.position.y = 0.815; }
part(secHand, 1.85);
const subHands = [];
for (const sx of [-1, 1]) {
  const g = new THREE.Group(); const s = new THREE.Shape(); s.moveTo(-0.012, -0.06); s.lineTo(-0.006, 0.36); s.lineTo(0.006, 0.36); s.lineTo(0.012, -0.06); s.closePath();
  g.add(mesh(extr(s, 0.008, 0.002, 2), sx < 0 ? M.polish : M.red));
  const c = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 32), M.polish); c.position.y = 0.01; g.add(c);
  g.position.set(sx * 0.72, 0.725, 0); subHands.push(g); part(g, 0.95);
}
// механизм: платина, колёса с трибами, анкерный ход, баланс, мосты с англажем, ротор с гравировкой
const plate = mesh(new THREE.CylinderGeometry(1.57, 1.57, 0.1, 192), M.rhodium); plate.position.y = 0.6;
part(plate, -0.75);
function gearShape2(n, rOut, rRoot, rHub, spokes, rRim) { // скруглённые зубья, спицы
  const s = new THREE.Shape(), st = TAU / n, P = (a, r) => [Math.cos(a) * r, Math.sin(a) * r];
  for (let i = 0; i < n; i++) {
    const a = i * st;
    const pts = [P(a, rRoot), P(a + st * 0.16, rRoot), P(a + st * 0.26, rRoot + (rOut - rRoot) * 0.7), P(a + st * 0.33, rOut * 0.995), P(a + st * 0.41, rOut), P(a + st * 0.49, rOut * 0.995), P(a + st * 0.56, rRoot + (rOut - rRoot) * 0.7), P(a + st * 0.66, rRoot)];
    pts.forEach(([x, y], j) => (i === 0 && j === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
  }
  s.closePath();
  if (spokes) {
    const half = 0.055 / rRim * 1.6;
    for (let k = 0; k < spokes; k++) {
      const a0 = (k / spokes) * TAU + half, a1 = ((k + 1) / spokes) * TAU - half, h = new THREE.Path();
      h.absarc(0, 0, rRim, a0, a1, false); h.absarc(0, 0, rHub, a1 - half * (rRim / rHub) * 0.4, a0 + half * (rRim / rHub) * 0.4, true); h.closePath(); s.holes.push(h);
    }
  }
  const c = new THREE.Path(); c.absarc(0, 0, rHub * 0.3, 0, TAU, true); s.holes.push(c);
  return s;
}
const gears = [];
function gear(n, rOut, x, y, z, speed, spokes, thick = 0.03, dy = -1.25, steel = false) {
  const g = new THREE.Group();
  const geo = extr(gearShape2(n, rOut, rOut * 0.925, rOut * 0.24, spokes, rOut * 0.78), thick, 0.005, 18);
  g.add(mesh(geo, steel ? [M.polish, M.polish] : [M.goldFrost, M.goldPolish]));
  // триб: маленькая стальная шестерня на той же оси
  const leaves = n > 60 ? 10 : 8, pr = rOut * 0.17;
  const pin = mesh(extr(gearShape2(leaves, pr, pr * 0.62, pr * 0.3, 0, 0), 0.1, 0.004, 8), M.polish); pin.position.y = -0.11; g.add(pin);
  const axle = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 16), M.polish); g.add(axle);
  g.position.set(x, y, z); gears.push({ g, speed }); part(g, dy); return g;
}
gear(84, 0.58, 0, 0.44, 0, 0.18, 5);
gear(66, 0.42, 0.82, 0.4, -0.42, -0.42, 5, 0.03, -1.35);
gear(56, 0.34, 0.6, 0.37, 0.68, 0.9, 4, 0.03, -1.45);
const barrelG = gear(96, 0.56, -0.74, 0.42, -0.66, -0.08, 0, 0.07, -1.3);
{ // крышка барабана с гравированной спиралью
  const lid = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.012, 96), M.goldFrost); lid.position.y = -0.01; barrelG.add(lid);
}
// анкерное колесо с «клюшками» и анкерная вилка с рубиновыми палетами
const escape = new THREE.Group();
{ const s = new THREE.Shape(), n = 15, r0 = 0.07, r1 = 0.22;
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU, b = a + TAU / n; const P = (ang, r) => [Math.cos(ang) * r, Math.sin(ang) * r];
    const pts = [P(a, r1 * 0.62), P(a + 0.06, r1), P(a + 0.16, r1 * 0.97), P(a + 0.2, r1 * 0.8), P(b - 0.02, r1 * 0.62)];
    pts.forEach(([x, y], j) => (i === 0 && j === 0 ? s.moveTo(x, y) : s.lineTo(x, y))); }
  s.closePath(); const hub = new THREE.Path(); hub.absarc(0, 0, r0 * 0.5, 0, TAU, true); s.holes.push(hub);
  for (let k = 0; k < 4; k++) { const h = new THREE.Path(), a0 = (k / 4) * TAU + 0.25, a1 = ((k + 1) / 4) * TAU - 0.25; h.absarc(0, 0, r1 * 0.55, a0, a1, false); h.absarc(0, 0, r0 * 1.1, a1 - 0.2, a0 + 0.2, true); h.closePath(); s.holes.push(h); }
  escape.add(mesh(extr(s, 0.022, 0.003, 8), [M.steelBlack, M.polish]));
  escape.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.25, 12), M.polish));
  escape.position.set(-0.22, 0.34, 1.0); }
part(escape, -1.5);
const fork = new THREE.Group();
{ const s = new THREE.Shape(); s.moveTo(-0.02, 0); s.lineTo(0.02, 0); s.lineTo(0.035, 0.28); s.lineTo(0.12, 0.33); s.lineTo(0.11, 0.37); s.lineTo(0, 0.31); s.lineTo(-0.11, 0.37); s.lineTo(-0.12, 0.33); s.lineTo(-0.035, 0.28); s.closePath();
  const f = mesh(extr(s, 0.02, 0.003, 4), [M.polish, M.polish]); f.rotation.y = Math.PI; fork.add(f);
  for (const sx of [-1, 1]) { const pal = mesh(new THREE.BoxGeometry(0.03, 0.03, 0.06), M.ruby, false, false); pal.position.set(sx * 0.115, 0.012, 0.35); fork.add(pal); }
  fork.position.set(-0.5, 0.31, 0.78); fork.rotation.y = -0.6; }
part(fork, -1.55);
// баланс с винтами, регулятором и волоском
const balance = new THREE.Group();
{ balance.add(mesh(new THREE.TorusGeometry(0.34, 0.03, 24, 160), M.goldPolish).rotateX(Math.PI / 2));
  for (let k = 0; k < 3; k++) { const sp = mesh(new RoundedBoxGeometry(0.66, 0.02, 0.04, 2, 0.008), M.goldFrost); sp.rotation.y = (k / 3) * Math.PI; balance.add(sp); }
  for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU; const sc = mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.04, 24), M.goldPolish); sc.rotation.z = Math.PI / 2; sc.rotation.y = -a; sc.position.set(Math.cos(a) * 0.38, 0, Math.sin(a) * 0.38); balance.add(sc); }
  const hubB = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 32), M.goldPolish); balance.add(hubB);
  class Spiral extends THREE.Curve { getPoint(t) { const r = 0.06 + 0.2 * t, a = t * TAU * 13; return new THREE.Vector3(Math.cos(a) * r, -0.04, Math.sin(a) * r); } }
  balance.add(mesh(new THREE.TubeGeometry(new Spiral(), 1600, 0.0032, 6), M.blued, false, false));
  balance.position.set(-0.82, 0.28, 0.55); }
part(balance, -1.6);
// мосты: женевские волны, полированная фаска (англаж), камни в золотых шатонах, воронёные винты, гравировка
const bridges = new THREE.Group();
{
  const train = new THREE.Shape(); train.moveTo(-0.1, -0.25); train.absarc(0, 0, 0.3, Math.PI * 1.1, Math.PI * 0.05, true); train.lineTo(0.95, -0.2); train.absarc(0.82, -0.42, 0.26, Math.PI * 0.2, -Math.PI * 0.7, true); train.lineTo(0.4, -0.4); train.lineTo(-0.1, -0.25);
  const t2 = new THREE.Shape(); t2.absarc(0.6, 0.68, 0.24, 0, TAU, false);
  const barrel = new THREE.Shape(); barrel.absarc(-0.74, -0.66, 0.62, 0, TAU, false);
  const hole = new THREE.Path(); hole.absarc(-0.74, -0.66, 0.2, 0, TAU, true); barrel.holes.push(hole);
  const cock = new THREE.Shape(); cock.moveTo(-1.45, 0.25); cock.quadraticCurveTo(-1.0, 0.25, -0.86, 0.48); cock.absarc(-0.82, 0.55, 0.1, Math.PI * 1.2, Math.PI * 0.2, false); cock.quadraticCurveTo(-1.0, 0.72, -1.45, 0.55); cock.lineTo(-1.45, 0.25);
  for (const sh of [train, t2, barrel, cock]) {
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.016, bevelSize: 0.018, bevelSegments: 1, curveSegments: 64 }); g.rotateX(-Math.PI / 2);
    const b = mesh(g, [M.bridge, M.polish]); b.position.y = 0.14; bridges.add(b);
  }
  // храповое колесо с «солнечной» шлифовкой на мосту барабана
  { const n = 54, s = new THREE.Shape(), r1 = 0.44, r0 = 0.41;
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU, b = ((i + 1) / n) * TAU; i === 0 ? s.moveTo(Math.cos(a) * r0, Math.sin(a) * r0) : s.lineTo(Math.cos(a) * r0, Math.sin(a) * r0); s.lineTo(Math.cos(b - 0.012) * r1, Math.sin(b - 0.012) * r1); }
    s.closePath(); const h = new THREE.Path(); h.absarc(0, 0, 0.05, 0, TAU, true); s.holes.push(h);
    const ratchet = mesh(extr(s, 0.03, 0.004, 4), [new THREE.MeshPhysicalMaterial({ color: 0xd4d7dc, metalness: 1, roughness: 0.5, roughnessMap: soleil(0.44) }), M.polish]);
    ratchet.position.set(-0.74, 0.07, -0.66); bridges.add(ratchet); window.__ratchet = ratchet;
    const cw = mesh(extr(gearShape2(30, 0.19, 0.175, 0.05, 0, 0), 0.026, 0.004, 4), [new THREE.MeshPhysicalMaterial({ color: 0xd4d7dc, metalness: 1, roughness: 0.5, roughnessMap: soleil(0.19) }), M.polish]);
    cw.position.set(-0.22, 0.075, -1.12); bridges.add(cw); window.__crownWheel = cw;
    const big = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 32), M.blued); big.position.set(-0.74, 0.055, -0.66); bridges.add(big);
  }
  const jewelPos = [[0, 0], [0.82, -0.42], [0.6, 0.68], [-0.22, 1.0], [-0.82, 0.55], [-0.5, 0.78]];
  for (const [x, z] of jewelPos) {
    const ch = mesh(new THREE.TorusGeometry(0.058, 0.02, 16, 64), M.goldPolish); ch.rotation.x = Math.PI / 2; ch.position.set(x, 0.12, z); bridges.add(ch);
    const j = mesh(new THREE.SphereGeometry(0.045, 48, 24), M.ruby, false, false); j.scale.y = 0.4; j.position.set(x, 0.12, z); bridges.add(j);
    const oil = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 12), M.polish); oil.position.set(x, 0.11, z); bridges.add(oil);
  }
  const screwPos = [[-0.3, -0.18], [0.98, -0.16], [0.35, 0.7], [-1.3, 0.4], [-1.2, -0.95], [-0.3, -0.95], [-1.3, -0.4], [0.75, 0.9]];
  for (const [x, z] of screwPos) {
    const sc = mesh(lathe([[0.001, 0.0], [0.05, 0.0, 1], [0.052, 0.012], [0.04, 0.026], [0.001, 0.03]], 48), M.blued); sc.rotation.x = Math.PI; sc.position.set(x, 0.123, z); bridges.add(sc);
    const sl = mesh(new THREE.BoxGeometry(0.1, 0.014, 0.014), M.black, false, false); sl.position.set(x, 0.094, z); sl.rotation.y = x * 3 + z; bridges.add(sl);
  }
  // гравировка с золотой заливкой на мосту барабана
  const eng = decal(0.9, 0.9, (g, s) => { g.translate(s / 2, s / 2); arcText(g, 0, 0, s * 0.39, 'MERIDIAN · CAL. M-40', -Math.PI * 0.92, -Math.PI * 0.08, `${Math.round(s * 0.06)}px "Tenor Sans"`, '#f2cf93'); arcText(g, 0, 0, s * 0.4, '27 JEWELS', Math.PI * 0.68, Math.PI * 0.32, `${Math.round(s * 0.055)}px "Tenor Sans"`, '#f2cf93', false); });
  eng.material.color.set(0xffd9a0); eng.rotation.x = Math.PI / 2; eng.position.set(-0.74, 0.09, -0.66); eng.scale.set(-1.45, 1.45, 1); bridges.add(eng);
}
part(bridges, -2.2);
// ротор: женевские волны, золотой сегмент, гравировка по дуге
const rotor = new THREE.Group();
{ const s = new THREE.Shape(); s.absarc(0, 0, 1.42, 0, Math.PI, false); s.lineTo(-0.22, 0); s.absarc(0, 0, 0.22, Math.PI, 0, true); s.closePath();
  const win = new THREE.Path(); win.absarc(0, 0.62, 0.2, 0, TAU, true); s.holes.push(win);
  for (const sx of [-1, 1]) { const w2 = new THREE.Path(); w2.absarc(sx * 0.55, 0.42, 0.13, 0, TAU, true); s.holes.push(w2); }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.045, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.014, bevelSegments: 1, curveSegments: 128 }); g.rotateX(-Math.PI / 2);
  rotor.add(mesh(g, [M.bridge, M.polish]));
  const w = new THREE.Shape(); w.absarc(0, 0, 1.44, 0.05, Math.PI - 0.05, false); w.absarc(0, 0, 1.16, Math.PI - 0.05, 0.05, true); w.closePath();
  const wm = mesh(extr(w, 0.075, 0.016, 128), [M.rose, M.goldPolish]); wm.position.y = -0.025; rotor.add(wm);
  const hub = mesh(lathe([[0.001, -0.03], [0.2, -0.03, 1], [0.21, -0.01], [0.2, 0.08, 1], [0.001, 0.08]], 96), M.polish); rotor.add(hub);
  const j = mesh(new THREE.SphereGeometry(0.06, 48, 24), M.ruby, false, false); j.scale.y = 0.4; j.position.y = -0.03; rotor.add(j);
  for (const a of [0.55, 1.57, 2.6]) { const sc = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 24), M.blued); sc.position.set(Math.cos(a) * 0.32, -0.02, -Math.sin(a) * 0.32); rotor.add(sc); }
  const eng = decal(2.9, 2.9, (g2, s2) => { g2.translate(s2 / 2, s2 / 2); arcText(g2, 0, 0, s2 * 0.33, 'MERIDIAN  ·  AUTOMATIC  ·  CALIBRE M-40', Math.PI * 0.88, Math.PI * 0.12, `${Math.round(s2 * 0.028)}px "Tenor Sans"`, '#f3d29a', false); });
  eng.material.color.set(0xffd9a0); eng.rotation.x = Math.PI / 2; eng.scale.x = 1; eng.position.y = -0.015; rotor.add(eng);
  rotor.position.y = 0.0; }
part(rotor, -2.8);
// задняя крышка: сапфировое окно, гравировка по кругу
const back = new THREE.Group();
back.add(mesh(lathe([[1.2, -0.14, 1], [1.5, -0.14], [1.74, -0.1], [1.87, -0.03], [1.92, 0.03], [1.92, 0.06, 1], [1.2, 0.06, 1], [1.2, -0.14, 1]]), M.satin));
{ const w = mesh(new THREE.CylinderGeometry(1.21, 1.21, 0.05, 160), M.crystal, false, false); w.position.y = -0.1; back.add(w);
  const r = mesh(new THREE.TorusGeometry(1.205, 0.022, 16, 192), M.polish); r.rotation.x = Math.PI / 2; r.position.y = -0.135; back.add(r);
  const ringTex = tex(2048, (g, s) => { g.clearRect(0, 0, s, s); g.translate(s / 2, s / 2);
    arcText(g, 0, 0, s * 0.455, 'MERIDIAN  ·  SAPPHIRE CRYSTAL  ·  WATER RESISTANT 100 M  ·  STAINLESS STEEL  ·  N° 001 / 250  ·', -Math.PI / 2, -Math.PI / 2 + TAU * 0.985, `${Math.round(s * 0.026)}px "Tenor Sans"`, 'rgba(30,32,36,.85)'); });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.24, 1.5, 256, 1), new THREE.MeshPhysicalMaterial({ map: ringTex, transparent: true, metalness: 1, roughness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = -0.1405; back.add(ring); }
part(back, -3.5);

// кожаный ремешок: выпуклый верх, крашеные скруглённые края, сужение, двойная наклонная строчка
const straps = [];
for (const sign of [-1, 1]) {
  const pts = [];
  for (let i = 0; i <= 64; i++) { const a = (i / 64) * 2.1, R = 3.0; pts.push(new THREE.Vector3(0, 0.33 - (1 - Math.cos(a)) * R, sign * (2.3 + Math.sin(a) * R))); }
  const curve = new THREE.CatmullRomCurve3(pts), L = curve.getLength();
  const STEPS = 220, fr = curve.computeFrenetFrames(STEPS, false);
  const flip = fr.binormals[0].y < 0 ? -1 : 1; // «верх» ремешка смотрит туда же, куда циферблат
  const prof = []; const NP = 40;
  for (let i = 0; i <= NP; i++) { const a = Math.PI - (i / NP) * Math.PI; prof.push([Math.cos(a), 0.18 + 0.82 * Math.pow(Math.sin(a), 0.32), Math.abs(Math.cos(a)) > 0.93 ? 0.45 : 1]); }
  prof.push([1.0, -0.55, 0.45], [0.985, -0.88, 0.45], [0.94, -1.0, 0.85], [-0.94, -1.0, 0.85], [-0.985, -0.88, 0.45], [-1.0, -0.55, 0.45], prof[0]);
  const pos = [], uv = [], col = [], idx = [];
  const widthAt = (t) => 0.97 - 0.1 * t, thickAt = (t) => (0.125 - 0.035 * t) * (t < 0.02 ? 0.8 + 10 * t : 1);
  for (let s = 0; s <= STEPS; s++) {
    const t = s / STEPS, P = curve.getPointAt(t), N = fr.normals[s], B = fr.binormals[s], w = widthAt(t), th = thickAt(t);
    for (const [x, y, c] of prof) {
      pos.push(P.x + N.x * x * w + B.x * y * th * flip, P.y + N.y * x * w + B.y * y * th * flip, P.z + N.z * x * w + B.z * y * th * flip);
      uv.push((x + 1) * w * 0.9, t * L * 0.9); col.push(c, c, c);
    }
  }
  const R1 = prof.length;
  for (let s = 0; s < STEPS; s++) for (let j = 0; j < R1 - 1; j++) { const a = s * R1 + j, b = a + 1, c = a + R1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  const g = new THREE.Group();
  const strapMesh = mesh(geo, M.leather); strapMesh.material.side = THREE.DoubleSide; g.add(strapMesh);
  // строчка: наклонные стежки, по два ряда с каждой стороны, сверху и снизу
  const stGeo = new THREE.CapsuleGeometry(0.0085, 0.05, 4, 10); stGeo.rotateX(Math.PI / 2);
  const per = Math.floor(L / 0.085), stitch = new THREE.InstancedMesh(stGeo, M.thread, per * 4);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), basis = new THREE.Matrix4(); let k = 0;
  for (let i = 1; i < per; i++) {
    const t = i / per, s = Math.round(t * STEPS), P = curve.getPointAt(t), T = curve.getTangentAt(t), N = fr.normals[s], B = fr.binormals[s].clone().multiplyScalar(flip), w = widthAt(t), th = thickAt(t);
    basis.makeBasis(N.clone().multiplyScalar(flip), B, T); q.setFromRotationMatrix(basis);
    for (const ex of [-0.86, 0.86]) for (const side of [1, -1]) {
      const yy = side > 0 ? (0.18 + 0.82 * Math.pow(Math.sin(Math.acos(ex)), 0.32)) * th + 0.004 : -th - 0.003;
      const p = P.clone().addScaledVector(N, ex * w).addScaledVector(B, yy);
      q2.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.35 * Math.sign(ex)); const qq = q.clone().multiply(q2);
      m4.compose(p, qq, new THREE.Vector3(1, 1, 1)); stitch.setMatrixAt(k++, m4);
    }
  }
  stitch.count = k; stitch.castShadow = true; g.add(stitch);
  watch.add(g); straps.push({ g, sign });
}
// логотип на торце заводной головки
{ const t = tex(512, (g, s) => { g.fillStyle = '#808080'; g.fillRect(0, 0, s, s); g.fillStyle = '#d0d0d0'; g.font = `${s * 0.5}px "Tenor Sans"`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('M', s / 2, s / 2 + s * 0.03); g.strokeStyle = '#c8c8c8'; g.lineWidth = s * 0.03; g.beginPath(); g.arc(s / 2, s / 2, s * 0.42, 0, TAU); g.stroke(); }, false);
  t.center.set(0.5, 0.5); t.rotation = -Math.PI / 2;
  const capM = new THREE.MeshPhysicalMaterial({ color: 0xe2e4e7, metalness: 1, roughness: 0.22, bumpMap: t, bumpScale: 3 });
  crown.children[1].material = capM; }

// центр модели по высоте
watch.children.forEach((c) => { c.position.y -= 0.5; });
parts.forEach((p) => { p.base = p.o.position.clone(); });
straps.forEach((s) => { s.base = s.g.position.clone(); });

/* ---------------- анимация по прокрутке ---------------- */
const K = [
  { p: 0.00, rx: 1.36, ry: 0.0, rz: 0.0, x: 0.0, y: 0.75, d: 13.2, e: 0, sv: 1 },
  { p: 0.09, rx: 1.24, ry: -0.22, rz: 0.1, x: 0.0, y: 0.7, d: 12.8, e: 0, sv: 1 },
  { p: 0.22, rx: 0.86, ry: -0.95, rz: 0.4, x: 1.25, y: 0.0, d: 10.4, e: 0, sv: 1 },
  { p: 0.33, rx: 0.55, ry: -0.35, rz: 0.12, x: -0.8, y: -0.1, d: 16.5, e: 0.55, sv: 0 },
  { p: 0.46, rx: 0.5, ry: 0.4, rz: 0.04, x: -1.7, y: -0.1, d: 18.5, e: 1, sv: 0 },
  { p: 0.58, rx: 0.55, ry: 1.0, rz: 0.0, x: -1.6, y: -0.1, d: 18.5, e: 1, sv: 0 },
  { p: 0.70, rx: -1.28, ry: 0.3, rz: -0.22, x: 1.4, y: 0.0, d: 12.6, e: 0.1, sv: 0 },
  { p: 0.81, rx: -1.36, ry: -0.18, rz: -0.08, x: 1.3, y: 0.0, d: 12.0, e: 0, sv: 0 },
  { p: 0.92, rx: 1.28, ry: -0.2, rz: 0.05, x: 0.0, y: 0.75, d: 13.0, e: 0, sv: 1 },
  { p: 1.00, rx: 1.36, ry: 0.0, rz: 0.0, x: 0.0, y: 0.75, d: 13.2, e: 0, sv: 1 }
];
const ease = (t) => t * t * (3 - 2 * t);
function sample(p) {
  let i = 0; while (i < K.length - 2 && p > K[i + 1].p) i++;
  const a = K[i], b = K[i + 1], t = ease(Math.min(1, Math.max(0, (p - a.p) / (b.p - a.p)))), o = {};
  for (const k of ['rx', 'ry', 'rz', 'x', 'y', 'd', 'e', 'sv']) o[k] = a[k] + (b[k] - a[k]) * t;
  return o;
}
const caps = [['c0', -1, 0.1], ['c1', 0.15, 0.3], ['c2', 0.4, 0.6], ['c3', 0.66, 0.82], ['c4', 0.9, 1.01]].map(([id, a, b]) => ({ el: document.getElementById(id), a, b, center: id === 'c0' || id === 'c4' }));
const story = document.getElementById('story'), bar = document.getElementById('bar'), hint = document.getElementById('hint');
let pTarget = 0, pNow = 0, mx = 0, my = 0, mxS = 0, myS = 0;
function readScroll() { const max = story.offsetHeight - innerHeight; pTarget = Math.min(1, Math.max(0, scrollY / max)); }
addEventListener('scroll', readScroll, { passive: true }); readScroll(); pNow = pTarget;
addEventListener('pointermove', (e) => { mx = (e.clientX / innerWidth) * 2 - 1; my = (e.clientY / innerHeight) * 2 - 1; }, { passive: true });

/* ---------------- постобработка ---------------- */
const rt = new THREE.WebGLRenderTarget(innerWidth * DPR, innerHeight * DPR, { type: THREE.HalfFloatType, samples: mobile ? 2 : 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.08, 0.2, 2.4);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const sharpen = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, px: { value: new THREE.Vector2() }, k: { value: 0.32 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform sampler2D tDiffuse; uniform vec2 px; uniform float k; varying vec2 vUv; void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb + texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb; vec3 mn = min(c, min(texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb, texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb)); vec3 mx = max(c, max(texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb, texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb)); vec3 s = c + k * (4.0 * c - n); gl_FragColor = vec4(clamp(s, mn * 0.85, mx * 1.15 + 0.02), 1.0); }'
});
composer.addPass(sharpen);
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(DPR); renderer.setSize(w, h, false);
  composer.setPixelRatio(DPR); composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  sharpen.uniforms.px.value.set(1 / (w * DPR), 1 / (h * DPR));
}
addEventListener('resize', () => { resize(); readScroll(); });
resize();

/* ---------------- цикл ---------------- */
const clock = new THREE.Clock();
let frames = 0, acc = 0, tuned = false, first = true;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  const storyEnd = story.offsetTop + story.offsetHeight;
  if (document.hidden || scrollY > storyEnd + 40) return; // холст закрыт, не рисуем
  pNow += (pTarget - pNow) * (1 - Math.exp(-dt * 5.5));
  if (Q.has('p')) pNow = +Q.get('p');
  mxS += (mx - mxS) * (1 - Math.exp(-dt * 3)); myS += (my - myS) * (1 - Math.exp(-dt * 3));
  const s = sample(pNow), portrait = camera.aspect < 1;
  const fit = portrait ? Math.max(1, 0.98 / camera.aspect) : Math.max(1, 1.35 / camera.aspect);
  watch.rotation.set(s.rx + myS * 0.08, s.ry + mxS * 0.14 + Math.sin(t * 0.35) * 0.03, s.rz, 'XYZ');
  watch.position.set(portrait ? 0 : s.x, portrait ? s.y + 0.9 : s.y, 0);
  camera.position.set(0, 0, s.d * fit); camera.lookAt(0, 0, 0);
  for (const p of parts) {
    p.o.position.copy(p.base); p.o.position.y += p.dy * s.e;
    if (p.dx) p.o.position.x += p.dx * s.e;
    if (p.dr) { p.o.position.x += p.dr[0] * s.e; p.o.position.z += p.dr[1] * s.e; }
  }
  for (const st of straps) { const k = 1 - s.sv; st.g.position.copy(st.base); st.g.position.z += st.sign * k * k * 7; st.g.position.y -= k * 1.5; st.g.visible = s.sv > 0.01; }
  for (const g of gears) g.g.rotation.y += g.speed * dt;
  fork.rotation.y = -0.6 + Math.tanh(Math.sin(t * TAU * 2.5) * 6) * 0.12;
  escape.rotation.y = -(Math.floor(t * 5) / 30) * TAU;
  if (window.__ratchet) { window.__ratchet.rotation.y = t * 0.05; window.__crownWheel.rotation.y = -t * 0.14; }
  balance.rotation.y = Math.sin(t * TAU * 2.5) * 1.6;
  rotor.rotation.y = pNow * TAU * 1.5 + Math.sin(t * 0.4) * 0.25;
  secHand.rotation.y = -(((t * 8) | 0) / 8 / 60) * TAU - 0.5;
  subHands[0].rotation.y = -(t / 60) * TAU; subHands[1].rotation.y = -0.9;
  for (const c of caps) {
    const fin = c.a < 0 ? 1 : Math.min(1, Math.max(0, (pNow - c.a) / 0.035)), fout = Math.min(1, Math.max(0, (c.b - pNow) / 0.035));
    const o = Math.min(fin, fout), y = (1 - o) * 18;
    c.el.style.opacity = o.toFixed(3); c.el.style.transform = `translateY(${y}px)`;
  }
  bar.style.transform = `scaleX(${pNow.toFixed(4)})`; hint.style.opacity = pNow > 0.03 ? 0 : 1;
  composer.render();
  if (first) { first = false; document.getElementById('loader').classList.add('off'); }
  // подстройка качества под устройство
  if (!tuned) { frames++; if (frames > 120) acc += dt; if (frames === 300) { const ms = (acc / 180) * 1000; tuned = true; if (ms > 30) { DPR = Math.max(1, DPR - 0.5); resize(); } if (ms > 45) { DPR = 1; bloom.enabled = false; resize(); } } }
}
frame();
window.__ready = true;
