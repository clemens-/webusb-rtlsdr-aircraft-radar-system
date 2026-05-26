// Demo mode: injects 5 animated aircraft over UK/Europe so the map can be
// tested without a physical RTL-SDR device.

const TICK_MS = 3000; // position update interval

// Haversine forward projection: move (lat, lon) by distance along heading.
function movePosition(lat, lon, headingDeg, speedKnots, dtSeconds) {
    const R   = 6371000;
    const d   = speedKnots * 0.514444 * dtSeconds;
    const δ   = d / R;
    const θ   = headingDeg * Math.PI / 180;
    const φ1  = lat * Math.PI / 180;
    const λ1  = lon * Math.PI / 180;
    const φ2  = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
    const λ2  = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
    return { lat: φ2 * 180 / Math.PI, lon: λ2 * 180 / Math.PI };
}

const AIRCRAFT_TYPES = ['Unknown', 'Light', 'Small', 'Large/Heavy'];

// Initial state for each demo aircraft.
const DEMO_SEEDS = [
    { icao: 0x3C6444, icaoHex: '3C6444', callsign: 'DLH441',  aircraftType: 3, altitude: 37000, speed: 460, heading: 280, squawk: '1234', vertRate:  0,   lat: 51.5, lon:  8.2 },
    { icao: 0x400F6E, icaoHex: '400F6E', callsign: 'BAW117',  aircraftType: 3, altitude: 35000, speed: 480, heading:  45, squawk: '2345', vertRate:  0,   lat: 52.3, lon: -1.5 },
    { icao: 0x3944EF, icaoHex: '3944EF', callsign: 'EZY8823', aircraftType: 2, altitude: 32000, speed: 420, heading: 190, squawk: '3456', vertRate: -200, lat: 49.8, lon:  2.3 },
    { icao: 0x4CA7A2, icaoHex: '4CA7A2', callsign: 'RYR2241', aircraftType: 2, altitude: 29000, speed: 400, heading: 115, squawk: '4567', vertRate:  0,   lat: 53.4, lon: -4.1 },
    { icao: 0x3950CE, icaoHex: '3950CE', callsign: 'AFR1642', aircraftType: 3, altitude: 38000, speed: 490, heading: 330, squawk: '5678', vertRate:  100, lat: 47.5, lon:  1.8 },
];

/**
 * Start the demo. Injects all aircraft immediately and then animates them.
 * @param {import('./aircraft-store.js').AircraftStore} store
 */
export function startDemo(store) {
    // Deep-copy seeds into live state objects (including empty positionHistory).
    const state = DEMO_SEEDS.map(s => ({
        ...s,
        headingIsValid: true,
        evenFrame: null,
        oddFrame: null,
        positionHistory: [{ lat: s.lat, lon: s.lon, ts: Date.now() }],
        lastSeen: Date.now(),
    }));

    // Initial inject.
    for (const ac of state) {
        store.injectAircraft({ ...ac });
    }

    // Animation tick.
    setInterval(() => {
        const now = Date.now();
        for (const ac of state) {
            const moved = movePosition(ac.lat, ac.lon, ac.heading, ac.speed, TICK_MS / 1000);
            ac.lat = moved.lat;
            ac.lon = moved.lon;
            ac.lastSeen = now;

            ac.positionHistory = [
                ...ac.positionHistory.slice(-9),
                { lat: ac.lat, lon: ac.lon, ts: now },
            ];

            store.injectAircraft({ ...ac, positionHistory: [...ac.positionHistory] });
        }
    }, TICK_MS);
}
