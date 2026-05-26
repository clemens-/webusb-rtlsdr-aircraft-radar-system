import {
    decodeGlobalCpr,
    decodeLocalCpr,
    bearingBetween,
    distanceMetres,
} from './cpr.js';

const STALE_MS       = 5 * 60 * 1000; // 5 minutes
const CPR_MAX_AGE_MS = 10_000;         // even/odd pair must be within 10 s
const MAX_JUMP_M     = 500_000;        // 500 km sanity check
const MAX_HISTORY    = 10;

function icaoHex(icao) {
    return icao.toString(16).toUpperCase().padStart(6, '0');
}

function makeAircraft(icao) {
    return {
        icao,
        icaoHex: icaoHex(icao),
        callsign: '',
        aircraftType: null,
        altitude: null,
        speed: null,
        heading: null,
        headingIsValid: false,
        squawk: null,
        vertRate: null,
        evenFrame: null,
        oddFrame: null,
        lat: null,
        lon: null,
        positionHistory: [],
        lastSeen: Date.now(),
    };
}

export class AircraftStore {
    constructor() {
        this._aircraft   = new Map(); // icao (int) → state object
        this._listeners  = [];
        this._dirty      = new Set(); // icao values awaiting rAF flush
        this._rafPending = false;
        this._receiverLat = null;
        this._receiverLon = null;
    }

    setReceiverPosition(lat, lon) {
        this._receiverLat = lat;
        this._receiverLon = lon;
    }

    // Called by index.js onMsg with a decoded Message object.
    update(msg) {
        if (!msg || !msg.icao) return;
        const icao = msg.icao;

        if (!this._aircraft.has(icao)) {
            this._aircraft.set(icao, makeAircraft(icao));
        }
        const ac = this._aircraft.get(icao);
        ac.lastSeen = Date.now();

        // Aircraft identification (metype 1-4)
        if (msg.callsign && msg.callsign.trim()) {
            ac.callsign = msg.callsign.trim();
        }
        if (msg.aircraftType != null) {
            ac.aircraftType = msg.aircraftType;
        }

        // Squawk (DF 4/5/20/21)
        if (msg.identity != null && msg.identity !== 0) {
            ac.squawk = String(msg.identity).padStart(4, '0');
        }

        // Altitude (from any message that carries it)
        if (msg.altitude != null) {
            ac.altitude = msg.altitude;
        }

        // Velocity (metype 19)
        if (msg.speed != null) {
            ac.speed = Math.round(msg.speed);
        }
        if (msg.heading != null && (msg.mesub === 1 || msg.mesub === 2 || msg.headingIsValid)) {
            ac.heading = msg.heading;
            ac.headingIsValid = true;
        }
        if (msg.vertRate != null) {
            // Raw field is a 9-bit value; actual rate = (value - 1) * 64 fpm.
            ac.vertRate = (msg.vertRate - 1) * 64 * (msg.vertRateSign ? -1 : 1);
        }

        // Airborne position (metype 9-18) — fflag is 0 or 4 (not 0/1)
        if (msg.rawLatitude != null && msg.rawLongitude != null) {
            const isOdd = msg.fflag !== 0;
            const frame = { rawLat: msg.rawLatitude, rawLon: msg.rawLongitude, ts: Date.now() };

            if (isOdd) {
                ac.oddFrame = frame;
            } else {
                ac.evenFrame = frame;
            }

            this._attemptCprDecode(ac);
        }

        this._markDirty(icao);
    }

    // Directly inject a fully-formed aircraft state (used by demo mode).
    injectAircraft(state) {
        const icao = state.icao;
        this._aircraft.set(icao, { ...state, lastSeen: Date.now() });
        this._markDirty(icao);
    }

    // Returns array of icaoHex strings for aircraft removed (not seen > STALE_MS).
    cleanup() {
        const now     = Date.now();
        const removed = [];
        for (const [icao, ac] of this._aircraft) {
            if (now - ac.lastSeen > STALE_MS) {
                removed.push(ac.icaoHex);
                this._aircraft.delete(icao);
                this._dirty.delete(icao);
            }
        }
        return removed;
    }

    getAll() {
        return Array.from(this._aircraft.values());
    }

    onChange(callback) {
        this._listeners.push(callback);
    }

    // --- private ---

    _attemptCprDecode(ac) {
        const { evenFrame, oddFrame } = ac;

        // Try global CPR first (need both frames within 10 s of each other)
        if (evenFrame && oddFrame) {
            const age = Math.abs(evenFrame.ts - oddFrame.ts);
            if (age <= CPR_MAX_AGE_MS) {
                const useOdd = oddFrame.ts >= evenFrame.ts;
                const result = decodeGlobalCpr(evenFrame, oddFrame, useOdd);
                if (result && this._sanityCheck(ac, result.lat, result.lon)) {
                    this._applyPosition(ac, result.lat, result.lon);
                    return;
                }
            }
        }

        // Fall back to local CPR if we have a prior position or receiver position
        const refLat = ac.lat ?? this._receiverLat;
        const refLon = ac.lon ?? this._receiverLon;
        if (refLat == null) return;

        const frame = oddFrame ?? evenFrame;
        if (!frame) return;

        const isOdd = frame === oddFrame;
        const result = decodeLocalCpr(frame.rawLat, frame.rawLon, isOdd, refLat, refLon);
        if (result && this._sanityCheck(ac, result.lat, result.lon)) {
            this._applyPosition(ac, result.lat, result.lon);
        }
    }

    _sanityCheck(ac, lat, lon) {
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
        if (ac.lat != null) {
            const jump = distanceMetres(ac.lat, ac.lon, lat, lon);
            if (jump > MAX_JUMP_M) return false;
        }
        return true;
    }

    _applyPosition(ac, lat, lon) {
        ac.lat = lat;
        ac.lon = lon;

        const ts = Date.now();
        ac.positionHistory.push({ lat, lon, ts });
        if (ac.positionHistory.length > MAX_HISTORY) {
            ac.positionHistory.shift();
        }

        // Infer heading from track if we don't have a valid velocity heading
        if (!ac.headingIsValid && ac.positionHistory.length >= 2) {
            const prev = ac.positionHistory[ac.positionHistory.length - 2];
            const curr = ac.positionHistory[ac.positionHistory.length - 1];
            if (curr.ts - prev.ts >= 2000) {
                ac.heading = bearingBetween(prev.lat, prev.lon, curr.lat, curr.lon);
            }
        }
    }

    _markDirty(icao) {
        this._dirty.add(icao);
        if (!this._rafPending) {
            this._rafPending = true;
            requestAnimationFrame(() => this._flush());
        }
    }

    _flush() {
        this._rafPending = false;
        for (const icao of this._dirty) {
            const ac = this._aircraft.get(icao);
            if (ac) {
                for (const cb of this._listeners) cb(ac);
            }
        }
        this._dirty.clear();
    }
}
