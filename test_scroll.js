const fs = require('fs');
const content = fs.readFileSync('app.js', 'utf8');

if (content.includes('_renderDepth++') && content.includes('_renderDepth--')) {
    console.log("OK: _renderDepth is present");
} else {
    console.log("ERROR: _renderDepth missing");
}

if (content.includes('main-scroll-container') && content.includes('mural-horizontal-scroll')) {
    console.log("OK: IDs are present");
} else {
    console.log("ERROR: IDs missing");
}
