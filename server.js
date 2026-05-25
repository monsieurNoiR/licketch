const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3443;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

const options = {
  key:  fs.readFileSync(path.join(ROOT, 'key.pem')),
  cert: fs.readFileSync(path.join(ROOT, 'cert.pem')),
};

const server = https.createServer(options, (req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(ROOT, urlPath);

  // Prevent path traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nLicketch HTTPS server running`);
  console.log(`  Local:  https://localhost:${PORT}`);
  console.log(`  iPad:   https://192.168.1.7:${PORT}\n`);
});
