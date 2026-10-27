import http from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

const root = resolve('apps/shell-flutter/build/web');
if (!existsSync(resolve(root, 'index.html'))) throw new Error('Build Flutter web first with npm run build:flutter.');
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.otf': 'font/otf', '.png': 'image/png', '.ico': 'image/x-icon' };
http.createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
    let file = resolve(root, `.${pathname}`);
    if (!file.startsWith(root + sep) && file !== root) { response.writeHead(403).end(); return; }
    if (!existsSync(file) || !statSync(file).isFile()) {
      if (extname(pathname)) { response.writeHead(404).end(); return; }
      file = resolve(root, 'index.html');
    }
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(readFileSync(file));
  } catch { response.writeHead(400).end(); }
}).listen(3002, '127.0.0.1', () => console.log('Flutter demo: http://localhost:3002'));
