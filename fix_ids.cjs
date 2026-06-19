const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

// Find the section for terminology tab and replace the IDs
const startDict = html.indexOf('<!-- Tab 4: Terminology Settings -->');
if (startDict !== -1) {
    let before = html.substring(0, startDict);
    let termPanel = html.substring(startDict);

    termPanel = termPanel.replace('id="load-preset-rules-btn"', 'id="term-load-preset-rules-btn"');
    termPanel = termPanel.replace('id="save-preset-rules-btn"', 'id="term-save-preset-rules-btn"');
    termPanel = termPanel.replace('id="export-rules-btn"', 'id="term-export-rules-btn"');
    termPanel = termPanel.replace('id="import-rules-btn"', 'id="term-import-rules-btn"');
    termPanel = termPanel.replace('id="import-rules-file-input"', 'id="term-import-rules-file-input"');
    
    html = before + termPanel;
    fs.writeFileSync('index.html', html);
    console.log('Fixed duplicate IDs in terminology tab.');
}
