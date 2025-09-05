import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// # Reason: Provide a minimal, zero-dependency static server suitable for Cloud Run/App Hosting.
// - Serves Angular build output from dist/myapp
// - Binds to 0.0.0.0:$PORT
// - SPA fallback to index.html
// - Sensible cache headers for static assets

const __filename = fileURLToPath(import.meta.url);
const __dirname = normalize(join(__filename, '..'));

const DIST_DIR = join(__dirname, 'dist', 'myapp');
const INDEX_FILE = join(DIST_DIR, 'index.html');
const PORT = Number(process.env.PORT || 8080);
const HOST = '0.0.0.0';

const MIME_MAP = new Map([
  ['.html', 'text/html; charset=UTF-8'],
  ['.css', 'text/css; charset=UTF-8'],
  ['.js', 'application/javascript; charset=UTF-8'],
  ['.mjs', 'application/javascript; charset=UTF-8'],
  ['.json', 'application/json; charset=UTF-8'],
  ['.ico', 'image/x-icon'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.svg', 'image/svg+xml; charset=UTF-8'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.eot', 'application/vnd.ms-fontobject'],
]);

function getMimeType(filePath) {
  const ext = extname(filePath).toLowerCase();
  return MIME_MAP.get(ext) || 'application/octet-stream';
}

function setCacheHeaders(res, filePath) {
  // Cache-bust index.html, long-cache everything else
  if (filePath.endsWith('/index.html') || filePath === INDEX_FILE) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } else {
    // 1 year
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}

function serveFile(res, filePath) {
  try {
    const stat = statSync(filePath);
    res.statusCode = 200;
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Type', getMimeType(filePath));
    setCacheHeaders(res, filePath);
    createReadStream(filePath).pipe(res);
  } catch (err) {
    res.statusCode = 404;
    res.end('Not Found');
  }
}

function sanitizeUrl(urlPath) {
  // Prevent path traversal
  // Normalize and ensure the path stays within DIST_DIR
  const safePath = normalize(urlPath).replace(/^\\+|\/+/, '/');
  return safePath.split('?')[0].split('#')[0];
}

const server = createServer((req, res) => {
  if (!req.url) {
    res.statusCode = 400;
    res.end('Bad Request');
    return;
  }

  const urlPath = sanitizeUrl(req.url);

  // If requesting root, serve index.html
  if (urlPath === '/' || urlPath === '') {
    serveFile(res, INDEX_FILE);
    return;
  }

  // Try to serve a static file under DIST_DIR
  const candidate = join(DIST_DIR, urlPath);
  if (existsSync(candidate) && !candidate.endsWith('/')) {
    serveFile(res, candidate);
    return;
  }

  // SPA fallback
  serveFile(res, INDEX_FILE);
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
