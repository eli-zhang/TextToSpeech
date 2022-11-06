// Imports the Google Cloud client library
const speech = require('@google-cloud/speech');
const fs = require('fs');
const path = require('path');
let ffmpeg = require('fluent-ffmpeg');
const async = require("async");
const { getSystemErrorMap } = require('util');

// Creates a client
const client = new speech.SpeechClient();
const DIRECTORY = "recordings"
const TRANSCRIPTION_MAX = 100;

const CONFIDENCE_THRESHOLD = 0.9
const START_TIME_PADDING = 0.05;
const END_TIME_PADDING = 0.05;

const loopDirectories = async (dir, queue) => {
    try {
        const files = await fs.promises.readdir(dir);

        for (const file of files) {
            const p = path.join(dir, file);
            const stat = await fs.promises.stat(p);
        
            if (stat.isDirectory()) {
                loopFiles(p, queue);
            }
        }
    } catch (e) {
        console.error(e);
    }
}

const loopFiles = async (dir, queue) => {
    try {
        const files = await fs.promises.readdir(dir);
    
        for (const file of files) {
            const p = path.join(dir, file);
            const stat = await fs.promises.stat(p);
        
            if (stat.isFile()) {
                if (p.includes(".wav")) {
                    queue.push(p, (err) => {
                        console.log("Finished processing file: " + p);
                    });
                }
            }
        }
    } catch (e) {
        console.error(e);
    }
}

async function transcribeAudio(fileName, callback) {
    let words = [];

    // The audio file's encoding, sample rate in hertz, and BCP-47 language code
    const audio = {
        content: fs.readFileSync(fileName).toString('base64'),
    };

    const config = {
        enableWordTimeOffsets: true,
        enableWordConfidence: true,
        languageCode: 'en-US',
    };
    const request = {
        audio: audio,
        config: config,
    };

    let extension = path.extname(fileName);
    const secondaryRecordingTimestamp = path.basename(fileName, extension);
    const mainRecordingTimestamp = fileName.substring(fileName.indexOf(DIRECTORY) + DIRECTORY.length + 1, fileName.indexOf(secondaryRecordingTimestamp) - 1);

    if (fs.existsSync(`${DIRECTORY}/${mainRecordingTimestamp}_${secondaryRecordingTimestamp}.json`)) {
        callback();
        return;
    }

    // Detects speech in the audio file. This creates a recognition job that you
    // can wait for now, or get its result later.
    const [operation] = await client.longRunningRecognize(request);

    // Get a Promise representation of the final result of the job
    const [response] = await operation.promise();

    response.results.forEach(result => {
        // console.log(`Transcription: ${result.alternatives[0].transcript}`);
        result.alternatives[0].words.forEach(wordInfo => {
        // NOTE: If you have a time offset exceeding 2^32 seconds, use the
        // wordInfo.{x}Time.seconds.high to calculate seconds.
        const startSecs =
            `${wordInfo.startTime.seconds}` +
            '.' +
            wordInfo.startTime.nanos / 100000000;
        const endSecs =
            `${wordInfo.endTime.seconds}` +
            '.' +
            wordInfo.endTime.nanos / 100000000;
        if (wordInfo.confidence > CONFIDENCE_THRESHOLD) {
            words.push({word: wordInfo.word, startTime: startSecs, endTime: endSecs, confidence: wordInfo.confidence});
        }
        });
    });

    fs.writeFile(`${DIRECTORY}/${mainRecordingTimestamp}_${secondaryRecordingTimestamp}.json`, JSON.stringify(words), (err) => {
        if (err) {
            throw err;
        }
        console.log(`JSON data for ${secondaryRecordingTimestamp} saved.`);
        callback();
    });

    // TODO: Figure out whether to dynamically create phrases or split them beforehand
    // splitAudioIntoWords(fileName, words);
}

const splitAudioIntoWords = async (file, words) => {
    const originalTimestamp = file.substring(file.indexOf("/") + 1, file.indexOf("."));
    
    // Create path to write recordings to.
    if (!fs.existsSync(`${originalTimestamp}`)) {
        fs.mkdirSync(`${originalTimestamp}`, { recursive: true });
    }

    let promises = []

    words.forEach((wordInfo) => {
        let { word, startTime, endTime } = wordInfo;

        const fileName = path.join(
            DIRECTORY,
            originalTimestamp,
            word
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
                    console.log("Word cropping done.");
                    resolve();
                }
            })
            .saveToFile(fileName);
        })

        promises.push(prom);
    })

    await Promise.all(promises);
    console.log("Done processing all files!");
    // fs.unlinkSync(file);
}

const queue = async.queue((fileName, callback) => { transcribeAudio(fileName, callback)}, TRANSCRIPTION_MAX); // Cap the number of concurrent transcriptions

queue.drain(() => {
    console.log('All files have been processed.');
});

loopDirectories(DIRECTORY, queue);