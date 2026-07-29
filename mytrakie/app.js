/* ─────────────────────────────────────────────────────────────
   app.js — data in, courier out.
   ───────────────────────────────────────────────────────────── */

import { createStage } from './stage.js';
import { CARRIERS, carrier, detectCarrier } from './fleet.js';
import { COAT_COLORS, BELLY_COLORS, HORN_STYLES, EYE_STYLES, ACCESSORIES, DEFAULT_LOOK } from './creature.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* ── look storage ───────────────────────────────────────── */
const STORE = 'trakie.look.v1';
let look = { ...DEFAULT_LOOK };
try { Object.assign(look, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (e) { /* private mode */ }
look.build = 'classic';
function saveLook() { try { localStorage.setItem(STORE, JSON.stringify(look)); } catch (e) {} }

/* ── geo helpers ────────────────────────────────────────── */
const R = 6371;
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;

function haversine(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// slerp along the sphere so long hops bow like a real flight path
function greatCircle(a, b, n) {
  const φ1 = rad(a.lat), λ1 = rad(a.lng), φ2 = rad(b.lat), λ2 = rad(b.lng);
  const d = 2 * Math.asin(Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2));
  const out = [];
  if (d < 1e-9) return [{ ...a }, { ...b }];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    out.push({ lat: deg(Math.atan2(z, Math.hypot(x, y))), lng: deg(Math.atan2(y, x)) });
  }
  return out;
}

// gentle bow for ground legs, so the line doesn't look like a ruler
function groundArc(a, b, n) {
  const out = [];
  const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
  const nx = -(b.lat - a.lat), ny = (b.lng - a.lng);
  const len = Math.hypot(nx, ny) || 1;
  const bow = Math.min(0.09, len * 0.09);
  const c = { lat: mid.lat + (ny / len) * bow * 0.6, lng: mid.lng + (nx / len) * bow };
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push({
      lat: u * u * a.lat + 2 * u * t * c.lat + t * t * b.lat,
      lng: u * u * a.lng + 2 * u * t * c.lng + t * t * b.lng
    });
  }
  return out;
}

/* ── route ──────────────────────────────────────────────── */
// How he travels a leg. If we know when both scans happened, the implied
// speed decides it — nothing on a road averages 110 km/h door to door.
// Without times, fall back to distance.
function legMode(a, b, dist) {
  if (dist > 2200) return 'plane';
  const ta = a.time && Date.parse(a.time), tb = b.time && Date.parse(b.time);
  if (ta && tb && tb > ta) return (dist / ((tb - ta) / 3600e3)) > 110 ? 'plane' : 'truck';
  return dist > 1200 ? 'plane' : 'truck';
}

function buildRoute(stops) {
  const pts = [], legs = [];
  let total = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    const dist = haversine(a, b);
    if (dist < 1) continue;
    const mode = legMode(a, b, dist);
    const seg = mode === 'plane' ? greatCircle(a, b, 48) : groundArc(a, b, 24);
    const start = total;
    for (let j = 0; j < seg.length; j++) {
      if (j > 0) total += haversine(seg[j - 1], seg[j]);
      pts.push({ ...seg[j], d: total, leg: legs.length });
    }
    legs.push({ from: a, to: b, mode, dist, start, end: total, iFrom: i, iTo: i + 1 });
  }
  return { pts, legs, total: total || 1 };
}

function pointAt(route, f) {
  const d = Math.max(0, Math.min(1, f)) * route.total;
  const p = route.pts;
  let lo = 0, hi = p.length - 1;
  while (lo < hi - 1) { const m = (lo + hi) >> 1; (p[m].d <= d) ? lo = m : hi = m; }
  const a = p[lo], b = p[hi];
  const t = b.d === a.d ? 0 : (d - a.d) / (b.d - a.d);
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t, leg: a.leg, i: lo };
}

/* ── demo shipments (used when no carrier key is configured) ── */
const CITY = {
  shenzhen:{ city:'Shenzhen', country:'CN', lat:22.543, lng:114.058 },
  hongkong:{ city:'Hong Kong', country:'HK', lat:22.308, lng:113.918 },
  anchorage:{ city:'Anchorage, AK', country:'US', lat:61.174, lng:-149.996 },
  cincinnati:{ city:'Cincinnati, OH', country:'US', lat:39.049, lng:-84.667 },
  louisville:{ city:'Louisville, KY', country:'US', lat:38.174, lng:-85.736 },
  indianapolis:{ city:'Indianapolis, IN', country:'US', lat:39.717, lng:-86.294 },
  denver:{ city:'Denver, CO', country:'US', lat:39.849, lng:-104.673 },
  ontario:{ city:'Ontario, CA', country:'US', lat:34.056, lng:-117.601 },
  temecula:{ city:'Temecula, CA', country:'US', lat:33.494, lng:-117.148 },
  memphis:{ city:'Memphis, TN', country:'US', lat:35.042, lng:-89.977 },
  austin:{ city:'Austin, TX', country:'US', lat:30.194, lng:-97.670 }
};
const H = 3600e3;

function demo(kind) {
  const now = Date.now();
  const mk = (place, msg, hoursAgo, status = 'in_transit') =>
    ({ ...CITY[place], message: msg, time: new Date(now - hoursAgo * H).toISOString(), status });

  if (kind === 'fedex') return {
    number: '392845761203', carrier: 'fedex', status: 'in_transit', source: 'demo',
    eta: new Date(now + 14 * H).toISOString(),
    destination: CITY.temecula,
    checkpoints: [
      mk('austin', 'Shipment picked up', 41, 'pre_transit'),
      mk('austin', 'Left origin facility', 37),
      mk('memphis', 'Arrived at hub', 28),
      mk('memphis', 'Departed on flight', 4)
    ]
  };
  if (kind === 'dhl') return {
    number: 'JJD0002340012345678', carrier: 'dhl', status: 'in_transit', source: 'demo',
    eta: new Date(now + 32 * H).toISOString(),
    destination: CITY.temecula,
    checkpoints: [
      mk('shenzhen', 'Shipment collected', 112, 'pre_transit'),
      mk('hongkong', 'Processed at export facility', 104),
      mk('hongkong', 'Departed on flight', 98),
      mk('anchorage', 'Transit through Anchorage', 74),
      mk('cincinnati', 'Cleared customs', 40)
    ]
  };
  return {
    number: '1Z999AA10123456784', carrier: 'ups', status: 'in_transit', source: 'demo',
    eta: new Date(now + 22 * H).toISOString(),
    destination: CITY.temecula,
    checkpoints: [
      mk('louisville', 'Origin scan', 62, 'pre_transit'),
      mk('indianapolis', 'Departed facility', 54),
      mk('denver', 'Arrived at facility', 12)
    ]
  };
}

/* ── tracking API ───────────────────────────────────────── */
async function fetchTracking(number, carrierId) {
  const url = `/api/track?number=${encodeURIComponent(number)}&carrier=${encodeURIComponent(carrierId)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Carrier returned ${res.status}`);
  const data = await res.json();
  if (!data.checkpoints || !data.checkpoints.length) throw new Error('No scans on this number yet.');
  return data;
}

/* ── state ──────────────────────────────────────────────── */
const state = {
  shipment: null, route: null, progress: 0, shown: 0, follow: true,
  map: null, layers: {}, poll: null, lastScanCount: 0, reached: 0
};

/* ── waybill ────────────────────────────────────────────── */
const STATUS = {
  pre_transit:      { label: 'Label made', tone: 'transit' },
  in_transit:       { label: 'In transit', tone: 'transit' },
  out_for_delivery: { label: 'Out for delivery', tone: 'out' },
  delivered:        { label: 'Delivered', tone: 'delivered' },
  exception:        { label: 'Held up', tone: 'exception' },
  unknown:          { label: 'Unknown', tone: 'transit' }
};

const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
const fmtTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const fmtScan = new Intl.DateTimeFormat(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

function renderWaybill(s) {
  const c = carrier(s.carrier);
  const st = STATUS[s.status] || STATUS.unknown;
  $('#wb-carrier').textContent = c.name;
  $('#wb-number').textContent = s.number;
  const pill = $('#wb-status');
  pill.textContent = st.label;
  pill.dataset.tone = st.tone;

  const eta = s.eta ? new Date(s.eta) : null;
  $('#wb-eta').textContent = s.status === 'delivered'
    ? 'Delivered'
    : eta ? `${fmtDay.format(eta)}, ${fmtTime.format(eta)}` : 'Carrier hasn’t said';

  const first = s.checkpoints[0], last = s.checkpoints[s.checkpoints.length - 1];
  $('#wb-route').textContent = `${first.city || '—'}  →  ${s.destination?.city || last.city || '—'}`;

  const scans = $('#wb-scans');
  scans.innerHTML = '';
  [...s.checkpoints].reverse().forEach((cp, i) => {
    const li = document.createElement('li');
    if (i === 0) li.setAttribute('data-current', '');
    const t = new Date(cp.time);
    li.innerHTML = `<time datetime="${cp.time}">${fmtScan.format(t)}</time>
      <div><p>${escapeHtml(cp.message || STATUS[cp.status]?.label || 'Scanned')}</p>
      <p class="place">${escapeHtml([cp.city, cp.country].filter(Boolean).join(' · '))}</p></div>`;
    scans.appendChild(li);
  });

  $('#wb-foot').textContent = s.source === 'demo' ? 'TRAKIE · SAMPLE DATA' : 'TRAKIE · LIVE';

  const old = $('#wb-why');
  if (old) old.remove();
  if (s.source === 'demo') {
    const why = document.createElement('p');
    why.className = 'waybill__why';
    why.id = 'wb-why';
    why.innerHTML = `<b>This is a sample route, not your parcel.</b> ${escapeHtml(s.note || 'No tracking provider is configured.')}
      Add <code>AFTERSHIP_API_KEY</code> to the Pages project and redeploy to show real scans.`;
    $('#wb-scans').insertAdjacentElement('afterend', why);
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function renderProgress() {
  const pct = Math.round(state.shown * 100);
  $('#wb-progress-fill').style.width = pct + '%';
  $('#wb-progress-pct').textContent = pct + '%';
  const leg = currentLeg();
  const s = state.shipment;
  $('#wb-progress-mode').textContent =
    s.status === 'delivered' ? 'Dropped off' :
    leg ? (leg.mode === 'plane' ? 'In the air' : 'On the road') : 'Waiting for pickup';
}

/* ── progress maths ─────────────────────────────────────── */
function computeProgress(s, route, reached) {
  if (s.status === 'delivered') return 1;
  if (!route.legs.length) return 0;
  // the leg he is on now: the one leaving the stop of the most recent scan
  const leg = route.legs.find(l => l.iFrom >= reached);
  if (!leg) return 0.995;
  const scanned = new Date(s.checkpoints[s.checkpoints.length - 1].time).getTime();
  const etaMs = s.eta ? new Date(s.eta).getTime() : scanned + 24 * H;
  const f = Math.max(0.04, Math.min(0.96, (Date.now() - scanned) / Math.max(1, etaMs - scanned)));
  return Math.min(0.995, (leg.start + (leg.end - leg.start) * f) / route.total);
}

function legKind() {
  const l = state.route.legs.find(x => state.progress * state.route.total <= x.end) || state.route.legs[0];
  return l && l.mode === 'plane' ? 'plane' : 'truck';
}

function currentLeg() {
  if (!state.route || !state.route.legs.length) return null;
  const d = state.shown * state.route.total;
  return state.route.legs.find(l => d >= l.start && d <= l.end) || state.route.legs[state.route.legs.length - 1];
}

/* ── map ────────────────────────────────────────────────── */
function initMap() {
  if (state.map) return state.map;
  const map = L.map('map', { zoomControl: true, attributionControl: true, worldCopyJump: true });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 19
  }).addTo(map);
  map.setView([37, -95], 4);
  map.on('dragstart', () => { state.follow = false; syncFollowButton(); });
  state.map = map;
  return map;
}

function drawRoute() {
  const map = initMap();
  const { layers } = state;
  Object.values(layers).forEach(l => l && map.removeLayer(l));
  const s = state.shipment, route = state.route;
  const c = carrier(s.carrier);
  const latlngs = route.pts.map(p => [p.lat, p.lng]);
  const marks = s.checkpoints.filter(c => typeof c.lat === 'number').map(c => [c.lat, c.lng]);

  layers.future = L.polyline(latlngs, { color: '#6E77A8', weight: 2, opacity: .55, dashArray: '2 8' }).addTo(map);
  layers.past = L.polyline([], { color: c.accent, weight: 3.5, opacity: .95 }).addTo(map);

  const stops = L.layerGroup().addTo(map);
  s.checkpoints.forEach((cp, i) => {
    if (typeof cp.lat !== 'number') return;
    const isEnd = i === s.checkpoints.length - 1;
    L.circleMarker([cp.lat, cp.lng], {
      radius: isEnd ? 6 : 4, color: isEnd ? c.accent : '#8E96C4',
      fillColor: '#0C1030', fillOpacity: 1, weight: 2
    }).bindTooltip(`<b>${escapeHtml(cp.city || '')}</b><br>${escapeHtml(cp.message || '')}`, { direction: 'top' }).addTo(stops);
  });
  const dest = s.destination && typeof s.destination.lat === 'number' ? s.destination : null;
  if (dest) {
    L.circleMarker([dest.lat, dest.lng], { radius: 7, color: '#6FE3C2', fillColor: '#0C1030', fillOpacity: 1, weight: 3 })
      .bindTooltip(`<b>${escapeHtml(dest.city || 'Destination')}</b>`, { direction: 'top' }).addTo(stops);
  }
  layers.stops = stops;

  const bounds = L.latLngBounds(latlngs.length > 1 ? latlngs : marks);
  if (bounds.isValid()) map.fitBounds(bounds.pad(0.25), { animate: false });
  else if (marks.length) map.setView(marks[marks.length - 1], 9);
  $('#map-legend').innerHTML = `<b>${escapeHtml(c.name)}</b> · ${route.legs.length} leg${route.legs.length > 1 ? 's' : ''} · ${Math.round(route.total).toLocaleString()} km`;
}

function updatePastLine() {
  if (!state.layers.past) return;
  const d = state.shown * state.route.total;
  const pts = state.route.pts.filter(p => p.d <= d).map(p => [p.lat, p.lng]);
  const head = pointAt(state.route, state.shown);
  pts.push([head.lat, head.lng]);
  state.layers.past.setLatLngs(pts);
  return head;
}

/* ── the pin loop: keep the 3D vehicle glued to the map ── */
let stage = null;
function pinLoop() {
  requestAnimationFrame(pinLoop);
  if (!stage || stage.mode !== 'map' || !state.map) return;
  if (!state.route || state.route.pts.length < 2) { stage.setMapAnchor({ x: 0, y: 0, visible: false }); return; }

  const head = pointAt(state.route, state.shown);
  const ahead = pointAt(state.route, Math.min(1, state.shown + 0.004));
  const el = $('#map');
  const rect = el.getBoundingClientRect();
  const onScreen = rect.bottom > 0 && rect.top < innerHeight;
  if (!onScreen) { stage.setMapAnchor({ x: 0, y: 0, visible: false }); return; }

  const p = state.map.latLngToContainerPoint([head.lat, head.lng]);
  const q = state.map.latLngToContainerPoint([ahead.lat, ahead.lng]);
  // if he's panned off the map, don't draw him over the rest of the page
  const m = 6;
  if (p.x < -m || p.y < -m || p.x > rect.width + m || p.y > rect.height + m) {
    stage.setMapAnchor({ x: 0, y: 0, visible: false }); return;
  }
  const dx = q.x - p.x, dy = q.y - p.y;
  const heading = (Math.abs(dx) + Math.abs(dy)) > 0.4 ? Math.atan2(dx, -dy) : undefined;
  const zoom = state.map.getZoom();
  stage.setMapAnchor({
    x: rect.left + p.x,
    y: rect.top + p.y,
    heading,
    scale: Math.max(11, Math.min(34, 8 + zoom * 1.9)),
    visible: true
  });
}
requestAnimationFrame(pinLoop);

/* smooth the displayed progress and keep the line in sync */
let lastTick = performance.now();
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, (now - lastTick) / 1000); lastTick = now;
  if (!state.route || state.route.pts.length < 2) return;
  state.shown += (state.progress - state.shown) * Math.min(1, dt * 0.55);
  if (Math.abs(state.progress - state.shown) < 1e-5) state.shown = state.progress;
  const head = updatePastLine();
  renderProgress();
  if (state.follow && head && state.map && stage && stage.mode === 'map') {
    const p = state.map.latLngToContainerPoint([head.lat, head.lng]);
    const size = state.map.getSize();
    if (p.x < size.x * 0.18 || p.x > size.x * 0.82 || p.y < size.y * 0.18 || p.y > size.y * 0.82) {
      state.map.panTo([head.lat, head.lng], { animate: true, duration: 0.8 });
    }
  }
}
requestAnimationFrame(tick);

/* ── flow ───────────────────────────────────────────────── */
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

function syncFollowButton() {
  const b = $('[data-action="recenter"]');
  b.textContent = state.follow ? 'Following' : 'Follow the truck';
}

async function track(numberRaw, forcedDemo) {
  const number = String(numberRaw || '').trim();
  if (!number && !forcedDemo) { toast('Enter a tracking number first.'); return; }
  const carrierId = detectCarrier(number);

  document.body.dataset.view = 'track';
  $('#track').hidden = false;
  document.body.classList.add('is-cine');

  let data;
  const fetching = forcedDemo
    ? Promise.resolve(demo(forcedDemo))
    : fetchTracking(number, carrierId).catch(err => {
        console.warn('[trakie] live lookup failed:', err.message);
        const d = demo(carrierId === 'generic' ? 'ups' : carrierId in { ups:1, fedex:1, dhl:1 } ? carrierId : 'ups');
        d.number = number; d.carrier = carrierId;
        d.note = /501/.test(err.message) ? 'The server has no carrier API key yet.'
               : /404|405/.test(err.message) ? 'The /api/track function is not deployed — this needs a Pages project, not a Worker.'
               : err.message;
        return d;
      });

  // work out which vehicle he needs before the cinematic starts
  data = await fetching;
  loadRoute(data);
  state.shown = Math.max(0, state.progress - 0.16);
  const kind = legKind();

  renderWaybill(data);
  drawRoute();
  if (data.source === 'demo') toast(data.note ? `Showing sample data — ${data.note}` : 'Showing sample data.');

  if (stage) await stage.playLoadUp(kind, data.carrier);
  document.body.classList.remove('is-cine');
  if (stage) { stage.setMode('map'); stage.setMapVehicle(kind, data.carrier); }

  state.follow = true; syncFollowButton();
  if (state.map) state.map.invalidateSize();
  $('#track').scrollIntoView({ behavior: 'smooth', block: 'start' });

  startPolling();
}

function routeStops(s) {
  const scanned = s.checkpoints
    .filter(c => typeof c.lat === 'number' && typeof c.lng === 'number')
    .map(c => ({ lat: c.lat, lng: c.lng, city: c.city, time: c.time }))
    // a facility scanned three times is still one stop
    .filter((p, i, arr) => i === 0 || haversine(p, arr[i - 1]) > 3);
  const stops = scanned.slice();
  const d = s.destination;
  if (d && typeof d.lat === 'number' && (!stops.length || haversine(d, stops[stops.length - 1]) > 3)) {
    stops.push({ ...d, time: s.eta });
  }
  return { stops, reached: Math.max(0, scanned.length - 1) };
}

function loadRoute(data) {
  const { stops, reached } = routeStops(data);
  state.shipment = data;
  state.reached = reached;
  state.route = buildRoute(stops);
  state.progress = state.route.pts.length > 1 ? computeProgress(data, state.route, reached) : 0;
  state.lastScanCount = data.checkpoints.length;
  return state.route;
}

function startPolling() {
  clearInterval(state.poll);
  if (state.shipment.status === 'delivered' || state.shipment.source === 'demo') return;
  state.poll = setInterval(refresh, 60000);
}

async function refresh() {
  const s = state.shipment;
  if (!s) return;
  try {
    const data = await fetchTracking(s.number, s.carrier);
    const grew = data.checkpoints.length > state.lastScanCount;
    loadRoute(data);
    renderWaybill(data);
    drawRoute();
    if (grew && stage) {
      const cp = data.checkpoints[data.checkpoints.length - 1];
      toast(`New scan: ${cp.message || cp.city}`);
      const kind = legKind();
      document.body.classList.add('is-cine');
      await stage.playLoadUp(kind, data.carrier);
      document.body.classList.remove('is-cine');
      stage.setMode('map');
      stage.setMapVehicle(kind, data.carrier);
    }
    if (data.status === 'delivered') clearInterval(state.poll);
  } catch (e) { console.warn('[trakie] refresh failed', e); }
}

/* ── customiser ─────────────────────────────────────────── */
function buildCustomiser() {
  const swatch = (host, list, key, prop) => {
    const el = $(host); el.innerHTML = '';
    list.forEach(item => {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.style.background = item[prop];
      b.title = item.name;
      b.setAttribute('aria-label', item.name);
      b.setAttribute('aria-pressed', String(look[key] === item.id));
      b.onclick = () => { look[key] = item.id; apply(); };
      el.appendChild(b);
    });
  };
  const seg = (host, list, key, labels) => {
    const el = $(host); el.innerHTML = '';
    list.forEach(id => {
      const b = document.createElement('button');
      b.textContent = labels?.[id] || id[0].toUpperCase() + id.slice(1);
      b.setAttribute('aria-pressed', String(look[key] === id));
      b.onclick = () => { look[key] = id; apply(); };
      el.appendChild(b);
    });
  };
  function apply() {
    saveLook();
    if (stage) stage.setLook(look);
    build();
  }
  function build() {
    swatch('#opt-fur', COAT_COLORS, 'coat', 'fur');
    swatch('#opt-belly', BELLY_COLORS, 'belly', 'belly');
    seg('#opt-horns', HORN_STYLES, 'horns', { curl: 'Curled', nub: 'Nubs', antler: 'Antlers', none: 'Bare' });
    seg('#opt-eyes', EYE_STYLES, 'eyes', { round: 'Round', sleepy: 'Sleepy', wide: 'Wide' });
    seg('#opt-accessory', ACCESSORIES, 'accessory', { none: 'Nothing', scarf: 'Scarf', cap: 'Cap', satchel: 'Satchel' });
  }
  build();
  const nameEl = $('#opt-name');
  nameEl.value = look.name;
  nameEl.oninput = () => { look.name = nameEl.value.slice(0, 14) || 'Trakie'; saveLook(); };
}

function openDrawer() {
  $('#drawer').hidden = false;
  buildCustomiser();
  if (stage) stage.setMode('portrait');
}
function closeDrawer() {
  $('#drawer').hidden = true;
  if (!stage) return;
  if (state.shipment) {
    stage.setMode('map');
    const leg = currentLeg();
    stage.setMapVehicle(leg && leg.mode === 'plane' ? 'plane' : 'truck', state.shipment.carrier);
  } else {
    stage.setMode('hero');
  }
}

/* ── carrier grid ───────────────────────────────────────── */
function renderCarrierGrid() {
  const el = $('#carrier-grid');
  Object.entries(CARRIERS).filter(([id]) => id !== 'generic').forEach(([id, c]) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot" style="background:${c.body};box-shadow:inset 0 0 0 3px ${c.accent}"></span>${escapeHtml(c.name)}`;
    el.appendChild(li);
  });
}

/* ── wire up ────────────────────────────────────────────── */
(async function boot() {
  renderCarrierGrid();
  syncFollowButton();

  try {
    stage = await createStage($('#stage-canvas'));
    stage.setLook(look);
  } catch (e) {
    console.error('[trakie] 3D unavailable', e);
    document.getElementById('stage').style.display = 'none';
  }

  $('#track-form').addEventListener('submit', e => {
    e.preventDefault();
    track($('#track-input').value);
  });

  $('#track-input').addEventListener('input', e => {
    const id = detectCarrier(e.target.value);
    const hint = $('#carrier-hint');
    hint.textContent = e.target.value.trim().length < 6
      ? 'We’ll work out the carrier ourselves.'
      : id === 'generic' ? 'Unrecognised format — we’ll still ask around.' : `Looks like ${carrier(id).name}.`;
  });

  $$('[data-demo]').forEach(b => b.addEventListener('click', () => {
    const d = demo(b.dataset.demo);
    $('#track-input').value = d.number;
    track(d.number, b.dataset.demo);
  }));

  $$('[data-action="customize"]').forEach(b => b.addEventListener('click', openDrawer));
  $$('[data-action="close-drawer"]').forEach(b => b.addEventListener('click', closeDrawer));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#drawer').hidden) closeDrawer();
    if (e.key === 'Escape' && stage) stage.skipCinematic();
  });

  $('[data-action="recenter"]').addEventListener('click', () => {
    state.follow = !state.follow;
    syncFollowButton();
    if (state.follow && state.route && state.map) {
      const h = pointAt(state.route, state.shown);
      state.map.panTo([h.lat, h.lng], { animate: true });
    }
  });

  $('[data-action="home"]').addEventListener('click', e => {
    e.preventDefault();
    document.body.dataset.view = 'home';
    if (stage) stage.setMode('hero');
    scrollTo({ top: 0, behavior: 'smooth' });
  });

  addEventListener('pointermove', e => {
    if (!stage) return;
    stage.aimAt((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
  }, { passive: true });

  document.addEventListener('click', e => {
    if (document.body.classList.contains('is-cine') && stage) stage.skipCinematic();
  });

  document.addEventListener('visibilitychange', () => {
    if (!stage) return;
    document.hidden ? stage.pause() : stage.resume();
  });

  // deep link: mytrakie.com/?n=1Z999AA10123456784
  const q = new URLSearchParams(location.search).get('n');
  if (q) { $('#track-input').value = q; track(q); }
})();
