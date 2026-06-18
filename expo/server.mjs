import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, resolve } from 'node:path';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST_DIR = resolve(join(__dirname, 'dist'));
const PORT = parseInt(process.env.PORT || '8080', 10);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.map': 'application/json',
};

const CACHE_TTL = {
  html: 0,
  js: 31536000,
  css: 31536000,
  font: 31536000,
  image: 604800,
  media: 604800,
  default: 86400,
};

function getCacheTTL(ext) {
  if (ext === '.html') return CACHE_TTL.html;
  if (['.js', '.mjs'].includes(ext)) return CACHE_TTL.js;
  if (ext === '.css') return CACHE_TTL.css;
  if (['.woff', '.woff2', '.ttf', '.eot', '.otf'].includes(ext)) return CACHE_TTL.font;
  if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp'].includes(ext)) return CACHE_TTL.image;
  if (['.mp4', '.webm'].includes(ext)) return CACHE_TTL.media;
  return CACHE_TTL.default;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Vary': 'Origin',
};

function isSafePath(requestPath) {
  const normalized = normalize(requestPath);
  return !normalized.includes('..');
}

async function serveStaticFile(res, filePath) {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) return false;

    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const cacheTTL = getCacheTTL(ext);

    const headers = {
      'Content-Type': contentType,
      'Content-Length': String(stats.size),
      'Cache-Control': cacheTTL === 0
        ? 'no-cache, no-store, must-revalidate'
        : `public, max-age=${cacheTTL}, immutable`,
      ...corsHeaders,
    };

    res.writeHead(200, headers);

    const stream = createReadStream(filePath);
    stream.pipe(res);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Stream error');
      }
    });

    return true;
  } catch {
    return false;
  }
}

async function serveFallback(res) {
  const indexPath = join(DIST_DIR, 'index.html');
  try {
    const content = await readFile(indexPath, 'utf-8');
    const headers = {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      ...corsHeaders,
    };
    res.writeHead(200, headers);
    res.end(content);
  } catch {
    res.writeHead(503, { 'Content-Type': 'text/plain', ...corsHeaders });
    res.end('App not built. Deploy in progress...');
  }
}

async function healthCheck(res) {
  // Self-contained health check — no external dependencies
  const indexPath = join(DIST_DIR, 'index.html');
  let indexOk = false;
  try {
    await stat(indexPath);
    indexOk = true;
  } catch {
    // index.html not built yet — app is deploying
  }

  const healthy = indexOk;
  const status = healthy ? 200 : 503;
  const body = JSON.stringify({
    status: healthy ? 'healthy' : 'deploying',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    },
    distExists: indexOk,
  });

  res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders });
  res.end(body);
}

function requestHandler(req, res) {
  const requestStart = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - requestStart;
    if (process.env.NODE_ENV !== 'production' || duration > 1000) {
      console.log(`${req.method} ${req.url} ${res.statusCode} ${duration}ms`);
    }
  });

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // Health check
  if (pathname === '/health' || pathname === '/healthz') {
    healthCheck(res);
    return;
  }

  // Only allow GET and HEAD
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain', ...corsHeaders });
    res.end('Method Not Allowed');
    return;
  }

  // Security: block path traversal
  if (!isSafePath(pathname)) {
    res.writeHead(400, { 'Content-Type': 'text/plain', ...corsHeaders });
    res.end('Bad Request');
    return;
  }

  // Try to serve exact file
  const cleanPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = join(DIST_DIR, cleanPath);

  serveStaticFile(req.method === 'HEAD' ? { ...res, end: () => { res.end(); return res; } } : res, filePath)
    .then(served => {
      if (!served) {
        // SPA fallback — serve index.html for all non-file routes
        serveFallback(res);
      }
    })
    .catch(() => {
      serveFallback(res);
    });
}

const server = createServer(requestHandler);

process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('[Server] Closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.log('[Server] Force exit after timeout');
    process.exit(1);
  }, 10000);
});

process.on('SIGINT', () => {
  console.log('[Server] SIGINT received, shutting down...');
  server.close(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception:', err.message);
  // Don't crash — Railway will restart if needed
});

process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled rejection:', reason);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[DevAI Studio] Server running on port ${PORT}`);
  console.log(`[DevAI Studio] Serving static files from: ${DIST_DIR}`);
  console.log(`[DevAI Studio] Health check: http://0.0.0.0:${PORT}/health`);
});
