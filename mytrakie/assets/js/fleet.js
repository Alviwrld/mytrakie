/* ─────────────────────────────────────────────────────────────
   fleet.js — who's carrying it, and what it looks like.
   Carrier names and liveries are used only to identify the service.
   ───────────────────────────────────────────────────────────── */

export const CARRIERS = {
  ups:        { name: 'UPS',          body: '#57381C', accent: '#FFB500', trim: '#3A2411', glass: '#12233A' },
  fedex:      { name: 'FedEx',        body: '#EDEDF2', accent: '#4D148C', trim: '#FF6600', glass: '#12233A' },
  usps:       { name: 'USPS',         body: '#F1F2F5', accent: '#004B87', trim: '#DA291C', glass: '#12233A' },
  dhl:        { name: 'DHL',          body: '#FFCC00', accent: '#D40511', trim: '#B8000B', glass: '#12233A' },
  amazon:     { name: 'Amazon',       body: '#2B3542', accent: '#FF9900', trim: '#1B2530', glass: '#12233A' },
  ontrac:     { name: 'OnTrac',       body: '#12694A', accent: '#8DC63F', trim: '#0C4A34', glass: '#12233A' },
  royalmail:  { name: 'Royal Mail',   body: '#DA291C', accent: '#FFD200', trim: '#A11F14', glass: '#12233A' },
  canadapost: { name: 'Canada Post',  body: '#F0F0F0', accent: '#E31937', trim: '#B01329', glass: '#12233A' },
  australiapost:{ name: 'Australia Post', body: '#DC1928', accent: '#FFFFFF', trim: '#9E1220', glass: '#12233A' },
  yunexpress: { name: 'YunExpress',   body: '#1F4FA8', accent: '#F5A623', trim: '#163A7B', glass: '#12233A' },
  generic:    { name: 'Carrier',      body: '#2D6CDF', accent: '#9CC0FF', trim: '#1E4C9E', glass: '#12233A' }
};

const PATTERNS = [
  ['ups',       /^1Z[0-9A-Z]{16}$/i],
  ['ups',       /^(T\d{10}|\d{9}|\d{12})$/],
  ['fedex',     /^\d{12}$|^\d{15}$|^\d{20}$|^\d{22}$/],
  ['usps',      /^(94|93|92|95|82)\d{18,24}$/],
  ['usps',      /^[A-Z]{2}\d{9}US$/i],
  ['dhl',       /^\d{10,11}$/],
  ['dhl',       /^JJD\d{15,20}$/i],
  ['amazon',    /^TBA\d{10,12}$/i],
  ['royalmail', /^[A-Z]{2}\d{9}GB$/i],
  ['canadapost',/^\d{16}$/],
  ['australiapost', /^[A-Z]{2}\d{9}AU$/i],
  ['yunexpress',/^YT\d{14,18}$/i]
];

export function detectCarrier(raw) {
  const n = String(raw || '').replace(/[\s-]/g, '').toUpperCase();
  for (const [id, re] of PATTERNS) if (re.test(n)) return id;
  return 'generic';
}

export function carrier(id) { return CARRIERS[id] || CARRIERS.generic; }

/* ── shared bits ────────────────────────────────────────── */

function box(THREE, w, h, d, r, mat) {
  r = Math.min(r, w / 2, h / 2, d / 2);
  const g = new THREE.BoxGeometry(w - 2 * r, h - 2 * r, d - 2 * r, 2, 2, 2);
  const pos = g.attributes.position;
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  const v = new THREE.Vector3(), c = new THREE.Vector3(), dir = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.set(THREE.MathUtils.clamp(v.x, -hx, hx), THREE.MathUtils.clamp(v.y, -hy, hy), THREE.MathUtils.clamp(v.z, -hz, hz));
    dir.copy(v).sub(c);
    if (dir.lengthSq() < 1e-9) dir.set(0, 1, 0);
    dir.normalize().multiplyScalar(r);
    pos.setXYZ(i, c.x + dir.x, c.y + dir.y, c.z + dir.z);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

// Carrier wordmark painted on the side panel — plain type, no logos.
function nameplate(THREE, text, fg, bg) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, 512, 160);
  x.fillStyle = fg;
  x.font = '800 96px "Bricolage Grotesque", system-ui, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text.toUpperCase(), 256, 88);
  x.globalAlpha = 0.75; x.font = '500 26px "JetBrains Mono", monospace';
  x.fillText('TRAKIE · EXPRESS', 256, 26);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function mats(THREE, cfg) {
  return {
    body:  new THREE.MeshStandardMaterial({ color: cfg.body, roughness: 0.42, metalness: 0.12 }),
    accent:new THREE.MeshStandardMaterial({ color: cfg.accent, roughness: 0.45, metalness: 0.1 }),
    trim:  new THREE.MeshStandardMaterial({ color: cfg.trim, roughness: 0.5 }),
    glass: new THREE.MeshStandardMaterial({ color: cfg.glass, roughness: 0.12, metalness: 0.5, transparent: true, opacity: 0.72 }),
    tire:  new THREE.MeshStandardMaterial({ color: 0x1B1B21, roughness: 0.95 }),
    hub:   new THREE.MeshStandardMaterial({ color: 0xC9CDD6, roughness: 0.35, metalness: 0.6 }),
    lamp:  new THREE.MeshStandardMaterial({ color: 0xFFF6D8, emissive: 0xFFD98A, emissiveIntensity: 1.4, roughness: 0.2 }),
    red:   new THREE.MeshStandardMaterial({ color: 0xFF4436, emissive: 0x8A1008, emissiveIntensity: 0.9, roughness: 0.3 }),
    dark:  new THREE.MeshStandardMaterial({ color: 0x23262E, roughness: 0.7 })
  };
}

/* ── delivery truck (forward = +Z) ──────────────────────── */
export function createTruck(THREE, carrierId) {
  const cfg = carrier(carrierId);
  const M = mats(THREE, cfg);
  const g = new THREE.Group();
  const wheels = [];

  const cargo = box(THREE, 2.05, 1.85, 2.55, 0.22, M.body);
  cargo.position.set(0, 1.42, -0.75);
  g.add(cargo);

  const stripe = box(THREE, 2.09, 0.30, 2.45, 0.08, M.accent);
  stripe.position.set(0, 0.95, -0.75);
  g.add(stripe);

  const roof = box(THREE, 1.7, 0.16, 2.2, 0.07, M.trim);
  roof.position.set(0, 2.36, -0.75);
  g.add(roof);

  const cab = box(THREE, 1.98, 1.35, 1.7, 0.28, M.body);
  cab.position.set(0, 1.12, 1.15);
  g.add(cab);

  const hood = box(THREE, 1.9, 0.5, 0.7, 0.2, M.body);
  hood.position.set(0, 0.78, 2.05);
  g.add(hood);

  const windshield = box(THREE, 1.62, 0.78, 0.1, 0.05, M.glass);
  windshield.position.set(0, 1.44, 1.94);
  windshield.rotation.x = -0.22;
  g.add(windshield);

  for (const s of [-1, 1]) {
    const win = box(THREE, 0.1, 0.62, 0.86, 0.05, M.glass);
    win.position.set(1.0 * s, 1.42, 1.28);
    g.add(win);
    const mirror = box(THREE, 0.1, 0.26, 0.1, 0.04, M.dark);
    mirror.position.set(1.16 * s, 1.5, 1.82);
    g.add(mirror);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), M.lamp);
    lamp.position.set(0.7 * s, 0.82, 2.36);
    lamp.scale.set(1, 0.8, 0.6);
    g.add(lamp);
    const tail = box(THREE, 0.16, 0.34, 0.08, 0.03, M.red);
    tail.position.set(0.86 * s, 1.0, -2.02);
    g.add(tail);

    // side panel with the carrier's name
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(2.0, 0.62),
      new THREE.MeshStandardMaterial({ map: nameplate(THREE, cfg.name, cfg.body === '#EDEDF2' || cfg.body === '#F1F2F5' || cfg.body === '#F0F0F0' ? cfg.accent : '#FFFFFF', cfg.body), roughness: 0.6 })
    );
    plate.position.set(1.035 * s, 1.62, -0.75);
    plate.rotation.y = (Math.PI / 2) * s;
    g.add(plate);
  }

  const bumper = box(THREE, 2.06, 0.3, 0.3, 0.1, M.trim);
  bumper.position.set(0, 0.52, 2.32);
  g.add(bumper);

  const wheelGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.32, 22);
  const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.34, 12);
  for (const z of [1.62, -1.32]) {
    for (const s of [-1, 1]) {
      const w = new THREE.Group();
      const tire = new THREE.Mesh(wheelGeo, M.tire);
      tire.rotation.z = Math.PI / 2; tire.castShadow = true;
      const hub = new THREE.Mesh(hubGeo, M.hub);
      hub.rotation.z = Math.PI / 2;
      w.add(tire, hub);
      w.position.set(0.96 * s, 0.46, z);
      g.add(w); wheels.push(w);
    }
  }

  // an open rear door so the parcel can be seen going in
  const doorway = box(THREE, 1.5, 1.4, 0.08, 0.04, M.dark);
  doorway.position.set(0, 1.32, -2.02);
  g.add(doorway);

  const seat = new THREE.Object3D();
  seat.position.set(0, 1.05, 1.15);
  g.add(seat);
  const cargoSlot = new THREE.Object3D();
  cargoSlot.position.set(0, 1.1, -0.7);
  g.add(cargoSlot);

  g.userData = { kind: 'truck', wheels, seat, cargoSlot, length: 5.0 };
  return g;
}

/* ── cargo plane (forward = +Z) ─────────────────────────── */
export function createPlane(THREE, carrierId) {
  const cfg = carrier(carrierId);
  const M = mats(THREE, cfg);
  const g = new THREE.Group();
  const fans = [];

  const white = new THREE.MeshStandardMaterial({ color: 0xF4F5F8, roughness: 0.35, metalness: 0.2 });

  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.58, 5.4, 24), white);
  fuse.rotation.x = Math.PI / 2;
  fuse.castShadow = true;
  g.add(fuse);

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.62, 22, 16), white);
  nose.position.z = 2.7; nose.scale.set(1, 0.95, 1.5);
  g.add(nose);

  const tailCone = new THREE.Mesh(new THREE.ConeGeometry(0.58, 1.9, 22), white);
  tailCone.position.set(0, 0.22, -3.35);
  tailCone.rotation.x = -Math.PI / 2 - 0.12;
  g.add(tailCone);

  const belt = new THREE.Mesh(new THREE.BoxGeometry(1.10, 0.22, 5.3), M.accent);
  belt.position.y = -0.10;
  g.add(belt);

  // cockpit + cabin windows
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 12), M.glass);
  cockpit.position.set(0, 0.22, 2.42);
  cockpit.scale.set(1.05, 0.6, 1.15);
  g.add(cockpit);
  for (let i = 0; i < 9; i++) {
    for (const s of [-1, 1]) {
      const win = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), M.glass);
      win.position.set(0.58 * s, 0.2, 1.7 - i * 0.42);
      win.scale.set(0.5, 1, 1);
      g.add(win);
    }
  }

  const wingGeo = box(THREE, 3.6, 0.16, 1.25, 0.07, white).geometry;
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(wingGeo, white);
    wing.position.set(1.95 * s, 0.05, -0.35);
    wing.rotation.y = 0.22 * s;
    wing.rotation.z = -0.06 * s;
    wing.castShadow = true;
    g.add(wing);

    const tip = box(THREE, 0.14, 0.55, 0.5, 0.06, M.accent);
    tip.position.set(3.68 * s, 0.25, -0.72);
    tip.rotation.z = -0.15 * s;
    g.add(tip);

    // engine
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.31, 1.15, 18), M.body);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(1.7 * s, -0.28, -0.05);
    pod.castShadow = true;
    g.add(pod);
    const intake = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.05, 8, 20), M.trim);
    intake.position.set(1.7 * s, -0.28, 0.55);
    g.add(intake);
    const fanGeo = new THREE.CylinderGeometry(0.27, 0.27, 0.05, 12);
    fanGeo.rotateX(Math.PI / 2);          // axis now runs along local Z, so .rotation.z spins it
    const fan = new THREE.Mesh(fanGeo, M.dark);
    fan.position.set(1.7 * s, -0.28, 0.52);
    for (let b = 0; b < 6; b++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.03), M.hub);
      blade.rotation.z = (b / 6) * Math.PI * 2;
      blade.position.z = 0.03;
      fan.add(blade);
    }
    g.add(fan); fans.push(fan);

    const stab = box(THREE, 1.3, 0.12, 0.6, 0.05, white);
    stab.position.set(0.72 * s, 0.72, -3.45);
    stab.rotation.y = 0.2 * s;
    g.add(stab);
  }

  const fin = box(THREE, 0.14, 1.5, 1.35, 0.08, M.body);
  fin.position.set(0, 1.05, -3.15);
  fin.rotation.x = -0.28;
  fin.castShadow = true;
  g.add(fin);

  const finPlate = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 0.45),
    new THREE.MeshStandardMaterial({ map: nameplate(THREE, cfg.name, '#FFFFFF', cfg.body), roughness: 0.6, transparent: true })
  );
  finPlate.position.set(0.085, 1.12, -3.02);
  finPlate.rotation.y = Math.PI / 2;
  finPlate.rotation.z = -0.28;
  g.add(finPlate);
  const finPlate2 = finPlate.clone();
  finPlate2.position.x = -0.085;
  finPlate2.rotation.y = -Math.PI / 2;
  g.add(finPlate2);

  const seat = new THREE.Object3D();
  seat.position.set(0, 0.28, 2.3);
  g.add(seat);
  const cargoSlot = new THREE.Object3D();
  cargoSlot.position.set(0, 0.1, 0.4);
  g.add(cargoSlot);

  g.userData = { kind: 'plane', fans, wheels: [], seat, cargoSlot, length: 6.5 };
  return g;
}

export function createVehicle(THREE, kind, carrierId) {
  return kind === 'plane' ? createPlane(THREE, carrierId) : createTruck(THREE, carrierId);
}

/* soft blob shadow — cheaper and softer than a real shadow map */
export function createShadowBlob(THREE, radius = 1.6) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const grad = x.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,.55)');
  grad.addColorStop(.55, 'rgba(0,0,0,.22)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = grad; x.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.005;
  return m;
}
