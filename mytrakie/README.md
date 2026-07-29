# Trakie — mytrakie.com

A parcel tracker with a 3D courier. Paste a tracking number, watch a shaggy
creature pick the box up, climb into the carrier's truck (or plane), and drive
it across a live map.

```
index.html                 the page
assets/css/style.css       design system
assets/js/creature.js      the mascot: geometry, instanced fur, poses, customiser options
assets/js/fleet.js         carrier palettes + detection, 3D truck and cargo plane
assets/js/stage.js         one WebGL canvas, three framings (hero / cinematic / map pin)
assets/js/app.js           tracking data, route maths, Leaflet map, waybill, customiser
functions/api/track.js     Cloudflare Pages Function — talks to the carrier API
```

No build step. No bundler. Static files plus one function.

---

## 1. Deploy to Cloudflare **Pages** — not Workers

This matters. Cloudflare's dashboard has two upload flows and only one of
them runs `functions/api/track.js`. If you see the warning **"Pages functions
are not supported"** during upload, you are in the Workers flow and live
tracking will not work — `/api/track` simply won't exist, and the site will
fall back to sample shipments forever.

Take this path instead:

**Workers & Pages → Create → the "Pages" tab → Upload assets**

(not the "Workers" tab, and not "Create a Worker"). Then drag the `mytrakie`
folder in. The upload list should show `functions/api/track.js` with **no**
warning banner.

```bash
npm i -g wrangler
wrangler pages deploy . --project-name=trakie
```

Or push this folder to a Git repo and connect it in **Cloudflare → Workers &
Pages → Create → Pages**. Build command: *(none)*. Output directory: `/`.

Then **Custom domains → Set up a domain → mytrakie.com**. Cloudflare adds the
CNAME itself if the zone is already on your account.

Pages picks up `functions/api/track.js` automatically and serves it at
`/api/track`. Nothing else to wire.

## 2. Turn on live tracking

Out of the box the site runs on sample shipments, so you can see the whole
experience before signing up for anything. `/api/track` returns `501` and the
front end quietly falls back to a demo route.

To go live, pick an aggregator — one key covers every carrier, which is far
less work than integrating UPS, FedEx, USPS and DHL separately:

| Provider | Sign up | Notes |
|---|---|---|
| **AfterShip** | aftership.com/developers | ~1,000 carriers, free tier, default here |
| **Ship24** | ship24.com | also supported, set `TRACK_PROVIDER=ship24` |

**Pages → Settings → Environment variables** (Production *and* Preview):

```
AFTERSHIP_API_KEY = your_key
TRACK_PROVIDER    = aftership        # or ship24 + SHIP24_API_KEY
```

Redeploy. That's it — the front end already calls `/api/track`.

**Optional but recommended:** create a KV namespace called `GEOCACHE` and bind
it under **Settings → Functions → KV namespace bindings** with the variable name
`GEOCACHE`. Carriers send city names, not coordinates, so the function geocodes
them; KV means each city is looked up once ever instead of on every request.

## 3. What the front end expects back

```jsonc
{
  "number": "1Z999AA10123456784",
  "carrier": "ups",                    // key from CARRIERS in fleet.js
  "status": "in_transit",              // pre_transit | in_transit | out_for_delivery | delivered | exception
  "eta": "2026-07-30T17:00:00Z",
  "destination": { "city": "Temecula, CA", "country": "US", "lat": 33.49, "lng": -117.15 },
  "checkpoints": [
    { "time": "2026-07-26T09:12:00Z", "message": "Origin scan",
      "city": "Louisville, KY", "country": "US", "lat": 38.17, "lng": -85.74 }
  ]
}
```

Swap in a different provider by writing one more `fromX()` in
`functions/api/track.js` that returns this shape. Nothing else changes.

---

## How the moving parts fit

**One canvas, three jobs.** `#stage` is a single fixed, click-through WebGL
canvas over the whole page. It renders the hero portrait with a perspective
camera, plays the load-up cinematic with the same camera on a keyframed path,
then switches to an orthographic camera whose units *are* CSS pixels — which is
how the truck sits exactly on top of the Leaflet marker position at any zoom,
with no second renderer and no map plugin.

**Truck or plane** is decided per leg by implied speed: distance between two
scans over the time between them. Nothing on a road averages 110 km/h door to
door, so anything faster gets wings. Legs over 2,200 km always fly. Flight legs
are drawn as great circles, so they bow the way flight paths really do.

**Progress** is real, not a guess: it interpolates between the most recent scan
and the carrier's promised delivery time, so the vehicle creeps forward on its
own while the tab is open. `/api/track` is re-polled every 60 s, and when a new
scan appears the cinematic replays with whatever vehicle the new leg needs.

**The mascot is procedural.** No model file — he is ellipsoids, tapered tubes
and about 10,000 instanced fur spikes generated at load, which is why the
customiser can rebuild him instantly and why he costs kilobytes instead of
megabytes. He is an original design in the shaggy-monster tradition, not a copy
of any existing character.

**Customisation** (coat, belly, horns, eyes, accessory, build, name) is stored
in `localStorage` under `trakie.look.v1`. To sync it across devices later,
persist the same object server-side and hydrate `look` in `app.js`.

## Tuning

| Want to change | Where |
|---|---|
| Fur length, density, colour spread | `furField` calls in `creature.js` |
| Add a coat colour or horn shape | `COAT_COLORS` / `HORN_STYLES` in `creature.js` |
| Add a carrier + livery | `CARRIERS` and `PATTERNS` in `fleet.js`, `AFTERSHIP_SLUG` in the function |
| Cinematic timing | `runCinematic` in `stage.js` — phases are plain seconds |
| Truck size on the map | `scale` in `pinLoop` in `app.js` |
| Map style | the `L.tileLayer` URL in `initMap` |

## Notes

- Carrier names and colours identify the service; they are not endorsements,
  and no carrier logos are used.
- Map tiles are CARTO/OpenStreetMap. Free tier is fine for modest traffic; if
  the site takes off, get a tile key or self-host.
- Nominatim (the geocoding fallback) asks for a real user agent and light use.
  The KV cache keeps you well inside that.
- Respects `prefers-reduced-motion`, works down to mobile, and degrades to a
  plain map if WebGL is unavailable.
