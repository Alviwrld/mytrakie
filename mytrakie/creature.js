/* ─────────────────────────────────────────────────────────────
   creature.js — Trakie, built out of geometry rather than a file.
   Everything is procedural so the customiser can rebuild him
   instantly and he stays a few hundred KB instead of a few dozen MB.
   ───────────────────────────────────────────────────────────── */

export const COAT_COLORS = [
  { id: 'ember',   fur: '#C4682C', name: 'Ember' },
  { id: 'moss',    fur: '#6E7A46', name: 'Moss' },
  { id: 'slate',   fur: '#5B6480', name: 'Slate' },
  { id: 'plum',    fur: '#6E4568', name: 'Plum' },
  { id: 'cocoa',   fur: '#4A342A', name: 'Cocoa' },
  { id: 'sand',    fur: '#C2A469', name: 'Sand' },
  { id: 'teal',    fur: '#2F6E6A', name: 'Teal' },
  { id: 'snow',    fur: '#D8D2C6', name: 'Snow' }
];
export const BELLY_COLORS = [
  { id: 'cream',  belly: '#EFE0C4', name: 'Cream' },
  { id: 'wheat',  belly: '#DFC08C', name: 'Wheat' },
  { id: 'rose',   belly: '#E8BFAE', name: 'Rose' },
  { id: 'ash',    belly: '#C9C4B8', name: 'Ash' }
];
export const HORN_STYLES = ['curl', 'nub', 'antler', 'none'];
export const EYE_STYLES  = ['round', 'sleepy', 'wide'];
export const ACCESSORIES = ['none', 'scarf', 'cap', 'satchel'];
export const BUILDS      = ['classic', 'stout', 'lanky'];

export const DEFAULT_LOOK = {
  name: 'Trakie', coat: 'ember', belly: 'cream',
  horns: 'curl', eyes: 'round', accessory: 'scarf', build: 'classic'
};

/* ── small geometry helpers ─────────────────────────────── */

// A box whose corners are actually round. BoxGeometry with segments,
// then every vertex pushed out onto the rounded hull.
function roundedBox(THREE, w, h, d, r, seg = 3) {
  r = Math.min(r, w / 2, h / 2, d / 2);
  const g = new THREE.BoxGeometry(w - 2 * r, h - 2 * r, d - 2 * r, seg, seg, seg);
  const pos = g.attributes.position;
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.set(
      Math.abs(v.x) > hx - 1e-6 ? Math.sign(v.x) : v.x / (hx || 1),
      Math.abs(v.y) > hy - 1e-6 ? Math.sign(v.y) : v.y / (hy || 1),
      Math.abs(v.z) > hz - 1e-6 ? Math.sign(v.z) : v.z / (hz || 1)
    );
    // clamp core, then offset by r along the normalised direction
    const core = new THREE.Vector3(
      THREE.MathUtils.clamp(v.x, -hx, hx),
      THREE.MathUtils.clamp(v.y, -hy, hy),
      THREE.MathUtils.clamp(v.z, -hz, hz)
    );
    const dir = v.clone().sub(core);
    if (dir.lengthSq() < 1e-9) dir.copy(n);
    dir.normalize().multiplyScalar(r);
    pos.setXYZ(i, core.x + dir.x, core.y + dir.y, core.z + dir.z);
  }
  g.computeVertexNormals();
  return g;
}

// Tube that thins along its length — used for horns, tails, straps.
function taperedTube(THREE, curve, r0, r1, tubular = 26, radial = 8) {
  const frames = curve.computeFrenetFrames(tubular, false);
  const pos = [], nor = [], uv = [], idx = [];
  const P = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, P);
    N.copy(frames.normals[i]); B.copy(frames.binormals[i]);
    const r = r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const sx = -Math.cos(a), sy = Math.sin(a);
      const nx = sx * N.x + sy * B.x, ny = sx * N.y + sy * B.y, nz = sx * N.z + sy * B.z;
      const len = Math.hypot(nx, ny, nz) || 1;
      nor.push(nx / len, ny / len, nz / len);
      pos.push(P.x + r * nx, P.y + r * ny, P.z + r * nz);
      uv.push(j / radial, t);
    }
  }
  for (let i = 1; i <= tubular; i++) {
    for (let j = 1; j <= radial; j++) {
      const a = (radial + 1) * (i - 1) + (j - 1), b = (radial + 1) * i + (j - 1);
      const c = (radial + 1) * i + j, d = (radial + 1) * (i - 1) + j;
      idx.push(a, b, d, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function ellipsoid(THREE, mat, [cx, cy, cz], [sx, sy, sz], detail = 28) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, detail, Math.round(detail * 0.75)), mat);
  m.position.set(cx, cy, cz);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  return m;
}

/* ── fur ────────────────────────────────────────────────── */
// One InstancedMesh per body part so the fur follows the part when
// it animates. Tufts are little 4-sided spikes, dark at the root and
// bright at the tip, sitting on top of a skin mesh in a deeper shade.
function tuftGeometry(THREE) {
  const g = new THREE.ConeGeometry(1, 1, 4, 1, true);
  g.translate(0, 0.5, 0);
  const pos = g.attributes.position, col = [];
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i), 0, 1);
    const s = 0.44 + 0.48 * Math.pow(t, 0.7);       // root shadow → lit tip
    col.push(s, s * 0.995, s * 0.97);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/* ── ONE DIAL FOR THE COAT ──────────────────────────────────
   Still too shaggy? drop FUR.length to 0.8 or 0.7. Too bald?
   push it to 1.3. FUR.density changes how full it looks without
   changing the silhouette. Nothing else needs touching.        */
export const FUR = { length: 1, density: 1 };

// phones get a thinner coat — same silhouette, far less geometry
const FUR_QUALITY = (typeof window !== 'undefined' &&
  (window.innerWidth < 760 || (navigator.hardwareConcurrency || 8) <= 4)) ? 0.55 : 1;

function furField(THREE, specs, opts) {
  const {
    color, density = 900, length = 0.11, width = 0.020,
    cull = [], sweep = 0.25, droop = 0.55, lay = 0.55, tipHue = 0.03, rand = Math.random
  } = opts;

  const points = [];
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion(), dir = new THREE.Vector3();
  const p = new THREE.Vector3(), n = new THREE.Vector3(), u = new THREE.Vector3();

  for (const s of specs) {
    const [a, b, c] = s.scale;
    const area = 4 * Math.PI * Math.pow(((a * b) ** 1.6 + (a * c) ** 1.6 + (b * c) ** 1.6) / 3, 1 / 1.6);
    const count = Math.round(area * density * (s.density ?? 1) * FUR_QUALITY * FUR.density);
    for (let i = 0; i < count; i++) {
      // uniform-ish direction on the sphere, mapped onto the ellipsoid
      let x, y, z, l2;
      do { x = rand() * 2 - 1; y = rand() * 2 - 1; z = rand() * 2 - 1; l2 = x * x + y * y + z * z; }
      while (l2 > 1 || l2 < 1e-4);
      const l = Math.sqrt(l2); u.set(x / l, y / l, z / l);
      p.set(s.center[0] + u.x * a, s.center[1] + u.y * b, s.center[2] + u.z * c);
      if (s.only && !s.only(p, u)) continue;
      // skip anything buried inside a bald part (muzzle, belly patch, paws)
      let hidden = false;
      for (const k of cull) {
        const dx = (p.x - k.center[0]) / k.scale[0];
        const dy = (p.y - k.center[1]) / k.scale[1];
        const dz = (p.z - k.center[2]) / k.scale[2];
        if (dx * dx + dy * dy + dz * dz < 1) { hidden = true; break; }
      }
      if (hidden) continue;
      n.set(u.x / a, u.y / b, u.z / c).normalize();
      points.push({ p: p.clone(), n: n.clone(), len: s.len ?? 1 });
    }
  }

  // `lay` bends each tuft off its own normal and down along the surface —
  // the difference between fur and a hedgehog
  const down = new THREE.Vector3(0, -1, 0), tang = new THREE.Vector3();

  const geo = tuftGeometry(THREE);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.92, metalness: 0,
    flatShading: true, side: THREE.DoubleSide
  });
  const mesh = new THREE.InstancedMesh(geo, mat, points.length);
  mesh.castShadow = true;
  mesh.receiveShadow = false;

  const base = new THREE.Color(color);
  const tint = new THREE.Color();
  const dummy = new THREE.Object3D();
  points.forEach((pt, i) => {
    // the downhill direction that still hugs the surface
    tang.copy(down).addScaledVector(pt.n, -down.dot(pt.n));
    if (tang.lengthSq() < 1e-5) tang.set(0, 0, -1);
    tang.normalize();
    dir.copy(pt.n).multiplyScalar(1 - lay).addScaledVector(tang, lay);
    dir.y -= droop * 0.16 * (1 - Math.abs(pt.n.y) * 0.5);   // a little more gravity
    dir.z -= sweep * 0.16; dir.x += (rand() - 0.5) * 0.32;   // sweep + mess
    dir.y += (rand() - 0.5) * 0.16;
    dir.normalize();
    q.setFromUnitVectors(up, dir);
    const L = length * FUR.length * pt.len * (0.72 + rand() * 0.6);
    const W = width * (0.78 + rand() * 0.55);
    dummy.position.copy(pt.p).addScaledVector(pt.n, -L * 0.42);
    dummy.quaternion.copy(q);
    dummy.scale.set(W, L, W);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    tint.copy(base).offsetHSL((rand() - 0.5) * tipHue, (rand() - 0.5) * 0.08, (rand() - 0.6) * 0.13);
    mesh.setColorAt(i, tint);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

/* ── the creature ───────────────────────────────────────── */

export function createCreature(THREE, look = {}) {
  const o = { ...DEFAULT_LOOK, ...look };
  const coat = (COAT_COLORS.find(c => c.id === o.coat) || COAT_COLORS[0]).fur;
  const bellyCol = (BELLY_COLORS.find(c => c.id === o.belly) || BELLY_COLORS[0]).belly;
  const accent = '#FF8A46';

  const cFur = new THREE.Color(coat);
  const skinCol = cFur.clone().multiplyScalar(0.62);
  const hornCol = new THREE.Color(bellyCol).multiplyScalar(0.56);

  const M = {
    skin:  new THREE.MeshStandardMaterial({ color: skinCol, roughness: 1, metalness: 0 }),
    belly: new THREE.MeshStandardMaterial({ color: bellyCol, roughness: 0.85, metalness: 0 }),
    horn:  new THREE.MeshStandardMaterial({ color: hornCol, roughness: 0.55, metalness: 0.05 }),
    dark:  new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.45 }),
    eye:   new THREE.MeshStandardMaterial({ color: 0xF7F2E6, roughness: 0.28 }),
    shine: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, emissive: 0x444444 }),
    tooth: new THREE.MeshStandardMaterial({ color: 0xF3EBD8, roughness: 0.35 }),
    accent:new THREE.MeshStandardMaterial({ color: accent, roughness: 0.75 })
  };

  const root = new THREE.Group();
  root.name = 'creature';

  /* legs + feet */
  const legs = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(0.235 * side, 0.36, 0);
    const specs = [{ center: [0, -0.15, 0], scale: [0.165, 0.20, 0.165] }];
    leg.add(ellipsoid(THREE, M.skin, specs[0].center, specs[0].scale, 20));
    const foot = new THREE.Mesh(roundedBox(THREE, 0.30, 0.155, 0.44, 0.075), M.belly);
    foot.position.set(0.01 * side, -0.30, 0.09);
    foot.castShadow = true;
    leg.add(foot);
    for (let t = -1; t <= 1; t++) {                      // toes
      const toe = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), M.belly);
      toe.position.set(t * 0.082, -0.30, 0.30);
      leg.add(toe);
      const nail = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.06, 8), M.horn);
      nail.position.set(t * 0.082, -0.295, 0.335);
      nail.rotation.x = Math.PI / 2.1;
      leg.add(nail);
    }
    leg.add(furField(THREE, specs, {
      color: coat, density: 3000, length: 0.050, width: 0.017, lay: 0.6,
      cull: [{ center: [0.01 * side, -0.30, 0.09], scale: [0.22, 0.15, 0.28] }]
    }));
    root.add(leg); legs.push(leg);
  }

  /* body */
  const body = new THREE.Group();
  body.position.set(0, 0.62, 0);
  root.add(body);

  const torsoSpecs = [
    { center: [0, 0.17, 0],     scale: [0.50, 0.49, 0.43] },
    { center: [0, -0.10, 0.03], scale: [0.45, 0.35, 0.40], density: 0.9 }
  ];
  torsoSpecs.forEach(s => body.add(ellipsoid(THREE, M.skin, s.center, s.scale)));
  // bald patches: the belly, and wherever an accessory has to sit
  const bodyCull = [{ center: [0, 0.02, 0.30], scale: [0.26, 0.30, 0.22] }];
  if (o.accessory === 'scarf') bodyCull.push({ center: [0, 0.53, 0.02], scale: [0.40, 0.135, 0.35] });
  // satchel now rides at the front hip, so the bald patch moves with it
  if (o.accessory === 'satchel') bodyCull.push({ center: [0.24, -0.02, 0.26], scale: [0.24, 0.22, 0.24] });

  const bellyPatch = ellipsoid(THREE, M.belly, [0, 0.02, 0.30], [0.30, 0.34, 0.20]);
  body.add(bellyPatch);
  body.add(furField(THREE, torsoSpecs, {
    color: coat, density: 2600, length: 0.078, width: 0.021, lay: 0.58,
    cull: bodyCull
  }));

  /* head */
  const head = new THREE.Group();
  head.position.set(0, 0.66, 0.015);
  body.add(head);

  const skullSpecs = [{ center: [0, 0.15, 0], scale: [0.415, 0.375, 0.375] }];
  head.add(ellipsoid(THREE, M.skin, skullSpecs[0].center, skullSpecs[0].scale, 32));

  const muzzle = ellipsoid(THREE, M.belly, [0, 0.045, 0.285], [0.255, 0.195, 0.235], 26);
  head.add(muzzle);
  const nose = ellipsoid(THREE, M.dark, [0, 0.135, 0.475], [0.075, 0.055, 0.065], 20);
  head.add(nose);

  // mouth line + two hopeful little fangs
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.10, 0.011, 8, 20, Math.PI * 0.9), M.dark);
  mouth.position.set(0, 0.02, 0.44);
  mouth.rotation.z = Math.PI;
  mouth.rotation.x = -0.25;
  head.add(mouth);
  for (const side of [-1, 1]) {
    const fang = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.062, 8), M.tooth);
    fang.position.set(0.062 * side, -0.005, 0.41);
    fang.rotation.x = 0.15;
    head.add(fang);
  }

  const headCull = [
    { center: [0, 0.045, 0.285], scale: [0.28, 0.22, 0.27] },   // muzzle
    { center: [0.175, 0.245, 0.30], scale: [0.135, 0.125, 0.16] },  // ears
    { center: [-0.175, 0.245, 0.30], scale: [0.135, 0.125, 0.16] }
  ];
  if (o.accessory === 'cap') headCull.push({ center: [0, 0.42, 0.10], scale: [0.36, 0.24, 0.42] });
  head.add(furField(THREE, skullSpecs, {
    color: coat, density: 3000, length: 0.062, width: 0.019, lay: 0.5, droop: 0.35,
    cull: headCull
  }));

  /* eyes */
  const eyes = [];
  const eyeScale = o.eyes === 'wide' ? 1.16 : o.eyes === 'sleepy' ? 0.94 : 1;
  const lidRest = o.eyes === 'wide' ? -2.0 : o.eyes === 'sleepy' ? -0.72 : -1.45;
  for (const side of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(0.168 * side, 0.245, 0.245);
    g.scale.setScalar(eyeScale);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 18), M.eye);
    ball.scale.set(1, 1.04, 0.9);
    g.add(ball);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.052, 18, 14), M.dark);
    iris.position.set(0.012 * side, 0.004, 0.062);
    g.add(iris);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.017, 10, 8), M.shine);
    shine.position.set(0.03 * side, 0.042, 0.10);
    g.add(shine);
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.113, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.skin);
    lid.scale.set(1, 1.05, 0.95);
    lid.rotation.x = lidRest;
    g.add(lid);
    head.add(g);
    eyes.push({ group: g, lid, rest: lidRest });

    const brow = new THREE.Mesh(roundedBox(THREE, 0.17, 0.042, 0.06, 0.02), M.skin);
    brow.position.set(0.175 * side, 0.375, 0.245);
    brow.rotation.z = -0.20 * side;
    brow.rotation.x = -0.15;
    head.add(brow);

    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.10, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.skin);
    ear.position.set(0.385 * side, 0.235, -0.03);
    ear.rotation.z = Math.PI / 2 * side;
    ear.scale.set(1, 0.75, 0.72);
    head.add(ear);
  }

  /* horns */
  if (o.horns !== 'none') {
    const curves = {
      curl: [[0,0,0],[0.055,0.175,-0.02],[0.10,0.295,-0.135],[0.055,0.255,-0.275],[-0.02,0.115,-0.30],[-0.045,0.035,-0.205]],
      nub:  [[0,0,0],[0.015,0.10,0.005],[0.03,0.185,-0.02]],
      antler:[[0,0,0],[0.05,0.155,-0.02],[0.115,0.29,-0.055],[0.14,0.40,-0.03]]
    };
    for (const side of [-1, 1]) {
      const pts = curves[o.horns].map(p => new THREE.Vector3(p[0] * side, p[1], p[2]));
      const curve = new THREE.CatmullRomCurve3(pts);
      const r0 = o.horns === 'nub' ? 0.072 : 0.066;
      const horn = new THREE.Mesh(taperedTube(THREE, curve, r0, 0.012, 30, 10), M.horn);
      horn.castShadow = true;
      horn.position.set(0.20 * side, 0.36, -0.02);
      head.add(horn);
      // ridges, so the horn reads as keratin and not a plastic tube
      const ridges = o.horns === 'nub' ? 3 : 7;
      for (let i = 1; i <= ridges; i++) {
        const t = i / (ridges + 1.2);
        const p = curve.getPointAt(t);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.055 * (1 - t * 0.72) + 0.004, 0.007, 6, 14), M.horn);
        ring.position.copy(p).add(new THREE.Vector3(0.20 * side, 0.36, -0.02));
        const tan = curve.getTangentAt(t);
        ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan);
        head.add(ring);
      }
      if (o.horns === 'antler') {
        const bp = [[0.06,0.19,-0.03],[0.155,0.255,0.03],[0.235,0.315,0.05]].map(p => new THREE.Vector3(p[0]*side,p[1],p[2]));
        const branch = new THREE.Mesh(taperedTube(THREE, new THREE.CatmullRomCurve3(bp), 0.03, 0.01, 20, 8), M.horn);
        branch.position.set(0.20 * side, 0.36, -0.02);
        branch.castShadow = true;
        head.add(branch);
      }
    }
  }

  /* arms */
  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.44 * side, 0.30, 0.01);
    const upperSpecs = [{ center: [0, -0.17, 0], scale: [0.135, 0.21, 0.135] }];
    shoulder.add(ellipsoid(THREE, M.skin, upperSpecs[0].center, upperSpecs[0].scale, 20));
    shoulder.add(furField(THREE, upperSpecs, { color: coat, density: 3200, length: 0.044, width: 0.016, lay: 0.62 }));

    const elbow = new THREE.Group();
    elbow.position.set(0, -0.33, 0);
    const foreSpecs = [{ center: [0, -0.15, 0], scale: [0.115, 0.185, 0.115] }];
    elbow.add(ellipsoid(THREE, M.skin, foreSpecs[0].center, foreSpecs[0].scale, 20));
    const paw = ellipsoid(THREE, M.belly, [0, -0.32, 0.015], [0.125, 0.115, 0.145], 20);
    elbow.add(paw);
    for (let t = -1; t <= 1; t++) {
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.019, 0.05, 8), M.horn);
      claw.position.set(t * 0.06, -0.335, 0.135);
      claw.rotation.x = Math.PI / 2.2;
      elbow.add(claw);
    }
    elbow.add(furField(THREE, foreSpecs, {
      color: coat, density: 3200, length: 0.040, width: 0.015, lay: 0.62,
      cull: [{ center: [0, -0.30, 0.015], scale: [0.17, 0.17, 0.19] }]
    }));
    shoulder.add(elbow);
    shoulder.rotation.z = 0.22 * side;
    body.add(shoulder);
    arms.push({ shoulder, elbow, side });
  }

  /* tail */
  const tailPts = [[0,0,0],[0.02,-0.06,-0.20],[0.06,-0.02,-0.36],[0.08,0.10,-0.44]].map(p => new THREE.Vector3(...p));
  const tail = new THREE.Group();
  tail.position.set(0, -0.12, -0.34);
  const tailMesh = new THREE.Mesh(taperedTube(THREE, new THREE.CatmullRomCurve3(tailPts), 0.075, 0.028, 24, 10), M.skin);
  tailMesh.castShadow = true;
  tail.add(tailMesh);
  const tailTip = ellipsoid(THREE, M.belly, [0.08, 0.10, -0.45], [0.055, 0.055, 0.055], 16);
  tail.add(tailTip);
  tail.add(furField(THREE, [
    { center: [0.02,-0.06,-0.20], scale: [0.075,0.075,0.075] },
    { center: [0.06,-0.02,-0.33], scale: [0.06,0.06,0.06] }
  ], { color: coat, density: 4000, length: 0.048, width: 0.015, lay: 0.55 }));
  body.add(tail);

  /* accessory */
  if (o.accessory === 'scarf') {
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.075, 12, 26), M.accent);
    scarf.position.set(0, 0.53, 0.02);
    scarf.rotation.x = Math.PI / 2;
    scarf.scale.set(1, 1, 0.8);
    scarf.castShadow = true;
    body.add(scarf);
    const tailEnd = new THREE.Mesh(roundedBox(THREE, 0.13, 0.36, 0.07, 0.03), M.accent);
    tailEnd.position.set(0.20, 0.36, 0.26);
    tailEnd.rotation.z = 0.25;
    body.add(tailEnd);
  } else if (o.accessory === 'cap') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.accent);
    cap.position.set(0, 0.44, 0.02);
    cap.rotation.x = -0.20;
    cap.scale.set(1, 0.68, 1);
    cap.castShadow = true;
    head.add(cap);
    const brim = new THREE.Mesh(roundedBox(THREE, 0.40, 0.045, 0.26, 0.02), M.accent);
    brim.position.set(0, 0.415, 0.30);
    brim.rotation.x = -0.18;
    head.add(brim);
  } else if (o.accessory === 'satchel') {
    const bag = new THREE.Mesh(roundedBox(THREE, 0.30, 0.26, 0.15, 0.045), M.accent);
    bag.position.set(0.26, -0.04, 0.32);
    bag.rotation.y = -0.35;
    bag.castShadow = true;
    body.add(bag);
    const flap = new THREE.Mesh(roundedBox(THREE, 0.31, 0.11, 0.03, 0.02), M.trim ?? M.accent);
    flap.position.set(0.255, 0.055, 0.375);
    flap.rotation.y = -0.35; flap.rotation.x = 0.15;
    body.add(flap);
    // crossbody strap: left shoulder, down over the chest, to the bag on the front-right hip
    const strapPts = [[-0.30, 0.50, 0.24], [-0.14, 0.36, 0.36], [0.10, 0.14, 0.38], [0.26, -0.06, 0.34]]
      .map(p => new THREE.Vector3(...p));
    const strap = new THREE.Mesh(taperedTube(THREE, new THREE.CatmullRomCurve3(strapPts), 0.032, 0.032, 26, 8), M.accent);
    strap.castShadow = true;
    body.add(strap);
  }

  /* where a parcel goes when he is carrying one */
  const hands = new THREE.Object3D();
  hands.position.set(0, 0.36, 0.55);
  body.add(hands);

  /* build proportions */
  if (o.build === 'stout') root.scale.set(1.12, 0.93, 1.12);
  if (o.build === 'lanky') root.scale.set(0.88, 1.10, 0.88);

  /* ── animation ─────────────────────────────────────────── */
  const POSES = {
    idle:  { armX: 0.10, armZ: 0.22, elbow: -0.25, headX: 0, lean: 0 },
    carry: { armX: -1.28, armZ: 0.30, elbow: -0.62, headX: -0.10, lean: 0.06 },
    wave:  { armX: 0.10, armZ: 0.22, elbow: -0.25, headX: -0.05, lean: 0 },
    ride:  { armX: -0.95, armZ: 0.14, elbow: -0.75, headX: -0.05, lean: 0.04 },
    walk:  { armX: 0.05, armZ: 0.26, elbow: -0.35, headX: 0, lean: 0.05 }
  };

  const state = {
    pose: 'idle', t: 0, blink: 2 + Math.random() * 3, blinkT: 0,
    cur: { ...POSES.idle }, walk: 0, wave: 0
  };

  function update(dt) {
    state.t += dt;
    const target = POSES[state.pose] || POSES.idle;
    const k = 1 - Math.pow(0.0025, dt);                 // frame-rate independent ease
    for (const key in target) state.cur[key] += (target[key] - state.cur[key]) * k;

    const t = state.t;
    const breath = Math.sin(t * 1.7) * 0.5 + 0.5;
    body.scale.set(1 + breath * 0.018, 1 - breath * 0.022, 1 + breath * 0.018);
    body.position.y = 0.62 + Math.sin(t * 1.7) * 0.012;
    body.rotation.x = state.cur.lean;
    body.rotation.z = Math.sin(t * 0.6) * 0.018;

    head.rotation.x = state.cur.headX + Math.sin(t * 0.9 + 1) * 0.035;
    head.rotation.y = Math.sin(t * 0.45) * 0.10;
    head.rotation.z = Math.sin(t * 0.7 + 2) * 0.03;

    // blink
    state.blink -= dt;
    if (state.blink <= 0) { state.blinkT = 0.16; state.blink = 2.4 + Math.random() * 4; }
    const closing = state.blinkT > 0 ? Math.sin((1 - state.blinkT / 0.16) * Math.PI) : 0;
    if (state.blinkT > 0) state.blinkT -= dt;
    eyes.forEach(e => { e.lid.rotation.x = e.rest + (0.30 - e.rest) * closing; });

    // limbs
    const swing = state.pose === 'walk' ? Math.sin(t * 7) : 0;
    legs.forEach((leg, i) => {
      leg.rotation.x = swing * 0.55 * (i ? -1 : 1);
      leg.position.y = 0.36 + (state.pose === 'walk' ? Math.abs(Math.sin(t * 7 + i * Math.PI)) * 0.05 : 0);
    });
    arms.forEach((a, i) => {
      const s = a.side;
      let ax = state.cur.armX, az = state.cur.armZ * s, el = state.cur.elbow;
      if (state.pose === 'walk') ax += -swing * 0.5 * (i ? -1 : 1);
      if (state.pose === 'idle')  ax += Math.sin(t * 1.6 + i) * 0.05;
      if (state.pose === 'wave' && s === 1) {
        // shoulder swings from "hanging down" toward "raised up and out" —
        // positive Z here (not negative), or the arm swings into the body instead
        az = 2.68 + Math.sin(t * 7) * 0.26;
        ax = -0.18;
        el = -0.55 + Math.sin(t * 7 + 1) * 0.12;   // a little elbow flourish, timed with the swing
      }
      a.shoulder.rotation.set(ax, 0, az);
      a.elbow.rotation.x = el;
    });

    tail.rotation.y = Math.sin(t * 1.9) * 0.35;
    tail.rotation.x = Math.sin(t * 1.3) * 0.12;
  }

  return {
    group: root, hands, head, body, arms, legs,
    look: o,
    setPose(p) { if (POSES[p]) state.pose = p; },
    getPose() { return state.pose; },
    update,
    dispose() {
      root.traverse(n => {
        if (n.geometry) n.geometry.dispose();
        if (n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach(m => m.dispose());
      });
    }
  };
}

/* a parcel, because he needs something to carry */
export function createParcel(THREE, size = 0.36) {
  const g = new THREE.Group();
  const card = new THREE.MeshStandardMaterial({ color: 0xC49A63, roughness: 0.95 });
  const tape = new THREE.MeshStandardMaterial({ color: 0xE8DFCB, roughness: 0.7 });
  const box = new THREE.Mesh(roundedBox(THREE, size, size * 0.82, size * 0.86, size * 0.045), card);
  box.castShadow = true; box.receiveShadow = true;
  g.add(box);
  const t1 = new THREE.Mesh(new THREE.BoxGeometry(size * 0.16, size * 0.83, size * 0.87), tape);
  g.add(t1);
  const t2 = new THREE.Mesh(new THREE.BoxGeometry(size * 1.01, size * 0.16, size * 0.2), tape);
  t2.position.set(0, size * 0.18, size * 0.44);
  g.add(t2);
  const label = new THREE.Mesh(new THREE.PlaneGeometry(size * 0.4, size * 0.28), new THREE.MeshStandardMaterial({ color: 0xF4EFE3, roughness: 0.6 }));
  label.position.set(size * 0.2, 0, size * 0.437);
  g.add(label);
  return g;
}
