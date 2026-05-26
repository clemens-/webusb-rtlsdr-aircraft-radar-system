// Fetches operator, aircraft model, and route data from adsbdb.com.
// Results are cached by promise so each ICAO/callsign is fetched at most once.

const BASE = 'https://api.adsbdb.com/v0';

const _acCache    = new Map(); // icaoHex  → Promise<object|null>
const _routeCache = new Map(); // callsign → Promise<object|null>

function getAc(icaoHex) {
    const key = icaoHex.toUpperCase();
    if (!_acCache.has(key)) {
        _acCache.set(key,
            fetch(`${BASE}/aircraft/${key}`)
                .then(r => r.ok ? r.json() : null)
                .then(d => d?.response?.aircraft ?? null)
                .catch(() => null)
        );
    }
    return _acCache.get(key);
}

function getRoute(callsign) {
    const key = callsign.trim().toUpperCase();
    if (!_routeCache.has(key)) {
        _routeCache.set(key,
            fetch(`${BASE}/callsign/${key}`)
                .then(r => r.ok ? r.json() : null)
                .then(d => d?.response?.flightroute ?? null)
                .catch(() => null)
        );
    }
    return _routeCache.get(key);
}

function airportLabel(ap) {
    if (!ap) return null;
    return `${ap.iata_code} ${ap.municipality}`;
}

// Returns an enrichment object; any field may be null if not found.
export async function fetchEnrichment(icaoHex, callsign) {
    const [ac, route] = await Promise.all([
        getAc(icaoHex),
        callsign ? getRoute(callsign) : Promise.resolve(null),
    ]);

    return {
        operator:      route?.airline?.name ?? ac?.registered_owner ?? null,
        aircraftModel: ac?.type ?? null,
        registration:  ac?.registration ?? null,
        origin:        airportLabel(route?.origin),
        destination:   airportLabel(route?.destination),
    };
}
