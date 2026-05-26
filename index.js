import { Demodulator } from "./demodulator.js";
import { AircraftStore } from "./aircraft-store.js";
import { AircraftMap } from "./aircraft-map.js";
import { AircraftList } from "./aircraft-list.js";
import { startDemo } from "./demo.js";

let readSamples = true;
let introSection = document.querySelector('.intro');
let mainSection  = document.querySelector('.app');
let started = false;

const demodulator = new Demodulator();
const store = new AircraftStore();
const aircraftMap = new AircraftMap();
const aircraftList = new AircraftList('ac-list');

// Wire store → map: every time an aircraft state changes, update the marker.
store.onChange(ac => aircraftMap.updateAircraft(ac));

// Wire map → list: mirror map state into the sidebar.
aircraftMap.onUpdate((hex, ac, enr) => aircraftList.update(hex, ac, enr));
aircraftMap.onRemove(hex => aircraftList.remove(hex));

// Wire list → map: clicking a scratchpad card highlights the marker.
aircraftList.onSelect(hex => aircraftMap.selectAircraft(hex));

// Remove stale aircraft every 30 s.
setInterval(() => {
    store.cleanup().forEach(hex => aircraftMap.removeAircraft(hex));
}, 30_000);

// --- Live SDR mode ---
async function start() {
    const sdr = await RtlSdr.requestDevice();
    introSection.style.display = "none";
    mainSection.style.display = "flex";

    // Try to centre the map on the receiver's physical location.
    navigator.geolocation.getCurrentPosition(
        pos => {
            store.setReceiverPosition(pos.coords.latitude, pos.coords.longitude);
            aircraftMap.init('map', pos.coords.latitude, pos.coords.longitude);
        },
        () => aircraftMap.init('map', 47.38, 8.54),
    );

    await sdr.open({ ppm: 0.5 });
    await sdr.setSampleRate(2000000);
    await sdr.setCenterFrequency(1090000000);
    await sdr.resetBuffer();

    while (readSamples) {
        if (!started) {
            console.log('starting...');
            started = true;
        }
        const samples = await sdr.readSamples(128000);
        demodulator.process(new Uint8Array(samples), 256000, onMsg);
    }
}

// --- Demo mode ---
function demo() {
    introSection.style.display = "none";
    mainSection.style.display = "flex";
    aircraftMap.init('map', 47.38, 8.54);
    startDemo(store);
}

// --- Button wiring ---
document.getElementById('btn-connect').onclick = () => start();
document.getElementById('btn-demo').onclick    = () => demo();

// --- Message handler ---
const onMsg = (msg) => {
    store.update(msg);
};
