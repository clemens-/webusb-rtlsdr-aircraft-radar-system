// Leaflet map integration. Depends on window.L being available (Leaflet loaded
// as a regular <script> tag before this module runs).

import { fetchEnrichment } from './enrichment.js';

const AIRCRAFT_TYPE_LABELS = ['Unknown', 'Light', 'Small', 'Large / Heavy'];
const TRACK_COLOR  = 'rgba(0, 255, 136, 0.4)';
const MARKER_COLOR = '#00ff88';

const TOOLTIP_OPTS = {
    permanent: false,
    sticky:    false,
    className: 'ac-tooltip-wrapper',
    opacity:   1,
};

function makeIcon(heading) {
    // ✈ glyph points east by default; subtract 90° so 0° heading = north.
    const deg = (heading ?? 0) - 90;
    return L.divIcon({
        className: '',
        html: `<div style="
            transform: rotate(${deg}deg);
            font-size: 24px;
            line-height: 1;
            color: ${MARKER_COLOR};
            text-shadow: 0 0 3px #000, 0 0 3px #000, 0 0 8px rgba(0,255,136,0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            width: 30px;
            height: 30px;
        ">✈</div>`,
        iconSize:     [30, 30],
        iconAnchor:   [15, 15],
        tooltipAnchor:[15, 0],
    });
}

function tooltipContent(ac, enr = null) {
    const callsign = ac.callsign || '——';
    const alt      = ac.altitude != null ? `${ac.altitude.toLocaleString()} ft` : '—';
    const spd      = ac.speed    != null ? `${Math.round(ac.speed)} kts`        : '—';
    const hdg      = ac.heading  != null ? `${Math.round(ac.heading)}°`          : '—';
    const squawk   = ac.squawk   || '—';
    const type     = AIRCRAFT_TYPE_LABELS[ac.aircraftType] ?? '—';
    const vs       = ac.vertRate != null
        ? (ac.vertRate >= 0 ? `+${ac.vertRate}` : `${ac.vertRate}`) + ' fpm'
        : '—';

    let enrichHtml = '';
    if (enr) {
        let line1 = '';
        if (enr.operator)      line1 += enr.operator;
        if (enr.aircraftModel) line1 += (line1 ? ' · ' : '') + enr.aircraftModel;
        if (enr.registration)  line1 += ` <span class="ac-icao">${enr.registration}</span>`;

        let line2 = '';
        if (enr.origin || enr.destination) {
            line2 = `${enr.origin ?? '—'} → ${enr.destination ?? '—'}`;
        }

        if (line1 || line2) {
            enrichHtml = `<div class="ac-enrichment">`;
            if (line1) enrichHtml += `<div>${line1}</div>`;
            if (line2) enrichHtml += `<div class="ac-route">${line2}</div>`;
            enrichHtml += `</div>`;
        }
    }

    return `<div class="ac-tooltip">
        <div class="ac-tooltip-header">${callsign} <span class="ac-icao">${ac.icaoHex}</span></div>
        ${enrichHtml}
        <div>Alt: <b>${alt}</b> &nbsp; Spd: <b>${spd}</b></div>
        <div>Hdg: <b>${hdg}</b> &nbsp; Squawk: <b>${squawk}</b></div>
        <div>Type: <b>${type}</b> &nbsp; VS: <b>${vs}</b></div>
    </div>`;
}

export class AircraftMap {
    constructor() {
        this._map       = null;
        this._markers   = new Map(); // icaoHex → { marker, polyline, ac, enrichment, lastCallsign, pinned }
        this._fitted    = false;
        this._pinnedHex = null;
    }

    init(divId, lat = 47.38, lon = 8.54) {
        this._map = L.map(divId, { zoomControl: true }).setView([lat, lon], 7);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 18,
        }).addTo(this._map);

        if (lat !== 47.38 || lon !== 8.54) {
            L.circleMarker([lat, lon], {
                radius: 6, color: '#fff', fillColor: '#fff', fillOpacity: 0.8, weight: 2,
            }).addTo(this._map).bindTooltip('Receiver');
        }

        this._map.on('click', () => this._unpinCurrent());
    }

    updateAircraft(ac) {
        if (!this._map || ac.lat == null || ac.lon == null) return;

        const latlng = [ac.lat, ac.lon];

        if (this._markers.has(ac.icaoHex)) {
            const entry = this._markers.get(ac.icaoHex);
            entry.ac = ac;
            entry.marker.setLatLng(latlng);
            entry.marker.setIcon(makeIcon(ac.heading));
            entry.marker.setTooltipContent(tooltipContent(ac, entry.enrichment));
            if (ac.positionHistory.length >= 2) {
                entry.polyline.setLatLngs(ac.positionHistory.map(p => [p.lat, p.lon]));
            }
            // Callsign may arrive after the marker was first created — trigger enrichment then.
            if (ac.callsign && ac.callsign !== entry.lastCallsign) {
                this._startEnrichment(entry);
            }
        } else {
            const marker = L.marker(latlng, { icon: makeIcon(ac.heading) })
                .addTo(this._map)
                .bindTooltip(tooltipContent(ac), TOOLTIP_OPTS);

            const trackCoords = ac.positionHistory.length >= 2
                ? ac.positionHistory.map(p => [p.lat, p.lon])
                : [latlng, latlng];

            const polyline = L.polyline(trackCoords, {
                color: TRACK_COLOR,
                weight: 2,
                dashArray: '5, 6',
            }).addTo(this._map);

            const entry = { marker, polyline, ac, enrichment: null, lastCallsign: '', pinned: false };
            this._markers.set(ac.icaoHex, entry);

            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                this._togglePin(ac.icaoHex);
            });

            this._startEnrichment(entry);

            if (!this._fitted) {
                this._fitted = true;
                this._map.setView(latlng, 7);
            }
        }
    }

    removeAircraft(icaoHex) {
        if (!this._map || !this._markers.has(icaoHex)) return;
        if (this._pinnedHex === icaoHex) this._pinnedHex = null;
        const { marker, polyline } = this._markers.get(icaoHex);
        marker.remove();
        polyline.remove();
        this._markers.delete(icaoHex);
    }

    // --- private ---

    _startEnrichment(entry) {
        const { ac } = entry;
        entry.lastCallsign = ac.callsign;
        fetchEnrichment(ac.icaoHex, ac.callsign).then(enr => {
            entry.enrichment = enr;
            entry.marker.setTooltipContent(tooltipContent(entry.ac, enr));
        });
    }

    _togglePin(icaoHex) {
        const entry = this._markers.get(icaoHex);
        if (!entry) return;

        if (this._pinnedHex && this._pinnedHex !== icaoHex) {
            this._unpinCurrent();
        }

        if (entry.pinned) {
            entry.pinned = false;
            entry.marker.unbindTooltip().bindTooltip(
                tooltipContent(entry.ac, entry.enrichment), TOOLTIP_OPTS,
            );
            this._pinnedHex = null;
        } else {
            entry.pinned = true;
            entry.marker.unbindTooltip().bindTooltip(
                tooltipContent(entry.ac, entry.enrichment),
                { ...TOOLTIP_OPTS, permanent: true },
            );
            entry.marker.openTooltip();
            this._pinnedHex = icaoHex;
        }
    }

    _unpinCurrent() {
        if (!this._pinnedHex) return;
        const entry = this._markers.get(this._pinnedHex);
        if (entry) {
            entry.pinned = false;
            entry.marker.unbindTooltip().bindTooltip(
                tooltipContent(entry.ac, entry.enrichment), TOOLTIP_OPTS,
            );
        }
        this._pinnedHex = null;
    }
}
