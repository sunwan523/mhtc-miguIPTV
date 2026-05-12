const fs = require('fs');
const content = fs.readFileSync('app.js', 'utf8');

// Replace the startup section to inject test data
const startup = 'loadSources();\nfetchAll().then(function() {\n    if (cache.error) console.log(\'离线模式启动\');\n}).catch(function() {});';

const replacement = 'loadSources();\n' +
'// Test data injection\n' +
'cache = {\n' +
'    channels: [\n' +
'        { name: \'CCTV-1 综合\', url: \'http://192.168.100.1:3000/cctv1.m3u8\', group: \'央视\', tvgId: \'cctv1\', tvgLogo: \'\', tvgName: \'\' },\n' +
'        { name: \'CCTV-2 财经\', url: \'http://192.168.100.1:3000/cctv2.m3u8\', group: \'央视\', tvgId: \'cctv2\', tvgLogo: \'\', tvgName: \'\' },\n' +
'        { name: \'CCTV-3 综艺\', url: \'http://192.168.100.1:3000/cctv3.m3u8\', group: \'央视\', tvgId: \'cctv3\', tvgLogo: \'\', tvgName: \'\' },\n' +
'        { name: \'湖南卫视\', url: \'http://192.168.100.1:3000/hunantv.m3u8\', group: \'卫视\', tvgId: \'hunantv\', tvgLogo: \'\', tvgName: \'\' },\n' +
'        { name: \'江苏卫视\', url: \'http://192.168.100.1:3000/jiangsu.m3u8\', group: \'卫视\', tvgId: \'jiangsu\', tvgLogo: \'\', tvgName: \'\' }\n' +
'    ],\n' +
'    categories: [\'央视\', \'卫视\'],\n' +
'    lastUpdated: new Date().toISOString(),\n' +
'    error: null\n' +
'};\n' +
'console.log(\'注入测试数据: \' + cache.channels.length + \' 频道\');\n' +
'console.log(\'测试模式启动\');';

if (content.indexOf(startup) < 0) {
    console.log('ERROR: Could not find startup pattern in app.js');
    console.log('First match attempt...');
    // Find the actual text
    const idx = content.indexOf('loadSources()');
    if (idx >= 0) {
        console.log('Found loadSources at', idx);
        console.log('Snippet:', JSON.stringify(content.substring(idx, idx + 150)));
    }
    process.exit(1);
}

const testCode = content.replace(startup, replacement);

// Remove background refresh
const intervalPattern = 'setInterval(function() {\n    console.log(\'[\' + new Date().toISOString() + \'] 定时刷新...\');\n    fetchAll();\n}, CONFIG.REFRESH_INTERVAL_MS);';
const intervalReplacement = '// 测试模式：禁用定时刷新\nconsole.log(\'定时刷新已禁用（测试模式）\');';

const finalCode = testCode.replace(intervalPattern, intervalReplacement);

fs.writeFileSync('test_server.js', finalCode, 'utf8');
console.log('Test server written, syntax check:');

// Verify syntax
try {
    require('child_process').execSync('node -c test_server.js', { cwd: __dirname });
    console.log('Syntax OK');
} catch(e) {
    console.log('Syntax error:', e.message);
}
