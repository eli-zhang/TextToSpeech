
const fs = require('fs');
const path = require('path');

const DIRECTORY = "recordings"

let wordNodeMap = {}
let wordFrequencyMap = {}

// Here's the plan:
// Make a node for every unique word
// Each node has a list of files that have that word
// Have an edge to every word that is connected to it in a sentence

class WordNode {
    constructor(word) {
        this.word = word
        this.wordInfoPerFile = []
    }

    
}

const checkWordEquality = (firstWordInfo, secondWordInfo) => {
    firstWordInfo.word === secondWordInfo.word && firstWordInfo.startTime === secondWordInfo.startTime
    && firstWordInfo.endTime === secondWordInfo.endTime 
}

// Load all the JSONS
const loopJSONFiles = async (dir) => {
    try {
        const files = await fs.promises.readdir(dir);
    
        for (const file of files) {
            const p = path.join(dir, file);
            const stat = await fs.promises.stat(p);
        
            if (stat.isFile()) {
                if (p.includes(".json")) {
                    addJSONInfoToGraph(p);
                }
            }
        }
    } catch (e) {
        console.error(e);
    }
    const sortedWordFrequencies = Object.fromEntries(
        Object.entries(wordFrequencyMap).sort(([,a],[,b]) => a-b)
    );

    console.log(sortedWordFrequencies)
}

const addJSONInfoToGraph = (fileName) => {
    let extension = path.extname(fileName);
    const truncatedName = path.basename(fileName, extension);
    const file = fs.readFileSync(fileName);
    try {
        const wordsInfo = JSON.parse(file);
        let prev;
        if (Array.isArray(wordsInfo) && wordsInfo.length > 0) {
            // Process each word in wordInfo
            for (let i = 0; i < wordsInfo.length; i++) {
                let wordInfo = wordsInfo[i];
                let currWord = wordInfo.word.toLowerCase();
                if (prev) {
                    prev.next = wordInfo;
                }
                wordInfo.prev = prev;

                if (!wordNodeMap[currWord]) {
                    let wordNode= new WordNode(currWord);
                    wordNode.wordInfoPerFile.push(wordInfo);
                    wordNodeMap[currWord] = wordNode;

                    wordFrequencyMap[currWord] = 1;
                } else {
                    wordNodeMap[currWord].wordInfoPerFile.push(wordInfo);
                    wordFrequencyMap[currWord] += 1;
                }

                prev = wordInfo;
            }
        }
    } catch (err) {
        console.log(`Empty or corrupt file: ${fileName}`);
    }
}

const processSentence = (sentence) => {
    let targetWords = sentence.split(" ");
    if (targetWords.length > 0) {
        targetWords.forEach((word) => {

        })
    }
}

loopJSONFiles(DIRECTORY)
