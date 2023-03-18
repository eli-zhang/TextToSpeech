const fs = require('fs');
const path = require('path');
let ffmpeg = require('fluent-ffmpeg');
const async = require("async");
const { endianness } = require('os');
const execSync = require('child_process').execSync;
const cliProgress = require('cli-progress');

const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout,
});

const DIRECTORY = "recordings"
const GOOGLE_TRANSCRIPTIONS_DIRECTORY = "google_transcriptions"
const WHISPER_TRANSCRIPTIONS_DIRECTORY = "whisper_transcriptions"

let fileToWordMatch = {}

const loopFiles = async (dir, wordsInTargetPhrase) => {
    try {
        const files = await fs.promises.readdir(dir);
        const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
        bar.start(files.length, 0);
    
        for (let i = 0; i < files.length; i++) {
            bar.increment()
            let file = files[i]
            const p = path.join(dir, file);
            const stat = await fs.promises.stat(p);
        
            if (stat.isFile()) {
                if (p.includes(".json")) {
                    getLongestPhraseMatch(p, wordsInTargetPhrase)
                }
            }
        }
        bar.stop()
    } catch (e) {
        console.error(e);
    }
}

const getLongestPhraseMatch = (fileName, wordsInTargetPhrase) => {
    const wordsJSON = fs.readFileSync(fileName);
    const words = JSON.parse(wordsJSON).map((wordInfo) => wordInfo.word);   // Optional: add .toLowerCase() to wordInfo map
    const subarrayInfo = longestCommonSubarray(words, wordsInTargetPhrase);

    if (subarrayInfo.longestCommonSubarray.length > 0) {
        let newPhrases = [wordsInTargetPhrase.slice(0, subarrayInfo.phrase2StartIndex), wordsInTargetPhrase.slice(subarrayInfo.phrase2EndIndex)]
        fileToWordMatch[fileName] = { length: subarrayInfo.longestCommonSubarray.length, subArray: subarrayInfo.longestCommonSubarray, 
            subarrayStartIndex: subarrayInfo.phrase1StartIndex, subarrayEndIndex: subarrayInfo.phrase1EndIndex, newPhrases: newPhrases };
    }
}

const findClosestMatchingFile = async(phrase) => {
    sanitizedPhrase = phrase.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"")
    const matchingFiles = await findClosestMatchingFileFromArr(sanitizedPhrase.split(" "))
    let pathList = []
    matchingFiles.forEach((fileInfo) => {
        const { fileName, subArray } = fileInfo
        const extension = path.extname(fileName);
        const timestamp = path.basename(fileName, extension);

        subArray.forEach((word) => { // TODO: edit to use indices instead of just finding the word
            word = word.replace(/'|"|\'?/g,"")
            pathList.push(`${DIRECTORY}/${timestamp.split("_")[0]}/${timestamp.split("_")[1]}/${word}.wav`)
        })
    })
    mergeAllPathsTogether(sanitizedPhrase, pathList)
    return matchingFiles
}

const findClosestMatchingFileFromArr = async (wordsInTargetPhrase) => {
    if (wordsInTargetPhrase === []) return []

    if (Object.keys(fileToWordMatch).length === 0) {
        await loopFiles(`${DIRECTORY}/${WHISPER_TRANSCRIPTIONS_DIRECTORY}`, wordsInTargetPhrase);
    }

    let matchingWordsPerFile = {}
    let highestCount = 0;

    Object.entries(fileToWordMatch).forEach(([fileName, fileInfo]) => {
        let count = fileInfo.length 
        if (count > highestCount) {
            highestCount = count;
        }
        if (matchingWordsPerFile[count]) {
            matchingWordsPerFile[count].push({fileName, fileInfo})
        } else {
            matchingWordsPerFile[count] = [{fileName, fileInfo}]
        }
    })

    if (highestCount === 0) {   // No matching files
        return []
    }

    let greedyBestMatches = matchingWordsPerFile[highestCount]
    let randomFileMatchingMostWords = greedyBestMatches[Math.floor(Math.random() * greedyBestMatches.length)];
    let { newPhrases, subArray, subarrayStartIndex, subarrayEndIndex } = randomFileMatchingMostWords.fileInfo

    fileToWordMatch = {}
    let closestMatchLeftSide = await findClosestMatchingFileFromArr(newPhrases[0])
    let closestMatchRightSide = await findClosestMatchingFileFromArr(newPhrases[1])
    return [...closestMatchLeftSide, { fileName: randomFileMatchingMostWords.fileName, subArray, subarrayStartIndex, subarrayEndIndex }, ...closestMatchRightSide]
}

const arraysEqual = (a, b) => {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (a.length !== b.length) return false;
  
    for (var i = 0; i < a.length; ++i) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }


const longestCommonSubarray = (phraseArr1, phraseArr2) => {
    let pointer1 = 0, pointer2 = 0
    let val1, val2
    let maxWindowSize = 0
    let answer = [];
    let phrase1StartIndex = -1, phrase1EndIndex = -1, phrase2StartIndex, phrase2EndIndex;   // End index is exclusive (don't include)
    while (pointer1 + maxWindowSize < phraseArr1.length && maxWindowSize < phraseArr2.length) {
        val1 = phraseArr1.slice(pointer1, pointer1 + maxWindowSize + 1), val2 = phraseArr2.slice(pointer2, pointer2 + maxWindowSize + 1);
        if (arraysEqual(val1, val2)) {    // Values equal, we can increase the window size
            answer = val1;
            phrase1StartIndex = pointer1;
            phrase1EndIndex = pointer1 + maxWindowSize + 1;
            phrase2StartIndex = pointer2;
            phrase2EndIndex = pointer2 + maxWindowSize + 1;
            maxWindowSize++;
        } else {
            pointer2++;
        }
        if (pointer2 + maxWindowSize === phraseArr2.length) {
            pointer2 = 0
            pointer1++;
        }
    }
    return { longestCommonSubarray: answer, phrase1StartIndex, phrase1EndIndex, phrase2StartIndex, phrase2EndIndex };
}

const mergeAllPathsTogether = (phrase, pathList) => {
    if (pathList.length === 0) {
        return
    }
    let pathAccumulator = ffmpeg(pathList[0]).on('error', function(err) {
        console.log('An error occurred: ' + err.message);
    })
    .on('end', function() {
        console.log('Merging finished !');
    })

    for (let i = 1; i < pathList.length; i++) {
        pathAccumulator.input(pathList[i])
    }

    pathAccumulator.mergeToFile(`${DIRECTORY}/${phrase}.wav`)
}

  
// create empty user input
let userInput = "";
  

const promptAndGeneratePhrase = async () => {
    // question user to enter name
    readline.question("Enter a phrase:\n", async (string) => {
        userInput = string;
    
        console.log("Your phrase: " + userInput);

        await findClosestMatchingFile(userInput)
    
        // close input stream
        readline.close();
    });
}

promptAndGeneratePhrase()
