let ffmpeg = require('fluent-ffmpeg');

const file = 'recordings/20220711T023522928Z_recording.wav';
const filter = 'silencedetect=n=-30dB:d=2';  // Look for silences of duration 2, with -30 dB as the threshold

let timestampsOfSound = [];
let startTime;
let endTime;

let command = ffmpeg(file)
    .audioFilters(filter)
    .format(null)
    .on('error', function(err) {
        console.log('An error occurred: ' + err.message);
    })
    .on('end', function() {
        console.log('Processing finished !');
    })
    .on('stderr', function(stderr) {
        if (stderr.includes("silencedetect @")) {
            const startString = "silence_start";
            const endString = "silence_end";

            if (stderr.includes(startString)) {
                const startStringEndIndex = stderr.indexOf(startString) + startString.length + 1;
                console.log("Start", stderr.substring(startStringEndIndex))// stderr.indexOf(" ", startStringEndIndex + 1)));
            } else if (stderr.includes(endString)) {
                const endStringEndIndex = stderr.indexOf(endString) + endString.length + 1;
                console.log("End", stderr.substring(endStringEndIndex, stderr.indexOf(" ", endStringEndIndex + 1)));
            }
        }
    })
    .save('dummy_output');  // No output, so not actually saved anywhere
