let ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const filter = 'silencedetect=n=-30dB:d=2';  // Look for silences of duration 2, with -30 dB as the threshold
const DIRECTORY = "recordings"

const START_TIME_PADDING = 0.5;
const END_TIME_PADDING = 0.5;

const runCommandOnFile = (file) => {
    let timestampsOfSilence = [];
    let timestampsOfSound = [];
    let startTime;
    let endTime = 0;

    ffmpeg(file)
    .audioFilters(filter)
    .format(null)
    .on('error', function(err) {
        console.log('An error occurred: ' + err.message);
    })
    .on('end', function() {
        console.log('Processing finished !');
        splitAudioByTimestamps(file, timestampsOfSound);
    })
    .on('stderr', function(stderr) {
        if (stderr.includes("silencedetect @")) {
            const startString = "silence_start";
            const endString = "silence_end";

            if (stderr.includes(startString)) {
                const startStringEndIndex = stderr.indexOf(startString) + startString.length + 1;
                startTime = stderr.substring(startStringEndIndex);
                timestampsOfSound.push({ startTime: endTime, endTime: startTime });     // old end time of silence is start time of
            } else if (stderr.includes(endString)) {
                const endStringEndIndex = stderr.indexOf(endString) + endString.length + 1;
                endTime = stderr.substring(endStringEndIndex, stderr.indexOf(" ", endStringEndIndex + 1));
                timestampsOfSilence.push({ startTime, endTime });
            }
        }
    })
    .save('dummy_output');  // No output, so not actually saved anywhere
}


const loopFiles = async (dir) => {
    try {
        const files = await fs.promises.readdir(dir);
    
        for (const file of files) {
            const p = path.join(dir, file);
            const stat = await fs.promises.stat(p);
        
            if (stat.isFile() && p.includes("_recording")) {
                console.log("'%s'  file.", p);
                runCommandOnFile(p);
            } else if (stat.isDirectory()) {
                console.log("'%s' directory.", p);
            }
        }
    } catch (e) {
        console.error(e);
    }
}

loopFiles(DIRECTORY);

const splitAudioByTimestamps = async (file, timestampsOfSound) => {
    const originalTimestamp = file.substring(file.indexOf("/"), file.indexOf("_"));
    
    // Create path to write recordings to.
    if (!fs.existsSync(`${originalTimestamp}`)) {
        fs.mkdirSync(`${originalTimestamp}`, { recursive: true });
    }

    let promises = []

    timestampsOfSound.forEach((timestamp) => {
        let { startTime, endTime } = timestamp;

        if (endTime - startTime < 0.3) {
            return;     // Skip clips that are shorter than 0.3 seconds
        }

        const fileName = path.join(
            originalTimestamp,
            `${startTime}_${endTime}`
            .replace(/[^0-9a-zA-Z]+/g, '')
            .concat('.wav')
        );

        let prom = new Promise((resolve, reject) => {
            ffmpeg(file)
            .setStartTime(startTime - START_TIME_PADDING)
            .setDuration(endTime - startTime + START_TIME_PADDING + END_TIME_PADDING) 
            .on("error", function(err) {
                console.log("error: ", +err);
                reject(err);
            })
            .on("end", function(err) {
                if (!err) {
                    console.log("Cropping done.");
                    resolve();
                }
            })
            .saveToFile(fileName);
        })

        promises.push(prom);
    })

    await Promise.all(promises);
    console.log("Done processing all files!");
    fs.unlinkSync(file);
}
