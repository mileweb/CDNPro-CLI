#!/usr/bin/env node
'use strict';

/**
 * Removes dist/ so a build contains only what the current sources produce.
 * tsc never deletes output for sources that were removed or renamed, so without
 * this a stale compiled file (an old wrapper, a deleted test) keeps running in
 * `npm test` and keeps shipping in the published package.
 */
const fs = require('fs');
const path = require('path');

fs.rmSync(path.join(__dirname, '..', 'dist'), { recursive: true, force: true });
