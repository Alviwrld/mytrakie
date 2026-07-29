/* ─────────────────────────────────────────────────────────────
   GET /api/track?number=…&carrier=…

   Cloudflare Pages Function. It talks to a tracking aggregator so
   your API key never reaches the browser, then normalises the reply
   into the shape the front end expects:

   { number, carrier, status, eta, source,
     destination: { city, country, lat, lng },
     checkpoints: [ { time, message, status, city, country, lat, lng } ] }

   Environment variables (Pages → Settings → Environment variables):
     AFTERSHIP_API_KEY   an AfterShip v4 key            (provider: aftership)
     SHIP24_API_KEY      a Ship24 key                   (provider: ship24)
     TRACK_PROVIDER      "aftership" | "ship24"         (default: aftership)
   Optional KV binding named GEOCACHE speeds up geocoding.
   With no key set, this returns 501 and the front end falls back to
   sample data, so the site still works before you sign up anywhere.
   ───────────────────────────────────────────────────────────── */

const STATUS_MAP = {
  Pending: 'pre_transit', InfoReceived: 'pre_transit', InTransit: 'in_transit',
  OutForDelivery: 'out_for_delivery', AttemptFail: 'exception', Delivered: 'delivered',
  AvailableForPickup: 'out_for_delivery', Exception: 'exception', Expired: 'exception',
  in_transit: 'in_transit', out_for_delivery: 'out_for_delivery', delivered: 'delivered',
  pending: 'pre_transit', exception: 'exception', failed_attempt: 'exception'
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=45',
    'access-control-allow-origin': '*'
  }
});

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const number = (url.searchParams.get('number') || '').trim();
  const hinted = (url.searchParams.get('carrier') || '').trim();

  if (!/^[A-Za-z0-9._-]{6,40}$/.test(number)) {
    return json({ error: 'That does not look like a tracking number.' }, 400);
  }

  const provider = (env.TRACK_PROVIDER || 'aftership').toLowerCase();

  try {
    let shipment;
    if (provider === 'ship24' && env.SHIP24_API_KEY) {
      shipment = await fromShip24(number, env);
    } else if (env.AFTERSHIP_API_KEY) {
      shipment = await fromAfterShip(number, hinted, env);
    } else {
      return json({ error: 'No tracking provider configured on the server.' }, 501);
    }
    shipment.checkpoints = await withCoords(shipment.checkpoints, env);
    if (shipment.destination && !shipment.destination.lat) {
      const g = await geocode(placeKey(shipment.destination), env);
      if (g) Object.assign(shipment.destination, g);
    }
    return json(shipment);
  } catch (err) {
    return json({ error: err.message || 'Carrier lookup failed.' }, err.status || 502);
  }
}

/* ── AfterShip ──────────────────────────────────────────── */
// AfterShip's current versioned API (2024-10+). Keys that start with
// "asat_" authenticate with an `as-api-key` header against
// api.aftership.com/tracking/{version}/… — the older v4 endpoint and
// `aftership-api-key` header this used to call are retired.
const AS_VERSION = '2024-10';
const AS_BASE = `https://api.aftership.com/tracking/${AS_VERSION}`;

async function asRequest(path, env, init = {}) {
  const res = await fetch(`${AS_BASE}${path}`, {
    ...init,
    headers: { 'as-api-key': env.AFTERSHIP_API_KEY, 'content-type': 'application/json', ...(init.headers || {}) }
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function fromAfterShip(number, hinted, env) {
  const slug = AFTERSHIP_SLUG[hinted];
  const qs = new URLSearchParams({ tracking_numbers: number });
  if (slug) qs.set('slug', slug);

  let r = await asRequest(`/trackings?${qs}`, env);
  let list = r.ok ? r.body?.data?.trackings || [] : [];

  // not seen before → register it, then read it back
  if (!list.length) {
    await asRequest('/trackings', env, {
      method: 'POST',
      body: JSON.stringify({ tracking: { tracking_number: number, ...(slug ? { slug } : {}) } })
    });
    await new Promise(res => setTimeout(res, 1500));
    r = await asRequest(`/trackings?${qs}`, env);
    list = r.ok ? r.body?.data?.trackings || [] : [];
  }

  if (!r.ok && !list.length) {
    const msg = r.body?.meta?.message || `AfterShip returned ${r.status}.`;
    const e = new Error(msg); e.status = r.status === 401 ? 502 : r.status; throw e;
  }

  const t = list[0];
  if (!t) { const e = new Error('The carrier has nothing on that number yet.'); e.status = 404; throw e; }

  return {
    number: t.tracking_number,
    carrier: hinted || SLUG_TO_ID[t.slug] || 'generic',
    status: STATUS_MAP[t.tag] || STATUS_MAP[t.subtag] || 'in_transit',
    eta: t.expected_delivery || t.aftership_estimated_delivery_date?.estimated_delivery_date || null,
    source: 'aftership',
    destination: t.destination_city || t.destination_country_iso3
      ? { city: t.destination_city || '', country: t.destination_country_iso3 || '' } : null,
    checkpoints: (t.checkpoints || []).map(c => ({
      time: c.checkpoint_time || c.created_at,
      message: c.message || c.checkpoint_message || '',
      status: STATUS_MAP[c.tag] || 'in_transit',
      city: c.city || c.location || '',
      state: c.state || '',
      country: c.country_iso3 || c.country_name || '',
      zip: c.zip || ''
    }))
  };
}

/* ── Ship24 ─────────────────────────────────────────────── */
async function fromShip24(number, env) {
  const res = await fetch('https://api.ship24.com/public/v1/trackers/track', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.SHIP24_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ trackingNumber: number })
  });
  if (!res.ok) { const e = new Error('Ship24 lookup failed.'); e.status = res.status; throw e; }
  const t = (await res.json()).data?.trackings?.[0];
  if (!t) { const e = new Error('Nothing found for that number.'); e.status = 404; throw e; }
  return {
    number,
    carrier: (t.shipment?.courierCode || [])[0] || 'generic',
    status: STATUS_MAP[t.shipment?.statusMilestone] || 'in_transit',
    eta: t.shipment?.delivery?.estimatedDeliveryDate || null,
    source: 'ship24',
    destination: t.shipment?.recipient ? { city: t.shipment.recipient.city || '', country: t.shipment.recipient.countryCode || '' } : null,
    checkpoints: (t.events || []).slice().reverse().map(e => ({
      time: e.occurrenceDatetime || e.datetime,
      message: e.status || '',
      status: STATUS_MAP[e.statusMilestone] || 'in_transit',
      city: e.location || '', state: '', country: e.courierCode || ''
    }))
  };
}

const AFTERSHIP_SLUG = {
  ups: 'ups', fedex: 'fedex', usps: 'usps', dhl: 'dhl', amazon: 'amazon',
  ontrac: 'ontrac', royalmail: 'royal-mail', canadapost: 'canada-post',
  australiapost: 'australia-post', yunexpress: 'yunexpress'
};
const SLUG_TO_ID = Object.fromEntries(Object.entries(AFTERSHIP_SLUG).map(([k, v]) => [v, k]));

/* ── geocoding ──────────────────────────────────────────── */
// Carriers rarely send coordinates, so checkpoints get looked up.
// Big hubs are answered from memory; anything else goes to Nominatim
// once and then lives in KV.
const HUBS = {
  'louisville,us': [38.174, -85.736], 'memphis,us': [35.042, -89.977],
  'anchorage,us': [61.174, -149.996], 'cincinnati,us': [39.049, -84.667],
  'ontario,us': [34.056, -117.601], 'newark,us': [40.692, -74.169],
  'indianapolis,us': [39.717, -86.294], 'denver,us': [39.849, -104.673],
  'chicago,us': [41.878, -87.629], 'dallas,us': [32.777, -96.797],
  'atlanta,us': [33.749, -84.388], 'los angeles,us': [34.052, -118.244],
  'new york,us': [40.713, -74.006], 'san francisco,us': [37.775, -122.419],
  'seattle,us': [47.606, -122.332], 'phoenix,us': [33.448, -112.074],
  'shenzhen,cn': [22.543, 114.058], 'hong kong,hk': [22.308, 113.918],
  'shanghai,cn': [31.230, 121.474], 'guangzhou,cn': [23.129, 113.264],
  'london,gb': [51.507, -0.128], 'leipzig,de': [51.340, 12.375],
  'köln,de': [50.938, 6.960], 'paris,fr': [48.857, 2.352],
  'amsterdam,nl': [52.370, 4.895], 'dubai,ae': [25.205, 55.271],
  'singapore,sg': [1.352, 103.820], 'tokyo,jp': [35.690, 139.692],
  'sydney,au': [-33.869, 151.209], 'toronto,ca': [43.653, -79.383],
  'mississauga,ca': [43.589, -79.644], 'mumbai,in': [19.076, 72.878]
};

function placeKey(c) {
  const city = (c.city || '').toLowerCase().trim().replace(/\s+/g, ' ');
  const country = (c.country || '').toLowerCase().slice(0, 2);
  return city ? `${city},${country}` : '';
}

async function geocode(key, env) {
  if (!key) return null;
  if (HUBS[key]) return { lat: HUBS[key][0], lng: HUBS[key][1] };
  const short = key.split(',')[0];
  const hub = Object.keys(HUBS).find(k => k.split(',')[0] === short);
  if (hub) return { lat: HUBS[hub][0], lng: HUBS[hub][1] };

  if (env.GEOCACHE) {
    const hit = await env.GEOCACHE.get(key, 'json');
    if (hit) return hit;
  }
  try {
    const [city, country] = key.split(',');
    const qs = new URLSearchParams({ q: city, format: 'json', limit: '1' });
    if (country) qs.set('countrycodes', country);
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${qs}`, {
      headers: { 'user-agent': 'trakie/1.0 (https://mytrakie.com)' }
    });
    if (!res.ok) return null;
    const hit = (await res.json())[0];
    if (!hit) return null;
    const out = { lat: +hit.lat, lng: +hit.lon };
    if (env.GEOCACHE) await env.GEOCACHE.put(key, JSON.stringify(out), { expirationTtl: 60 * 60 * 24 * 180 });
    return out;
  } catch { return null; }
}

async function withCoords(checkpoints, env) {
  const cache = new Map();
  const out = [];
  for (const c of checkpoints) {
    if (typeof c.lat === 'number') { out.push(c); continue; }
    const key = placeKey(c);
    if (!cache.has(key)) cache.set(key, await geocode(key, env));
    const g = cache.get(key);
    out.push(g ? { ...c, ...g } : c);
  }
  return out;
}
