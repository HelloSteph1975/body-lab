'use strict';
// The marker that says a folder holds made-up demo data. tools/make-demo-data.js writes it,
// and the server reports it on GET /api/info so a start script never mixes up real and demo.
const fs = require('node:fs');
const path = require('node:path');

const MARKER = '.body-lab-demo';
const MARKER_TEXT = 'Made by tools/make-demo-data.js. Everything in this folder is made up.\n'
  + 'Running the tool again on this folder deletes these notes and makes new ones.\n';

// 'missing', 'not-a-folder', 'demo' (our marker, word for word), 'bad-marker', 'empty' or 'other'.
function folderState(folder) {
  let stat;
  try {
    stat = fs.statSync(folder);
  } catch (e) {
    if (e.code === 'ENOENT') return 'missing';
    throw e;
  }
  if (!stat.isDirectory()) return 'not-a-folder';
  const marker = path.join(folder, MARKER);
  if (fs.existsSync(marker)) {
    let text = null;
    try {
      text = fs.readFileSync(marker, 'utf8');
    } catch { /* unreadable counts as wrong */ }
    return text === MARKER_TEXT ? 'demo' : 'bad-marker';
  }
  return fs.readdirSync(folder).length === 0 ? 'empty' : 'other';
}

// True only for a folder with our marker, word for word. Never throws.
function isDemoFolder(folder) {
  try {
    return folderState(folder) === 'demo';
  } catch {
    return false;
  }
}

module.exports = { MARKER, MARKER_TEXT, folderState, isDemoFolder };
