// Compact Position Reporting (CPR) decoding for ADS-B airborne position messages.
// All functions are stateless pure math — no side effects.

const NZ = 15;
const D_LAT_EVEN = 360 / (4 * NZ);     // 6 degrees
const D_LAT_ODD  = 360 / (4 * NZ - 1); // ~6.101 degrees

// Returns the NL (number of longitude zones) for a given latitude in degrees.
// Defined by ICAO Annex 10 / DO-260B. Returns 1 when |lat| >= 87.
export function nlFunction(lat) {
    if (lat < 0) lat = -lat;
    if (lat >= 87) return 1;
    if (lat === 0) return 59;
    const a = 1 - (1 - Math.cos(Math.PI / (2 * NZ))) / (Math.cos((Math.PI / 180) * lat) ** 2);
    return Math.floor((2 * Math.PI) / Math.acos(a));
}

// Normalize a latitude to the range [-90, 90].
function normLat(lat) {
    if (lat > 270) return lat - 360;
    return lat;
}

// Normalize a longitude to the range [-180, 180].
function normLon(lon) {
    if (lon >= 180) return lon - 360;
    return lon;
}

// Positive-safe modulo: result is always in [0, n).
function mod(x, n) {
    return ((x % n) + n) % n;
}

/**
 * Decode a position using two CPR frames (one even, one odd).
 * evenFrame / oddFrame: { rawLat, rawLon, ts }  (ts = Date.now() timestamp)
 * useOdd: true to prefer the odd frame as the most recent (and thus the output lat).
 * Returns { lat, lon } in decimal degrees, or null if decode fails.
 */
export function decodeGlobalCpr(evenFrame, oddFrame, useOdd) {
    const lat0 = evenFrame.rawLat;
    const lat1 = oddFrame.rawLat;
    const lon0 = evenFrame.rawLon;
    const lon1 = oddFrame.rawLon;

    // Step 1: latitude zone index
    const j = Math.floor((59 * lat0 - 60 * lat1) / 131072 + 0.5);

    // Step 2: candidate latitudes
    let rlat0 = D_LAT_EVEN * (mod(j, 60) + lat0 / 131072);
    let rlat1 = D_LAT_ODD  * (mod(j, 59) + lat1 / 131072);

    rlat0 = normLat(rlat0);
    rlat1 = normLat(rlat1);

    // Step 3: zone consistency check
    if (nlFunction(rlat0) !== nlFunction(rlat1)) return null;

    const rlat = useOdd ? rlat1 : rlat0;
    const nl   = nlFunction(rlat);
    const lonRef = useOdd ? lon1 : lon0;

    // Step 4: longitude
    const ni = Math.max(nl - (useOdd ? 1 : 0), 1);
    const m  = Math.floor((lon0 * (nl - 1) - lon1 * nl) / 131072 + 0.5);
    const lon = (360 / ni) * (mod(m, ni) + lonRef / 131072);

    return { lat: rlat, lon: normLon(lon) };
}

/**
 * Decode a position from a single CPR frame using a known reference position.
 * Used as a fallback when only one frame is available but we have a prior position.
 * rawLat, rawLon: 17-bit CPR integers from the message.
 * isOdd: true if this is an odd frame (fflag !== 0).
 * refLat, refLon: reference position in decimal degrees.
 * Returns { lat, lon } or null.
 */
export function decodeLocalCpr(rawLat, rawLon, isOdd, refLat, refLon) {
    const dLat = isOdd ? D_LAT_ODD : D_LAT_EVEN;
    const nz   = isOdd ? 59 : 60;

    const j   = Math.floor(refLat / dLat + 0.5) + Math.floor(0.5 + mod(rawLat / 131072, 1) - mod(refLat / dLat, 1));
    const lat = dLat * (j + rawLat / 131072);

    const nl = nlFunction(lat);
    const ni = Math.max(nl - (isOdd ? 1 : 0), 1);
    const dLon = 360 / ni;

    const m   = Math.floor(refLon / dLon + 0.5) + Math.floor(0.5 + mod(rawLon / 131072, 1) - mod(refLon / dLon, 1));
    const lon = dLon * (m + rawLon / 131072);

    if (lat < -90 || lat > 90) return null;

    return { lat, lon: normLon(lon) };
}

/**
 * Compute the bearing in degrees (0-360) from point A to point B.
 */
export function bearingBetween(lat1, lon1, lat2, lon2) {
    const toRad = Math.PI / 180;
    const dLon  = (lon2 - lon1) * toRad;
    const y     = Math.sin(dLon) * Math.cos(lat2 * toRad);
    const x     = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad)
                - Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon);
    return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}

/**
 * Haversine distance in metres between two lat/lon points.
 */
export function distanceMetres(lat1, lon1, lat2, lon2) {
    const R     = 6371000;
    const toRad = Math.PI / 180;
    const dLat  = (lat2 - lat1) * toRad;
    const dLon  = (lon2 - lon1) * toRad;
    const a     = Math.sin(dLat / 2) ** 2
                + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
