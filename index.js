import { Demodulator } from "./demodulator.js";
import { AircraftStore } from "./aircraft-store.js";
import { AircraftMap } from "./aircraft-map.js";
import { startDemo } from "./demo.js";

let readSamples = true;
let introSection  = document.querySelector('.intro');
let mainSection   = document.querySelector('.app');
let waitingMessage = document.querySelector('.blink-me');
let msgString = '';
let msgsArray = [];
let started = false;
let msgReceived = false;

const demodulator = new Demodulator();
const store = new AircraftStore();
const aircraftMap = new AircraftMap();

// Wire store → map: every time an aircraft state changes, update the marker.
store.onChange(ac => aircraftMap.updateAircraft(ac));

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
    waitingMessage.style.display = "none";
    aircraftMap.init('map', 47.38, 8.54);
    startDemo(store);
}

// --- Button wiring ---
document.getElementById('btn-connect').onclick = () => start();
document.getElementById('btn-demo').onclick    = () => demo();

// --- Message handler ---
const onMsg = (msg) => {
    if (!msgReceived) {
        waitingMessage.style.display = "none";
        msgReceived = true;
    }
    displayAircraftData(msg);
    store.update(msg);
};

// --- Text feed (unchanged from original) ---
const displayAircraftData = msg => {
    msgsArray.push(JSON.stringify(msg));
    handleData(msgsArray);
};

let msgIndex = 0;
let previousIndex;

const handleData = array => {
    if (msgIndex !== previousIndex) {
        let msg = JSON.parse(array[msgIndex]);

        let keys = Object.keys(msg).filter(k => k !== 'msg');
        keys.forEach(k => {
            msgString += `${k}: ${msg[k]},`;
        });

        showText(".data", msgString, 0, 20);
        previousIndex = msgIndex;
    }
};

let timer;

var showText = function (target, message, index, interval) {
    if (index < message.length) {
        document.querySelector('.data').append(`${message[index++]}`);

        if (message[index] === ",") {
            document.querySelector('.data').append(`${message[index++]}`);
            document.querySelector('.data').innerHTML += "</br>";
        }
        document.querySelector('.data').scrollTop = document.querySelector('.data').scrollHeight;

        timer = setTimeout(function () {
            showText(target, message, index, interval);
        }, interval);
    } else {
        clearTimeout(timer);
        msgIndex++;
    }
};
