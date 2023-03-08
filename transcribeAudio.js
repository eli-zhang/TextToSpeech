// Imports the Google Cloud client library
const speech = require('@google-cloud/speech');
const fs = require('fs');
const path = require('path');
let ffmpeg = require('fluent-ffmpeg');
const async = require("async");
const execSync = require('child_process').execSync;
const { getSystemErrorMap } = require('util');

// Creates a client
const client = new speech.SpeechClient();
const DIRECTORY = "recordings"
const GOOGLE_TRANSCRIPTIONS_DIRECTORY = "google_transcriptions"
const WHISPER_TRANSCRIPTIONS_DIRECTORY = "whisper_transcriptions"
const FAILED_FILE_NAME = "failed_files.json"
const TRANSCRIPTION_MAX = 1;    // Max concurrent queue size

const CONFIDENCE_THRESHOLD = 0.9
const START_TIME_PADDING = 0.05;
const END_TIME_PADDING = 0.05;

let failedFiles = new Set();

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

async function transcribeAudioWithWhisper(fileName, callback) {
    let extension = path.extname(fileName);
    const secondaryRecordingTimestamp = path.basename(fileName, extension);
    const mainRecordingTimestamp = fileName.substring(fileName.indexOf(WHISPER_TRANSCRIPTIONS_DIRECTORY) + WHISPER_TRANSCRIPTIONS_DIRECTORY.length + 1, fileName.indexOf(secondaryRecordingTimestamp) - 1);
    const whisperFilesOutputDir = `${DIRECTORY}/${WHISPER_TRANSCRIPTIONS_DIRECTORY}`

    if (fs.existsSync(`${DIRECTORY}/${WHISPER_TRANSCRIPTIONS_DIRECTORY}/${mainRecordingTimestamp}_${secondaryRecordingTimestamp}.json`) || failedFiles.has(fileName)) {
        callback();
        return;
    }
    try {
        console.log(`Running whisper on file ${fileName}`)
        execSync(`whisperx ${fileName} --model base.en --output_dir ${whisperFilesOutputDir} --align_model WAV2VEC2_ASR_LARGE_LV60K_960H --align_extend 2`,
            function (error, stdout, stderr) {
                console.log('stdout: ' + stdout);
                console.log('stderr: ' + stderr);
                if (error !== null) {
                    console.log('exec error: ' + error);
                }
            }
        );
    } catch(e) {
        failedFiles.add(fileName)

        // Update failed files
        fs.writeFile(FAILED_FILE_NAME, JSON.stringify(Array.from(failedFiles), null, 2), (err) => {
            if (err) {
                throw err;
            }
        });

        console.log(`Error parsing file: ${fileName}, cleaning up.`)
    }
    

    let fileSuffix = `.word.srt`  // Doesn't include .wav
    let suffixesToDelete = ['.ass', '.srt', '.tsv', '.txt', '.vtt', `.word.srt`];

    const timestampToNumber = (timestampString) => {
        let parts = timestampString.split(":")
        let hours = parseInt(parts[0])
        let minutes = parseInt(parts[1])
        let seconds = parseInt(parts[2].split(",")[0])
        let millis = parseInt(parts[2].split(",")[1])

        return hours * 60 * 24 + minutes * 60 + seconds + millis / 1000
    }

    try {  
        let data = fs.readFileSync(`${whisperFilesOutputDir}/${secondaryRecordingTimestamp}.wav${fileSuffix}`, 'utf8');
        let lines = data.toString().replaceAll("\r", "").split("\n").filter((str) => str != "");
        words = []
        for (let i = 0; i < lines.length - 1; i++) {
            if (lines[i].includes("-->")) {
                timestamps = lines[i].split("-->").map(ele => timestampToNumber(ele.trim()))
                word = lines[i + 1]
                console.log(word, timestamps)
                words.push({"word": word, "startTime": timestamps[0], "endTime": timestamps[1]})
            }
        }
        suffixesToDelete.forEach((suffix) => {
            let fileToDelete = `${whisperFilesOutputDir}/${secondaryRecordingTimestamp}.wav${suffix}`
            fs.unlinkSync(fileToDelete);
        })
    
        fs.writeFile(`${DIRECTORY}/${WHISPER_TRANSCRIPTIONS_DIRECTORY}/${mainRecordingTimestamp}_${secondaryRecordingTimestamp}.json`, JSON.stringify(words, null, 2), (err) => {
            if (err) {
                throw err;
            }
            console.log(`JSON data for ${secondaryRecordingTimestamp} saved.`);
            callback();
        });

    } catch(e) {
        console.log('Error:', e.stack);
        callback();
    }
}

async function transcribeAudioWithGoogle(fileName, callback) {
    let words = [];

    // The audio file's encoding, sample rate in hertz, and BCP-47 language code
    const audio = {
        content: fs.readFileSync(fileName).toString('base64'),
    };
    let extension = path.extname(fileName);
    const secondaryRecordingTimestamp = path.basename(fileName, extension);
    const mainRecordingTimestamp = fileName.substring(fileName.indexOf(GOOGLE_TRANSCRIPTIONS_DIRECTORY) + GOOGLE_TRANSCRIPTIONS_DIRECTORY.length + 1, fileName.indexOf(secondaryRecordingTimestamp) - 1);

    const config = {
        enableWordTimeOffsets: true,
        enableWordConfidence: true,
        languageCode: 'en-US',
    };
    const request = {
        audio: audio,
        config: config,
    };

   

    if (fs.existsSync(`${DIRECTORY}/${GOOGLE_TRANSCRIPTIONS_DIRECTORY}/${mainRecordingTimestamp}_${secondaryRecordingTimestamp}.json`)) {
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

    fs.writeFile(`${DIRECTORY}/${GOOGLE_TRANSCRIPTIONS_DIRECTORY}${mainRecordingTimestamp}_${secondaryRecordingTimestamp}.json`, JSON.stringify(words), (err) => {
        if (err) {
            throw err;
        }
        console.log(`JSON data for ${secondaryRecordingTimestamp} saved.`);
        callback();
    });

    // TODO: Figure out whether to dynamically create phrases or split them beforehand
    // splitAudioIntoWords(fileName, words);
}

const transcribeAllFilesWithWhisper = () => {
    const queue = async.queue((fileName, callback) => { transcribeAudioWithWhisper(fileName, callback)}, TRANSCRIPTION_MAX); // Cap the number of concurrent transcriptions

    queue.drain(() => {
        console.log('All files have been processed.');
    });

    loopDirectories(DIRECTORY, queue);
}

const splitAllFilesIntoWords = async () => {
    const queue = async.queue((fileName, callback) => { splitAudioIntoWords(fileName, callback)}, TRANSCRIPTION_MAX); // Cap the number of concurrent transcriptions

    queue.drain(() => {
        console.log('All files have been processed.');
    });

    loopFiles(`${DIRECTORY}/${WHISPER_TRANSCRIPTIONS_DIRECTORY}`, queue);

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

if (fs.existsSync(FAILED_FILE_NAME)) {
    const failedFilesJSON = fs.readFileSync(FAILED_FILE_NAME);
    failedFiles = new Set(JSON.parse(failedFilesJSON));
}

transcribeAllFilesWithWhisper();

// COMMENTING OUT ABOVE FOR NOW JUST FOR TESTING
file = fs.readFileSync("temp_test.json");
const words = JSON.parse(file)
splitAudioIntoWords("./test/174178239767.wav", words);