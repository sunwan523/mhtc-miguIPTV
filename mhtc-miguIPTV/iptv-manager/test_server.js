const http = require('http');
const https = require('https');
const url = require('url');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

var CONFIG = {
    PORT: 45678,
    REFRESH_INTERVAL_MS: 12 * 60 * 60 * 1000,
    GROUP_NAME: '梦回唐朝',
    DATA_DIR: path.join(__dirname, 'data'),
    SOURCES_FILE: path.join(__dirname, 'data', 'sources.json')
};

var MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.m3u': 'audio/x-mpegurl'
};

var dataSources = [];
var cache = { channels: [], categories: [], lastUpdated: null, error: null };
var savedPlaylists = {};

function ensureDir() {
    try { fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true }); } catch(e) {}
}

// ===== 数据源管理 =====
function loadSources() {
    ensureDir();
    try {
        var raw = fs.readFileSync(CONFIG.SOURCES_FILE, 'utf8');
        dataSources = JSON.parse(raw);
        console.log('已加载 ' + dataSources.length + ' 个数据源');
    } catch(e) {
        dataSources = [{ id: 'default', url: 'http://192.168.100.1:3000/', name: '默认源' }];
        saveSources();
    }
}
function saveSources() {
    ensureDir();
    try { fs.writeFileSync(CONFIG.SOURCES_FILE, JSON.stringify(dataSources, null, 2), 'utf8'); } catch(e) {
        console.error('保存数据源失败:', e.message);
    }
}

// ===== HTTP 请求 =====
function httpGet(urlStr, timeout) {
    if (!timeout) timeout = 15000;
    return new Promise(function(resolve, reject) {
        var parsedUrl = new URL(urlStr);
        var mod = parsedUrl.protocol === 'https:' ? https : http;
        var req = mod.get(urlStr, { timeout: timeout }, function(res) {
            var data = '';
            res.on('data', function(chunk) { data += chunk; });
            res.on('end', function() { resolve(data); });
        });
        req.on('error', reject);
        req.on('timeout', function() { req.destroy(); reject(new Error('timeout')); });
    });
}

// ===== M3U 解析 =====
function parseM3U(content) {
    var channels = [];
    var lines = content.split('\n');
    var cur = null;
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line || line === '#EXTM3U') continue;
        if (line.indexOf('#EXTINF:') === 0) {
            cur = { name: '', group: '未分类', tvgId: '', tvgLogo: '', tvgName: '' };
            var m;
            m = line.match(/group-title="([^"]*)"/);
            if (m) cur.group = m[1] || '未分类';
            m = line.match(/tvg-id="([^"]*)"/);
            if (m) cur.tvgId = m[1];
            m = line.match(/tvg-logo="([^"]*)"/);
            if (m) cur.tvgLogo = m[1];
            m = line.match(/tvg-name="([^"]*)"/);
            if (m) cur.tvgName = m[1];
            m = line.match(/,([^,]+)$/);
            if (m) cur.name = m[1].trim();
        } else if ((line.indexOf('http://') === 0 || line.indexOf('https://') === 0 || line.indexOf('rtmp://') === 0) && cur) {
            cur.url = line;
            channels.push(cur);
            cur = null;
        }
    }
    return channels;
}

// ===== 多源合并（按优先级去重）=====
function mergeByPriority(results) {
    var seenName = {};
    var seenUrl = {};
    var allChs = [];
    for (var i = 0; i < results.length; i++) {
        for (var j = 0; j < results[i].length; j++) {
            var ch = results[i][j];
            if (seenUrl[ch.url]) continue;
            if (seenName[ch.name]) continue;
            seenUrl[ch.url] = true;
            seenName[ch.name] = true;
            allChs.push(ch);
        }
    }
    return allChs;
}

function fetchAll() {
    if (dataSources.length === 0) {
        cache.error = '没有配置数据源';
        return Promise.resolve();
    }
    var promises = dataSources.map(function(ds) {
        console.log('[' + new Date().toISOString() + '] 获取: ' + ds.url);
        return httpGet(ds.url).then(function(content) {
            var chs = parseM3U(content);
            console.log('  来自 "' + ds.name + '": ' + chs.length + ' 频道');
            return chs;
        }).catch(function(err) {
            console.log('  来自 "' + ds.name + '" 失败: ' + err.message);
            return [];
        });
    });
    return Promise.all(promises).then(function(results) {
        var allChs = mergeByPriority(results);
        var catSet = {};
        for (var i = 0; i < allChs.length; i++) catSet[allChs[i].group] = true;
        cache = {
            channels: allChs,
            categories: Object.keys(catSet).sort(),
            lastUpdated: new Date().toISOString(),
            error: null
        };
        console.log('[' + new Date().toISOString() + '] 完成: ' + allChs.length + ' 频道, ' + cache.categories.length + ' 分类');
    }).catch(function(err) {
        cache.error = '获取失败: ' + err.message;
    });
}

// ===== M3U 生成 =====
function genM3U(channels) {
    var m3u = '#EXTM3U\n';
    for (var i = 0; i < channels.length; i++) {
        var ch = channels[i];
        m3u += '#EXTINF:-1';
        if (ch.tvgId) m3u += ' tvg-id="' + ch.tvgId + '"';
        if (ch.tvgLogo) m3u += ' tvg-logo="' + ch.tvgLogo + '"';
        if (ch.tvgName) m3u += ' tvg-name="' + ch.tvgName + '"';
        m3u += ' group-title="' + CONFIG.GROUP_NAME + '"';
        m3u += ',' + ch.name + '\n';
        m3u += ch.url + '\n';
    }
    return m3u;
}

// ===== 从当前缓存查找频道 =====
function lookupChannelsByUrls(urls) {
    var result = [];
    for (var u = 0; u < urls.length; u++) {
        for (var c = 0; c < cache.channels.length; c++) {
            if (cache.channels[c].url === urls[u]) {
                result.push(cache.channels[c]);
                break;
            }
        }
    }
    return result;
}

function countActiveChannels(urls) {
    var count = 0;
    for (var u = 0; u < urls.length; u++) {
        for (var c = 0; c < cache.channels.length; c++) {
            if (cache.channels[c].url === urls[u]) { count++; break; }
        }
    }
    return count;
}

// ===== 过滤频道 =====
function filterChs(channels, query) {
    var result = channels.slice();
    if (query.group) {
        var groups = Array.isArray(query.group) ? query.group : query.group.split(',');
        result = result.filter(function(c) { return groups.indexOf(c.group) >= 0; });
    }
    if (query.search) {
        var kw = query.search.toLowerCase().trim();
        if (kw) result = result.filter(function(c) { return c.name.toLowerCase().indexOf(kw) >= 0; });
    }
    return result;
}

// ===== 生成唯一 ID（基于名称，无时间戳后缀）=====
function generatePlaylistId(name) {
    var base = (name || '').replace(/[^a-zA-Z0-9一-鿿_-]/g, '_') || 'unnamed';
    if (!savedPlaylists[base]) return base;
    var counter = 1;
    while (savedPlaylists[base + '_' + counter]) { counter++; }
    return base + '_' + counter;
}

// ===== HTTP 工具 =====
function readBody(req) {
    return new Promise(function(resolve) {
        var body = '';
        req.on('data', function(chunk) { body += chunk; });
        req.on('end', function() { try { resolve(JSON.parse(body)); } catch(e) { resolve({}); } });
    });
}
function sendJSON(res, code, data) {
    res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(data, null, 2));
}
function sendErr(res, code, msg) { sendJSON(res, code, { success: false, error: msg }); }
function sendText(res, code, ct, text) { res.writeHead(code, { 'Content-Type': ct }); res.end(text); }

function serveStatic(res, filePath) {
    fs.readFile(filePath, function(err, data) {
        if (err) {
            if (err.code === 'ENOENT') {
                fs.readFile(path.join(__dirname, 'public', 'index.html'), function(err2, data2) {
                    if (err2) sendText(res, 404, 'text/plain', '404');
                    else { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(data2); }
                });
            } else { sendText(res, 404, 'text/plain', '404'); }
        } else {
            var ext = path.extname(filePath).toLowerCase();
            res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
            res.end(data);
        }
    });
}

// ===== 构造播放列表响应对象 =====
function playlistResponse(id, pl) {
    var active = countActiveChannels(pl.urls);
    return {
        id: id,
        name: pl.name,
        urls: pl.urls ? pl.urls.slice() : [],
        channelCount: pl.urls.length,
        activeCount: active,
        url: '/playlist/' + id + '.m3u',
        createdAt: pl.createdAt
    };
}

// ===== 主路由 =====
function handleRequest(req, res) {
    var u = url.parse(req.url, true);
    var p = u.pathname;
    var q = u.query;
    var m = req.method.toUpperCase();

    if (m === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        return res.end();
    }

    // ---- 状态 ----
    if (p === '/api/status' && m === 'GET') {
        return sendJSON(res, 200, {
            totalChannels: cache.channels.length,
            totalCategories: cache.categories.length,
            lastUpdated: cache.lastUpdated,
            error: cache.error,
            sources: dataSources.map(function(s) { return { id: s.id, url: s.url, name: s.name }; })
        });
    }

    // ---- 数据源 ----
    if (p === '/api/sources' && m === 'GET') { return sendJSON(res, 200, { sources: dataSources }); }

    if (p === '/api/sources' && m === 'POST') {
        return readBody(req).then(function(body) {
            if (!body.url) return sendErr(res, 400, '请提供 URL');
            var id = 'src_' + Date.now();
            dataSources.push({ id: id, url: body.url, name: body.name || body.url });
            saveSources();
            sendJSON(res, 200, { success: true, sources: dataSources });
        });
    }

    if (p.indexOf('/api/sources/') === 0 && m === 'DELETE') {
        var sid = decodeURIComponent(p.replace('/api/sources/', ''));
        var idx = -1;
        for (var i = 0; i < dataSources.length; i++) {
            if (dataSources[i].id === sid) { idx = i; break; }
        }
        if (idx < 0) return sendErr(res, 404, '数据源未找到');
        dataSources.splice(idx, 1);
        saveSources();
        return sendJSON(res, 200, { success: true, sources: dataSources });
    }

    // ---- 分类 ----
    if (p === '/api/categories' && m === 'GET') {
        return sendJSON(res, 200, { categories: cache.categories, lastUpdated: cache.lastUpdated });
    }

    // ---- 频道 ----
    if (p === '/api/channels' && m === 'GET') {
        var result = filterChs(cache.channels, q);
        return sendJSON(res, 200, {
            total: cache.channels.length,
            filtered: result.length,
            channels: result,
            categories: cache.categories,
            lastUpdated: cache.lastUpdated,
            error: cache.error
        });
    }

    // ---- 刷新 ----
    if (p === '/api/refresh' && m === 'POST') {
        fetchAll().then(function() {
            sendJSON(res, 200, { success: true, totalChannels: cache.channels.length, lastUpdated: cache.lastUpdated, error: cache.error });
        });
        return;
    }

    // ---- 保存播放列表（只存 URL 列表）----
    if (p === '/api/playlist' && m === 'POST') {
        return readBody(req).then(function(body) {
            var result = cache.channels.slice();
            if (body.urls && Array.isArray(body.urls) && body.urls.length > 0) {
                result = result.filter(function(c) { return body.urls.indexOf(c.url) >= 0; });
            } else {
                if (body.groups && body.groups.length > 0) {
                    result = result.filter(function(c) { return body.groups.indexOf(c.group) >= 0; });
                }
                if (body.search && body.search.trim()) {
                    var kw = body.search.toLowerCase().trim();
                    result = result.filter(function(c) { return c.name.toLowerCase().indexOf(kw) >= 0; });
                }
            }
            if (result.length === 0) return sendErr(res, 400, '没有匹配的频道');

            var id = generatePlaylistId(body.name || '未命名列表');
            var storedUrls = result.map(function(c) { return c.url; });

            savedPlaylists[id] = {
                name: body.name || id,
                urls: storedUrls,
                channelCount: result.length,
                createdAt: new Date().toISOString()
            };
            sendJSON(res, 200, { success: true, id: id, name: body.name || id, url: '/playlist/' + id + '.m3u', channelCount: result.length });
        });
    }

    // ---- 获取单个播放列表详情 ----
    if (p.indexOf('/api/playlist/') === 0 && m === 'GET') {
        var getId = decodeURIComponent(p.substring('/api/playlist/'.length));
        if (getId && savedPlaylists[getId]) {
            return sendJSON(res, 200, playlistResponse(getId, savedPlaylists[getId]));
        }
        return sendErr(res, 404, '播放列表未找到');
    }

    // ---- 更新播放列表（编辑）----
    if (p.indexOf('/api/playlist/') === 0 && m === 'PUT') {
        var putId = decodeURIComponent(p.substring('/api/playlist/'.length));
        if (!putId || !savedPlaylists[putId]) return sendErr(res, 404, '播放列表未找到');
        return readBody(req).then(function(body) {
            var pl = savedPlaylists[putId];
            if (body.name) pl.name = body.name;
            if (body.urls && Array.isArray(body.urls)) {
                pl.urls = body.urls;
                pl.channelCount = body.urls.length;
            }
            // 如果改了名称，可能同时需要更新 ID
            sendJSON(res, 200, { success: true, id: putId, name: pl.name, url: '/playlist/' + putId + '.m3u', channelCount: pl.channelCount });
        });
    }

    // ---- 列出所有播放列表 ----
    if (p === '/api/playlists' && m === 'GET') {
        var list = Object.keys(savedPlaylists).map(function(k) {
            return playlistResponse(k, savedPlaylists[k]);
        });
        return sendJSON(res, 200, { playlists: list });
    }

    // ---- 删除播放列表 ----
    if (m === 'DELETE' && p.indexOf('/api/playlist/') === 0) {
        var delId = decodeURIComponent(p.substring('/api/playlist/'.length));
        if (delId && savedPlaylists[delId]) {
            delete savedPlaylists[delId];
            console.log('已删除: ' + delId);
            return sendJSON(res, 200, { success: true });
        }
        return sendErr(res, 404, '播放列表未找到');
    }

    // ---- 动态 playlist.m3u ----
    if (p === '/playlist.m3u' && m === 'GET') {
        var res2 = filterChs(cache.channels, q);
        if (res2.length === 0) return sendText(res, 404, 'text/plain; charset=utf-8', '无匹配频道');
        res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl', 'Content-Disposition': 'attachment; filename="playlist.m3u"' });
        return res.end(genM3U(res2));
    }

    // ---- 已保存播放列表（实时生成 M3U）----
    var plMatch = p.match(/^\/playlist\/(.+)\.m3u$/);
    if (plMatch && m === 'GET') {
        var plId = decodeURIComponent(plMatch[1]);
        var pl = savedPlaylists[plId];
        if (!pl) return sendText(res, 404, 'text/plain; charset=utf-8', '播放列表未找到');
        var channels = lookupChannelsByUrls(pl.urls);
        res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl', 'Content-Disposition': 'attachment; filename="playlist.m3u"' });
        return res.end(genM3U(channels));
    }

    if (p.indexOf('/api/') === 0) return sendErr(res, 404, 'API 未找到');

    var safe = p === '/' ? 'index.html' : p.replace(/^\//, '');
    var fp = path.resolve(__dirname, 'public', safe);
    if (fp.indexOf(path.resolve(__dirname, 'public')) !== 0) return sendText(res, 403, 'text/plain', 'Forbidden');
    serveStatic(res, fp);
}

// ===== 启动 =====
loadSources();
// Test data injection
cache = {
    channels: [
        { name: 'CCTV-1 综合', url: 'http://192.168.100.1:3000/cctv1.m3u8', group: '央视', tvgId: 'cctv1', tvgLogo: '', tvgName: '' },
        { name: 'CCTV-2 财经', url: 'http://192.168.100.1:3000/cctv2.m3u8', group: '央视', tvgId: 'cctv2', tvgLogo: '', tvgName: '' },
        { name: 'CCTV-3 综艺', url: 'http://192.168.100.1:3000/cctv3.m3u8', group: '央视', tvgId: 'cctv3', tvgLogo: '', tvgName: '' },
        { name: '湖南卫视', url: 'http://192.168.100.1:3000/hunantv.m3u8', group: '卫视', tvgId: 'hunantv', tvgLogo: '', tvgName: '' },
        { name: '江苏卫视', url: 'http://192.168.100.1:3000/jiangsu.m3u8', group: '卫视', tvgId: 'jiangsu', tvgLogo: '', tvgName: '' }
    ],
    categories: ['央视', '卫视'],
    lastUpdated: new Date().toISOString(),
    error: null
};
console.log('注入测试数据: ' + cache.channels.length + ' 频道');
console.log('测试模式启动');

// 测试模式：禁用定时刷新
console.log('定时刷新已禁用（测试模式）');

var server = http.createServer(handleRequest);
server.listen(CONFIG.PORT, '0.0.0.0', function() {
    console.log('IPTV 管理器 v3.1');
    console.log('端口: ' + CONFIG.PORT);
    console.log('页面: http://localhost:' + CONFIG.PORT);
    console.log('分组: ' + CONFIG.GROUP_NAME);
    console.log('播放列表: 支持编辑修改');
});
