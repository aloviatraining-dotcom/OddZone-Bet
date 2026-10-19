const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.wav': 'audio/wav', '.woff': 'font/woff', '.fbx': 'application/octet-stream' };
http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/') u = '/index.html';
  const f = path.join(ROOT, u);
  fs.stat(f, (e, st) => {
    if (e || !st.isFile()) {
      // Mirror the static host: an unmatched path serves 404.html, which the
      // build generates as a copy of index.html so the SPA shell boots.
      const fallback = path.join(ROOT, '404.html');
      fs.readFile(fallback, (fe, body) => {
        if (fe) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('nf'); return; }
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(body);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
}).listen(8123);
