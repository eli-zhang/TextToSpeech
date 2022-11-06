
const fs = require('fs');
const path = require('path');

const DIRECTORY = "recordings"


// Here's the plan:
// Make a node for every unique word
// Each node has a list of files that have that word
// Have an edge to every word that is connected to it in a sentence

class WordNode {
    constructor(word) {
        this.word = word
        this.filesContainingWords = []
    }
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
}

const addJSONInfoToGraph = (fileName) => {
    let extension = path.extname(fileName);
    const truncatedName = path.basename(fileName, extension);
    const file = fs.readFileSync(fileName);

    console.log("file name: " + fileName);
    console.log(    JSON.pars