import { tooltipContent } from './aircraft-map.js';

export class AircraftList {
    constructor(containerId) {
        this._container   = document.getElementById(containerId);
        this._countEl     = document.getElementById('ac-list-count');
        this._aircraft    = new Map(); // icaoHex → { ac, enrichment }
        this._cards       = new Map(); // icaoHex → stable card element
        this._selectedHex = null;
        this._selectCb    = null;

        // Single delegated listener on the stable container element — survives
        // all inner DOM updates so clicks are always registered reliably.
        this._container.addEventListener('pointerdown', e => {
            const card = e.target.closest('.ac-list-card');
            if (!card) return;
            const hex = card.dataset.hex;
            this._selectedHex = (this._selectedHex === hex) ? null : hex;
            this._updateSelectionClass();
            this._selectCb?.(this._selectedHex);
        });

        this._renderEmpty();
    }

    onSelect(fn) { this._selectCb = fn; }

    update(icaoHex, ac, enrichment) {
        const isNew = !this._aircraft.has(icaoHex);
        this._aircraft.set(icaoHex, { ac, enrichment });

        if (isNew) {
            this._insertCard(icaoHex, ac, enrichment);
        } else {
            // Update content in-place — the card element itself stays in the DOM
            // so any in-progress click on it is never interrupted.
            const card = this._cards.get(icaoHex);
            if (card) card.innerHTML = tooltipContent(ac, enrichment);
        }

        this._updateCount();
    }

    remove(icaoHex) {
        this._aircraft.delete(icaoHex);
        this._cards.get(icaoHex)?.remove();
        this._cards.delete(icaoHex);

        if (this._selectedHex === icaoHex) {
            this._selectedHex = null;
            this._selectCb?.(null);
        }

        this._updateCount();
        if (this._aircraft.size === 0) this._renderEmpty();
    }

    // --- private ---

    _insertCard(icaoHex, ac, enrichment) {
        this._container.querySelector('.ac-list-empty')?.remove();

        const card = document.createElement('div');
        card.className = 'ac-list-card';
        card.dataset.hex = icaoHex;
        card.innerHTML = tooltipContent(ac, enrichment);

        // Insert in alphabetical order by callsign / ICAO hex.
        const name = (ac.callsign || icaoHex).toUpperCase();
        let anchor = null;
        for (const [existingHex, existingCard] of this._cards) {
            const existingName = (this._aircraft.get(existingHex)?.ac.callsign || existingHex).toUpperCase();
            if (name < existingName) { anchor = existingCard; break; }
        }
        this._container.insertBefore(card, anchor); // null → append
        this._cards.set(icaoHex, card);
    }

    _updateCount() {
        if (!this._countEl) return;
        this._countEl.textContent = this._aircraft.size > 0
            ? `${this._aircraft.size} tracked` : '';
    }

    _updateSelectionClass() {
        for (const [hex, card] of this._cards) {
            card.classList.toggle('selected', hex === this._selectedHex);
        }
    }

    _renderEmpty() {
        this._container.innerHTML = '<div class="ac-list-empty">Waiting for aircraft...</div>';
    }
}
