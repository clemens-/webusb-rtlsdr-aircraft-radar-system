## Aircraft radar system in JavaScript

![Demo of the airplanes tracker. After clicking on a button to start the connection with the RTL-SDR USB device, live data from an airplane is being displayed on the screen, include raw latitude, longitude, altitude.](demo.gif)

This project uses the [Web USB API](https://developer.mozilla.org/en-US/docs/Web/API/USB), a [RTL-SDR dongle + antenna](https://www.rtl-sdr.com/buy-rtl-sdr-dvb-t-dongles/) and vanilla JavaScript to decode live ADS-B signals from aircraft and plot them on an interactive map.

If you'd like to learn more about the original project, check out the [blog post](https://charliegerard.dev/blog/aircraft-radar-system-rtl-sdr-web-usb).

## Features

- **Live map** — aircraft plotted on an OpenStreetMap/Leaflet map with a rotated ✈ icon showing heading
- **CPR position decoding** — global (even + odd frame pair) and local (single frame + reference) decoding of ADS-B compact position reports
- **Track lines** — dashed trail showing each aircraft's recent path
- **Hover tooltip** — shows callsign, ICAO hex, altitude, speed, heading, squawk, category, and vertical speed
- **Click to pin** — click a marker to keep its tooltip open; click again or click the map to close. Only one pinned tooltip at a time
- **Enrichment data** — operator, aircraft model, registration, and departure/arrival airports fetched automatically from [adsbdb.com](https://api.adsbdb.com) and shown in the tooltip
- **Demo mode** — five animated aircraft over UK/Europe so the full UI can be explored without an SDR dongle
- **Raw data feed** — scrolling sidebar showing decoded ADS-B fields as they arrive

## How to run

### Demo mode (no hardware required)

Serve the directory with any static file server, for example:

```bash
python -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000) in a Chromium-based browser and click **Demo mode**. Five aircraft will appear on the map and animate along their headings every 3 seconds.

### Live mode (RTL-SDR dongle required)

WebUSB requires a Chromium-based browser (Chrome or Edge). Firefox does not support WebUSB.

1. Plug in your RTL-SDR dongle and antenna tuned to 1090 MHz
2. Serve the directory as above
3. Open [http://localhost:8000](http://localhost:8000) and click **Connect to antenna**
4. Grant USB access when prompted
5. Aircraft markers will appear once the first CPR position fix is decoded (requires at least one even and one odd position frame from the same aircraft within 10 seconds)

The map centres on your device's geolocation if permission is granted, otherwise defaults to Zurich (47.38°N, 8.54°E).

## Project structure

| File | Purpose |
|---|---|
| `index.html` | Page structure, Leaflet CDN links, button wiring |
| `index.js` | Entry point — connects SDR, wires store → map, handles demo mode |
| `demodulator.js` | Samples → PPM pulses → Mode S frames |
| `decoder.js` | Mode S frame → decoded message fields |
| `cpr.js` | Stateless CPR maths (global decode, local decode, bearing, distance) |
| `aircraft-store.js` | Per-aircraft state, CPR decode orchestration, rAF-batched change events |
| `aircraft-map.js` | Leaflet map, markers, track polylines, tooltips, pin behaviour |
| `enrichment.js` | Fetches operator/model/route data from adsbdb.com with promise caching |
| `demo.js` | Five synthetic aircraft that animate over UK/Europe |
| `styles.css` | Dark theme, split-pane layout, tooltip styling |
| `rtlsdr.js` | WebUSB RTL-SDR driver (third-party) |

## What data is displayed

| Field | Source | Where shown |
|---|---|---|
| Callsign | ADS-B identification message (metype 1–4) | Tooltip header |
| ICAO hex | Every message | Tooltip header |
| Altitude | Any message carrying altitude | Tooltip |
| Speed | Velocity message (metype 19) | Tooltip |
| Heading | Velocity message, or inferred from last two positions | Tooltip + icon rotation |
| Squawk | DF 4/5/20/21 | Tooltip |
| Aircraft category | Identification message | Tooltip |
| Vertical speed | Velocity message | Tooltip |
| Position | CPR decoded from even + odd frames | Marker on map |
| Track history | Accumulated positions (last 10) | Dashed polyline |
| Operator / airline | adsbdb.com (by ICAO hex or callsign) | Tooltip enrichment |
| Aircraft model | adsbdb.com (by ICAO hex) | Tooltip enrichment |
| Registration | adsbdb.com (by ICAO hex) | Tooltip enrichment |
| Departure airport | adsbdb.com (by callsign) | Tooltip enrichment |
| Arrival airport | adsbdb.com (by callsign) | Tooltip enrichment |

Enrichment data is fetched once per aircraft per session and cached. Coverage depends on the adsbdb database; military, private, and some regional aircraft may return no data.

## Credits

This project builds on the original work by [Charlie Gerard](https://charliegerard.dev). It probably wouldn't have been possible without [AirplaneJS](https://github.com/watson/airplanejs) and [rtl-sdr](https://github.com/watson/rtl-sdr) by [Thomas Watson](https://github.com/watson) and [rtlsdrjs](https://github.com/sandeepmistry/rtlsdrjs) by [Sandeep Mistry](https://github.com/sandeepmistry). 💜
