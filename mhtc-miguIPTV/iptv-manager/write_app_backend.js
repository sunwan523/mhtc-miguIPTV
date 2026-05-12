const fs = require('fs');

// Read the current app.js source
const src = fs.readFileSync('app.js', 'utf8');

// Fix 1: Ensure decodeURIComponent is in GET /api/playlist
// Fix 2: Ensure decodeURIComponent is in PUT /api/playlist
// Fix 3: Ensure decodeURIComponent is in DELETE /api/playlist
// Fix 4: Ensure decodeURIComponent is in playlist M3U route
// Fix 5: Content-Disposition for saved playlists uses generic filename

let fixed = src;

// Check and fix GET playlist route
const getPattern = 'var getId = ';
const getDecoded = 'var getId = decodeURIComponent(';
if (fixed.indexOf(getDecoded) < 0 && fixed.indexOf(getPattern) >= 0) {
    // Only fix if not already done
    fixed = fixed.replace(
        'if (p.indexOf(\'/api/playlist/\') === 0 && m === \'GET\') {\n        var getId = p.substring(\'/api/playlist/\'.length);',
        'if (p.indexOf(\'/api/playlist/\') === 0 && m === \'GET\') {\n        var getId = decodeURIComponent(p.substring(\'/api/playlist/\'.length));'
    );
    console.log('Fixed GET route');
} else {
    console.log('GET route already OK or not found');
}

// Check PUT route
fixed = fixed.replace(
    'if (p.indexOf(\'/api/playlist/\') === 0 && m === \'PUT\') {\n        var putId = p.substring(\'/api/playlist/\'.length);',
    'if (p.indexOf(\'/api/playlist/\') === 0 && m === \'PUT\') {\n        var putId = decodeURIComponent(p.substring(\'/api/playlist/\'.length));'
);
console.log('Fixed PUT route');

// Check DELETE route
fixed = fixed.replace(
    'if (m === \'DELETE\' && p.indexOf(\'/api/playlist/\') === 0) {\n        var delId = p.substring(\'/api/playlist/\'.length);',
    'if (m === \'DELETE\' && p.indexOf(\'/api/playlist/\') === 0) {\n        var delId = decodeURIComponent(p.substring(\'/api/playlist/\'.length));'
);
console.log('Fixed DELETE route');

// Check M3U route
fixed = fixed.replace(
    'var plId = decodeURIComponent(plMatch[1]);\n        var pl = savedPlaylists[plId];\n        if (!pl) return sendText(res, 404, \'text/plain; charset=utf-8\', \'播放列表未找到\');\n        var channels = lookupChannelsByUrls(pl.urls);\n        res.writeHead(200, { \'Content-Type\': \'audio/x-mpegurl\', \'Content-Disposition\': \'attachment; filename="\' + pl.name + \'.m3u"\' });',
    'var plId = decodeURIComponent(plMatch[1]);\n        var pl = savedPlaylists[plId];\n        if (!pl) return sendText(res, 404, \'text/plain; charset=utf-8\', \'播放列表未找到\');\n        var channels = lookupChannelsByUrls(pl.urls);\n        res.writeHead(200, { \'Content-Type\': \'audio/x-mpegurl\', \'Content-Disposition\': \'attachment; filename="playlist.m3u"\' });'
);
console.log('Fixed M3U route');

// Verify ending is complete (no truncation)
const lastLine = fixed.split('\n').pop();
if (lastLine.trim() === '})' || lastLine.trim().startsWith('});')) {
    console.log('File ending looks OK');
} else {
    console.log('WARNING: File may be truncated, last line:', JSON.stringify(lastLine));
}

// Check for null bytes
if (fixed.indexOf('\x00') >= 0) {
    console.log('Removing null bytes...');
    fixed = fixed.split('\x00').join('');
}

// Remove any trailing null bytes
fixed = fixed.replace(/\x00+$/, '');

// Ensure file ends with newline
if (!fixed.endsWith('\n')) {
    fixed += '\n';
}

// Syntax check
try {
    new Function('require', 'console', 'setTimeout', 'setInterval', 'Promise', 'exports', 'module', '__dirname', '__filename', fixed.replace('require("http")', '/* require */'));
    console.log('Basic syntax OK');
} catch(e) {
    console.log('Syntax check error:', e.message);
}

fs.writeFileSync('app.js', fixed, 'utf8');
console.log('Written ' + fixed.length + ' bytes to app.js');

// Verify with node -c
const { execSync } = require('child_process');
try {
    execSync('node -c app.js', { cwd: __dirname, stdio: 'pipe' });
    console.log('node -c: Syntax OK');
} catch(e) {
    console.log('node -c syntax error:', e.stderr.toString());
}
