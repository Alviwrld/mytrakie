/* ─────────────────────────────────────────────────────────────
   stage.js — one canvas over the whole page. It runs three
   framings: the hero portrait, the load-up cinematic, and the
   map pin, where the vehicle is drawn in screen pixels on top
   of Leaflet.
   ───────────────────────────────────────────────────────────── */

import { createCreature, createParcel, DEFAULT_LOOK } from './creature.js';
import { createVehicle, createShadowBlob, carrier } from './fleet.js';

const CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.module.min.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
  'https://unpkg.com/three@0.160.0/build/three.module.js'
];

export async function loadThree() {
  let err;
  for (const url of CDN) {
    try { return await import(/* @vite-ignore */ url); }
    catch (e) { err = e; }
  }
  throw err || new Error('three.js failed to load');
}

const ease = {
  out: t => 1 - Math.pow(1 - t, 3),
  in: t => t * t * t,
  inOut: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  bounce(t) {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + .75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + .9375;
    return n * (t -= 2.625 / d) * t + .984375;
  }
};
const span = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const lerp = (a, b, t) => a + (b - a) * t;

export async function createStage(canvas) {
  const THREE = await loadThree();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();

  /* light: warm key from the front-left, cold rim from behind so the
     fur silhouette separates from the indigo page */
  const hemi = new THREE.HemisphereLight(0xBFD4FF, 0x241A12, 0.85);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xFFF0DC, 2.5);
  key.position.set(-3.4, 5.2, 4.6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1; key.shadow.camera.far = 24;
  key.shadow.camera.left = -7; key.shadow.camera.right = 7;
  key.shadow.camera.top = 7; key.shadow.camera.bottom = -7;
  key.shadow.bias = -0.0016;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8FB6FF, 1.85);
  rim.position.set(3.6, 3.4, -5.2);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xFFC98A, 0.55);
  fill.position.set(4.4, 1.2, 3.2);
  scene.add(fill);

  /* ground pad, only for the world framings */
  const padTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(128, 128, 10, 128, 128, 126);
    g.addColorStop(0, 'rgba(38,46,96,.95)');
    g.addColorStop(.7, 'rgba(20,26,68,.55)');
    g.addColorStop(1, 'rgba(12,16,48,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const pad = new THREE.Mesh(new THREE.CircleGeometry(9, 48), new THREE.MeshBasicMaterial({ map: padTex, transparent: true, depthWrite: false }));
  pad.rotation.x = -Math.PI / 2;
  scene.add(pad);
  const shadowCatcher = new THREE.Mesh(new THREE.CircleGeometry(9, 40), new THREE.ShadowMaterial({ opacity: 0.38 }));
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);

  /* rigs */
  const world = new THREE.Group(); scene.add(world);
  const creatureRig = new THREE.Group(); world.add(creatureRig);
  const creatureShadow = createShadowBlob(THREE, 0.95); creatureRig.add(creatureShadow);

  let creature = createCreature(THREE, DEFAULT_LOOK);
  creatureRig.add(creature.group);

  const parcel = createParcel(THREE, 0.42);
  parcel.visible = false;
  world.add(parcel);

  let vehicle = null, vehicleKind = 'truck', vehicleCarrier = 'generic';
  const vehicleRig = new THREE.Group(); world.add(vehicleRig);
  const vehicleShadow = createShadowBlob(THREE, 2.6); vehicleShadow.visible = false; vehicleRig.add(vehicleShadow);

  /* map pin rig, positioned in CSS pixels by an orthographic camera */
  const mapRig = new THREE.Group();
  const mapTilt = new THREE.Group(); mapTilt.rotation.x = -1.15; mapRig.add(mapTilt);
  const mapYaw = new THREE.Group(); mapTilt.add(mapYaw);
  mapRig.visible = false;
  scene.add(mapRig);

  /* cameras */
  const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
  cam.position.set(0.6, 1.5, 5.0);
  const camTarget = new THREE.Vector3(1.3, 0.95, 0);
  const ortho = new THREE.OrthographicCamera(0, 1, 0, -1, -2000, 2000);
  ortho.position.set(0, 0, 600);

  let mode = 'hero';
  let W = 1, H = 1;
  function resize() {
    W = Math.max(1, innerWidth); H = Math.max(1, innerHeight);
    renderer.setSize(W, H, false);
    cam.aspect = W / H; cam.updateProjectionMatrix();
    ortho.left = 0; ortho.right = W; ortho.top = 0; ortho.bottom = -H;
    ortho.updateProjectionMatrix();
    if (mode === 'hero') heroFraming();   // re-frame on rotate / window resize
  }
  resize();
  addEventListener('resize', resize, { passive: true });

  /* ── modes ─────────────────────────────────────────────── */
  const aim = { x: 0, y: 0, tx: 0, ty: 0 };

  function heroFraming() {
    const wide = W > 900;
    creatureRig.position.set(wide ? 1.45 : 0, 0, 0);
    creatureRig.rotation.y = wide ? -0.28 : 0;
    if (wide) {
      cam.position.set(0.55, 1.5, 5.1);
      camTarget.set(1.4, 0.95, 0);
    } else {
      // aim low so he sits in the top third, above the headline
      cam.position.set(0, 1.15, 5.3);
      camTarget.set(0, 0.15, 0);
    }
  }
  heroFraming();

  function setMode(next) {
    mode = next;
    const worldMode = next === 'hero' || next === 'cinematic' || next === 'portrait';
    world.visible = worldMode;
    pad.visible = worldMode;
    shadowCatcher.visible = worldMode;
    mapRig.visible = next === 'map';
    if (next === 'hero' || next === 'portrait') detachRiders();
    if (next !== 'hero') { pad.position.y = 0; shadowCatcher.position.y = 0.001; }
    if (next === 'hero') { heroFraming(); creature.setPose('idle'); parcel.visible = false; vehicleRig.visible = false; }
    if (next === 'portrait') {
      creatureRig.position.set(0, 0, 0); creatureRig.rotation.y = -0.35;
      cam.position.set(0.1, 1.45, 4.3); camTarget.set(0, 0.98, 0);
      creature.setPose('wave'); parcel.visible = false; vehicleRig.visible = false;
    }
  }

  // pull the passenger and the parcel out of a vehicle before it is thrown away
  function detachRiders() {
    if (creatureRig.parent !== world) {
      world.add(creatureRig);
      creatureRig.scale.setScalar(1);
      creatureRig.rotation.set(0, 0, 0);
      creatureRig.position.set(0, 0, 0);
      creatureShadow.visible = true;
    }
    if (parcel.parent !== world) { world.add(parcel); parcel.position.set(0, -99, 0); }
  }

  function makeVehicle(kind, carrierId) {
    detachRiders();
    if (vehicle) {
      if (vehicle.parent) vehicle.parent.remove(vehicle);
      vehicle.traverse(n => { if (n.isMesh && n.geometry) n.geometry.dispose(); });
    }
    vehicle = createVehicle(THREE, kind, carrierId);
    vehicleKind = kind; vehicleCarrier = carrierId;
    return vehicle;
  }

  /* ── the load-up ───────────────────────────────────────── */
  let cine = null;
  function playLoadUp(kind = 'truck', carrierId = 'generic') {
    setMode('cinematic');
    makeVehicle(kind, carrierId);
    vehicleRig.add(vehicle);
    vehicleRig.visible = true;
    vehicleShadow.visible = kind === 'truck';
    vehicleShadow.material.opacity = 1;
    creatureShadow.visible = true;
    vehicle.rotation.y = -Math.PI / 2;
    vehicle.position.set(16, kind === 'plane' ? 1.1 : 0, 0);

    creatureRig.position.set(0, 0, 0.35);
    creatureRig.rotation.y = 0.30;
    creatureRig.scale.setScalar(1);
    creature.setPose('idle');
    if (creature.group.parent !== creatureRig) creatureRig.add(creature.group);
    creature.group.position.set(0, 0, 0);

    parcel.visible = true;
    parcel.position.set(0.1, 4.2, 1.0);
    parcel.rotation.set(0.2, 0.5, 0.1);
    if (parcel.parent !== world) world.add(parcel);

    return new Promise(resolve => { cine = { t: 0, dur: 6.7, kind, resolve, attached: null }; });
  }

  const _v = new THREE.Vector3();
  function runCinematic(dt) {
    cine.t += dt;
    const t = Math.min(cine.t, cine.dur);
    const isPlane = cine.kind === 'plane';
    const groundY = isPlane ? 1.1 : 0;

    // parcel drops
    if (t < 1.5) {
      const p = span(t, 0.35, 1.35);
      parcel.position.y = lerp(4.2, 0.21, ease.bounce(p));
      parcel.rotation.y = 0.5 + (1 - p) * 2.4;
      parcel.rotation.x = 0.2 * (1 - p);
      parcel.rotation.z = 0.1 * (1 - p);
    }

    // he looks at it, then picks it up
    aim.tx = t > 1.2 && t < 2.4 ? -0.22 : 0;
    aim.ty = t > 1.2 && t < 2.4 ? -0.16 : 0;
    if (t > 1.75 && creature.getPose() === 'idle') creature.setPose('carry');

    if (t >= 1.9 && t < 3.7) {
      const p = ease.inOut(span(t, 1.9, 2.7));
      creature.hands.getWorldPosition(_v);
      parcel.position.lerpVectors(new THREE.Vector3(0.1, 0.21, 1.0), _v, p);
      parcel.position.y += Math.sin(p * Math.PI) * 0.35;
      parcel.rotation.y = lerp(0.5, 0.15, p);
      creatureRig.rotation.y = lerp(0.30, -0.05, p);
    }

    // the truck arrives
    if (t >= 2.5) {
      const p = ease.out(span(t, 2.5, 3.9));
      vehicle.position.x = lerp(16, 3.5, p);
      vehicle.position.y = groundY + (isPlane ? Math.sin(t * 2) * 0.06 : Math.max(0, Math.sin(p * Math.PI * 3)) * 0.045 * (1 - p));
      (vehicle.userData.wheels || []).forEach(w => { w.rotation.x -= dt * 9 * (1 - p) + dt * 0.4; });
      vehicleShadow.position.set(vehicle.position.x, 0.01, 0);
    }

    // parcel goes in the back
    if (t >= 3.9 && t < 4.9) {
      const p = ease.inOut(span(t, 3.9, 4.7));
      if (parcel.parent !== world) world.add(parcel);
      vehicle.userData.cargoSlot.getWorldPosition(_v);
      if (!cine.parcelFrom) cine.parcelFrom = parcel.getWorldPosition(new THREE.Vector3());
      parcel.position.lerpVectors(cine.parcelFrom, _v, p);
      parcel.position.y += Math.sin(p * Math.PI) * 0.6;
      parcel.rotation.y = lerp(0.15, -Math.PI / 2, p);
      parcel.scale.setScalar(lerp(1, 0.9, p));
      if (p > 0.98 && parcel.parent !== vehicle.userData.cargoSlot) {
        vehicle.userData.cargoSlot.add(parcel);
        parcel.position.set(0, 0, 0);
      }
      if (t > 4.4) creature.setPose('idle');
    }

    // and he hops in
    if (t >= 4.8 && t < 5.9) {
      const p = ease.inOut(span(t, 4.8, 5.6));
      vehicle.userData.seat.getWorldPosition(_v);
      if (!cine.hopFrom) cine.hopFrom = creatureRig.position.clone();
      creatureRig.position.lerpVectors(cine.hopFrom, _v, p);
      creatureRig.position.y += Math.sin(p * Math.PI) * 1.5;
      creatureRig.rotation.y = lerp(-0.05, -Math.PI / 2, p);
      creatureRig.scale.setScalar(lerp(1, isPlane ? 0.42 : 0.6, p));
      creatureShadow.visible = p < 0.5;
      if (p > 0.98) creature.setPose('ride');
    }

    // exit stage left
    if (t >= 5.7) {
      const p = ease.in(span(t, 5.7, 6.7));
      const x = lerp(3.5, -16, p);
      vehicle.position.x = x;
      if (isPlane) vehicle.position.y = groundY + p * 3.2;
      (vehicle.userData.wheels || []).forEach(w => { w.rotation.x -= dt * 14 * p; });
      vehicleShadow.position.set(x, 0.01, 0);
      vehicleShadow.material.opacity = 1 - p;
      vehicle.userData.seat.getWorldPosition(_v);
      creatureRig.position.copy(_v);
    }

    // camera
    const camA = { p: [0.9, 1.45, 4.0], t: [0.1, 0.95, 0.4] };
    const camB = { p: [1.9, 1.9, 6.6], t: [1.5, 1.05, 0.0] };
    const camC = { p: [0.2, 2.4, 8.6], t: [-0.6, 1.2, 0.0] };
    let from = camA, to = camB, k = ease.inOut(span(t, 2.4, 4.2));
    if (t > 4.6) { from = camB; to = camC; k = ease.inOut(span(t, 4.8, 6.4)); }
    cam.position.set(lerp(from.p[0], to.p[0], k), lerp(from.p[1], to.p[1], k), lerp(from.p[2], to.p[2], k));
    camTarget.set(lerp(from.t[0], to.t[0], k), lerp(from.t[1], to.t[1], k), lerp(from.t[2], to.t[2], k));

    if (cine.t >= cine.dur) {
      const done = cine.resolve;
      cine = null;
      creatureShadow.visible = true;
      done && done();
    }
  }

  function skipCinematic() { if (cine) cine.t = cine.dur - 0.001; }

  /* ── map pin ───────────────────────────────────────────── */
  const pin = { x: -999, y: -999, heading: 0, scale: 20, kind: 'truck', active: false };

  function setMapVehicle(kind, carrierId) {
    if (!vehicle || kind !== vehicleKind || carrierId !== vehicleCarrier) makeVehicle(kind, carrierId);
    if (vehicle.parent !== mapYaw) mapYaw.add(vehicle);
    vehicle.position.set(0, 0, 0);
    vehicle.rotation.set(0, 0, 0);

    // put him behind the wheel
    creature.setPose('ride');
    vehicle.userData.seat.add(creatureRig);
    creatureRig.scale.setScalar(kind === 'plane' ? 0.42 : 0.6);
    creatureRig.position.set(0, kind === 'plane' ? -0.42 : -0.62, kind === 'plane' ? -0.12 : 0);
    creatureRig.rotation.set(0, 0, 0);
    creatureShadow.visible = false;

    vehicle.userData.cargoSlot.add(parcel);
    parcel.position.set(0, 0, 0);
    parcel.rotation.set(0, 0, 0);
    parcel.scale.setScalar(0.9);
    parcel.visible = true;
  }

  function setMapAnchor({ x, y, heading, scale, visible = true }) {
    pin.x = x; pin.y = y; pin.active = visible;
    if (typeof heading === 'number') pin.heading = heading;
    if (typeof scale === 'number') pin.scale = scale;
  }

  /* ── loop ──────────────────────────────────────────────── */
  let last = performance.now(), raf = 0, running = true;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!running) return;

    if (cine) runCinematic(dt);
    creature.update(reduced ? dt * 0.4 : dt);

    // he belongs to the hero section, so he leaves with it
    if (mode === 'hero') {
      const dist = cam.position.distanceTo(camTarget);
      const worldPerPx = (2 * dist * Math.tan((cam.fov * Math.PI / 180) / 2)) / H;
      const lift = (scrollY || 0) * worldPerPx;
      creatureRig.position.y = lift;
      pad.position.y = lift;
      shadowCatcher.position.y = lift + 0.001;
      world.visible = pad.visible = shadowCatcher.visible = (scrollY || 0) < H * 1.15;
    }

    // pointer aim, applied after the idle animation
    aim.x += (aim.tx - aim.x) * Math.min(1, dt * 6);
    aim.y += (aim.ty - aim.y) * Math.min(1, dt * 6);
    creature.head.rotation.y += aim.x;
    creature.head.rotation.x += aim.y;

    if (mode === 'map') {
      mapRig.visible = pin.active;
      mapRig.position.set(pin.x, -pin.y, 0);
      mapYaw.rotation.y = pin.heading;
      mapTilt.scale.setScalar(pin.scale);
      if (vehicle) {
        (vehicle.userData.wheels || []).forEach(w => { w.rotation.x -= dt * 6; });
        (vehicle.userData.fans || []).forEach(f => { f.rotation.z += dt * 22; });
        vehicle.position.y = vehicle.userData.kind === 'plane'
          ? Math.sin(now / 700) * 0.10
          : Math.abs(Math.sin(now / 90)) * 0.035;
        vehicle.rotation.z = vehicle.userData.kind === 'plane' ? Math.sin(now / 1300) * 0.06 : 0;
      }
      renderer.render(scene, ortho);
      return;
    }

    if (vehicle && vehicle.userData.fans) vehicle.userData.fans.forEach(f => { f.rotation.z += dt * 18; });
    cam.lookAt(camTarget);
    renderer.render(scene, cam);
  }
  raf = requestAnimationFrame(frame);

  /* rebuild him when the customiser changes something */
  function setLook(look) {
    const parent = creature.group.parent;
    const pose = creature.getPose();
    parent.remove(creature.group);
    creature.dispose();
    creature = createCreature(THREE, look);
    creature.setPose(pose);
    parent.add(creature.group);
  }

  return {
    THREE, scene, renderer,
    setMode, setLook, playLoadUp, skipCinematic, setMapVehicle, setMapAnchor, resize,
    get mode() { return mode; },
    aimAt(nx, ny) { if (mode === 'hero' || mode === 'portrait') { aim.tx = nx * 0.30; aim.ty = ny * 0.16; } },
    pause() { running = false; },
    resume() { last = performance.now(); running = true; },
    stop() { cancelAnimationFrame(raf); renderer.dispose(); }
  };
}
