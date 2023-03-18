// Imports the Google Cloud client library
const speech = require('@google-cloud/speech');
const fs = require('fs');
const path = require('path');
let ffmpeg = require('fluent-ffmpeg');
const async = require("async");
const execSync = require('child_process').execSync;
const cliProgress = require('cli-progress');
const { google } = require('@google-cloud/speech/build/protos/protos');


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

const loopDirectories = async (dir, lambda) => {
    try {
        const files = await fs.promises.readdir(dir);
        const multibar = new cliProgress.MultiBar({
            clearOnComplete: false,
            hideCursor: true,
            format: ' {bar} | {filename} | {value}/{total}',
        }, cliProgress.Presets.shades_grey);
        let bar = multibar.create(files.length, 0);
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i]
            const p = path.join(dir, file);

            const stat = await fs.promises.stat(p);
            bar.update(i, {filename: p})

            if (stat.isDirectory() && !p.includes(`${WHISPER_TRANSCRIPTIONS_DIRECTORY}`) && !p.includes(`${GOOGLE_TRANSCRIPTIONS_DIRECTORY}`)) {
                loopFiles(p, lambda);
            }
        }
        multibar.stop();
    } catch (e) {
        console.error(e);
    }
}

const loopFiles = async (dir, lambda, fileExtension = ".wav") => {
    try {
        const files = await fs.promises.readdir(dir);
    
        for (let i = 0; i < files.length; i++) {
            const file = files[i]
            const p = path.join(dir, file);
            const stat = await fs.promises.stat(p);
        
            if (stat.isFile()) {
                if (p.includes(fileExtension)) {
                    await lambda(p)
                }
            }
        }
    } catch (e) {
        console.error(e);
    }
}

async function transcribeAudioWithWhisper(fileName) {
    let extension = path.extname(fileName);
    const secondaryRecordingTimestamp = path.basename(fileName, extension);
    const mainRecordingTimestamp = fileName.substring(fileName.indexOf(DIRECTORY) + DIRECTORY.length + 1, fileName.indexOf(secondaryRecordingTimestamp) - 1);
    const whisperFilesOutputDir = `${DIRECTORY}/${WHISPER_TRANSCRIPTIONS_DIRECTORY}`

    return new Promise((resolve, reject) => {
        if (fs.existsSync(`${DIRECTORY}/${WHISPER_TRANSCRIPTIONS_DIRECTORY}/${mainRecordingTimestamp}_${secondaryRecordingTimestamp}.json`) || failedFiles.has(fileName)) {
            resolve()
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
                resolve()
            });
    
        } catch(e) {
            console.log('Error:', e.stack);
            reject()
        }
    })

    
}

async function transcribeAudioWithGoogle(fileName, callback) {
    let words = [];

    // The audio file's encoding, sample rate in hertz, and BCP-47 language code
    const audio = {
        content: fs.readFileSync(fileName).toString('base64'),
    };
    let extension = path.extname(fileName);
    const secondaryRecordingTimestamp = path.basename(fileName, extension);
    const mainRecordingTimestamp = fileName.substring(fileName.indexOf(DIRECTORY) + DIRECTORY.length + 1, fileName.indexOf(secondaryRecordingTimestamp) - 1);

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
        // callback();
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
        // callback();
    });

    // TODO: Figure out whether to dynamically create phrases or split them beforehand
    // splitAudioIntoWords(fileName, words);
}

const transcribeAllFilesWithWhisper = () => {
    const lambda = transcribeAudioWithWhisper;
    loopDirectories(DIRECTORY, lambda);
}

const splitAllFilesIntoWords = async () => {
    const lambda = splitAudioFromWordsFile;
    loopFiles(`${DIRECTORY}/${WHISPER_TRANSCRIPTIONS_DIRECTORY}`, lambda, ".json");
}

const splitAudioFromWordsFile = async (wordsFilePath) => {
    const processedCroppingPath = `${DIRECTORY}/processedCropping.json`
    const failedCroppingPath = `${DIRECTORY}/failedCropping.json`
    let processedCropping = new Set()
    let failedCropping = new Set()

    return new Promise(async (resolve, reject) => {
        if (fs.existsSync(processedCroppingPath)) {
            const processedCroppingJSON = fs.readFileSync(processedCroppingPath);
            processedCropping = new Set(JSON.parse(processedCroppingJSON))
            if (processedCropping.has(wordsFilePath)) return
        }
    
        if (fs.existsSync(failedCroppingPath)) {
            const failedCroppingJSON = fs.readFileSync(failedCroppingPath);
            failedCropping = new Set(JSON.parse(failedCroppingJSON))
            if (failedCropping.has(wordsFilePath)) return
        }
    
        const wordsJSON = fs.readFileSync(wordsFilePath);
        console.log(wordsFilePath)
        const words = JSON.parse(wordsJSON)
        const extension = path.extname(wordsFilePath);
        const wordsFileName = path.basename(wordsFilePath, extension);
        const audioFileFolder = wordsFileName.split("_")[0]
        const audioFileName = wordsFileName.split("_")[1]
        const audioFileLocation = `${DIRECTORY}/${audioFileFolder}/${audioFileName}.wav`
        try {
            await splitAudioFileIntoWords(audioFileLocation, words)
        } catch (err) {
            console.log(err)
            failedCropping.add(wordsFilePath)
            fs.writeFile(failedCroppingPath, JSON.stringify(Array.from(failedCropping), null, 2), (err) => {
                if (err) {
                    throw err;
                }
                console.log(`Cropping failure for ${wordsFilePath} recorded.`);
                reject()
            });
        }
    
        processedCropping.add(wordsFilePath)
        fs.writeFile(processedCroppingPath, JSON.stringify(Array.from(processedCropping), null, 2), (err) => {
            if (err) {
                throw err;
            }
            console.log(`Cropping success for ${wordsFilePath} recorded.`);
            resolve()
        });
    })

    
}

const splitAudioFileIntoWords = async (file, words) => {
    const originalTimestamp = file.substring(file.indexOf(DIRECTORY) + DIRECTORY.length + 1, file.indexOf("."));
    
    // Create path to write recordings to.
    if (!fs.existsSync(`${DIRECTORY}/${originalTimestamp}`)) {
        fs.mkdirSync(`${DIRECTORY}/${originalTimestamp}`, { recursive: true });
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

splitAllFilesIntoWords()

// transcribeAllFilesWithWhisper();

// COMMENTING OUT ABOVE FOR NOW JUST FOR TESTING
// file = fs.readFileSync("temp_test.json");
// const words = JSON.parse(file)
// splitAudioIntoWords("./test/174178239767.wav", words);