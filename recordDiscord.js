const WebSocket = require('ws');
const ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
require('dotenv').config();  

const AudioRecorder = require('node-audiorecorder')
let audioRecorder = new AudioRecorder({
    program: 'sox',
    channels: 1,
    silence: 0,
    bits: 32,
    rate: 44100,
    thresholdStart: null,
    thresholdStop: null,
    encoding: `signed-integer`
}, console);

const fs = require('fs');
const path = require('path');
const DIRECTORY = 'recordings';

// Create path to write recordings to.
if (!fs.existsSync(DIRECTORY)) {
    fs.mkdirSync(DIRECTORY);
}

// Log information on the following events.
audioRecorder.on('error', function () {
    console.warn('Recording error.');
});
audioRecorder.on('end', function () {
    console.warn('Recording ended.');
});

let recording = false;
let startTimeName;
let endTimeName;
  
let interval = 0;
const MY_USER_ID = process.env.MY_USER_ID;    // User ID for zeli

token = process.env.TOKEN;

// Need to enable the bits for the changes we want to listen to
// https://discord.com/developers/docs/topics/gateway#gateway-intents
intents = (1 << 7) | 1;

payload = {
    op: 2,
    d: {
        token,
        intents,
        properties: {
            $os: 'linux',
            $browser: 'chrome',
            $device: 'chrome'
        }
    }
};

ws.on('open', function open() {
    ws.send(JSON.stringify(payload));
    console.log("Websocket connection opened.");
})

ws.on('message', function incoming(data) {
    let payload = JSON.parse(data);
    const { t, events, op, d } = payload;
    switch (op) {
        case 10: 
            const { heartbeat_interval } = d;
            interval = heartbeat(heartbeat_interval);
            break;
    }

    switch (t) {
        case 'VOICE_STATE_UPDATE':
            if (d.user_id != MY_USER_ID) {
                break;
            }
            if (d.channel_id == null || d.self_mute) { // Just left the channel
                stopRecording();
                break;
            } else {
                console.log("You are unmuted.");
                startRecording();
            }

            break;
        default:
            // console.log(t);
    }
});

ws.on('close', function close() {
    console.log("Connection closed.")
});

const heartbeat = (ms) => {
    return setInterval(() => {
        ws.send(JSON.stringify({op: 1, d: null}));
    }, ms);
};

const startRecording = () => {
    const date = new Date();
    startTimeName = date.toISOString();
    // Create file path with random name.
    const fileName = path.join(
        DIRECTORY,
        startTimeName
        .replace(/[^0-9a-zA-Z]+/g, '')
        .concat('_recording.wav')
    );
    
    console.log('Writing new recording file at:', fileName);

    // Create write stream.
    const fileStream = fs.createWriteStream(fileName, { encoding: 'binary' });

    // Start and write to the file.
    audioRecorder.start().stream().pipe(fileStream);

    recording = true;
}

const stopRecording = () => {
    if (!recording) { 
        return;
    }
    audioRecorder.stop();

    recording = false;
}