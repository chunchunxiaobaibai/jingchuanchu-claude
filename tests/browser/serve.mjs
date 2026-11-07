import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const port = Number(process.argv[3] ?? 4176);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.json': 'application/json',
  '.png': 'image/png',
};

createServer(async (request, response) => {
  const pathname = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/');
  const path = pathname === '/' ? '/index.html' : pathname;
  const file = resolve(root, '.' + path);
  if (file !== root && !file.startsWith(root + sep)) {
    response.statusCode = 403;
    response.end('forbidden');
    return;
  }
  try {
    const data = await readFile(file);
    response.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream');
    response.end(data);
  } catch {
    try {
      response.setHeader('content-type', types['.html']);
      response.end(await readFile(join(root, 'index.html')));
    } catch {
      response.statusCode = 404;
      response.end('not found');
    }
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Serving ${root} on http://127.0.0.1:${port}`);
});
