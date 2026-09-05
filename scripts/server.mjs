import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const contentTypes = { '.html':'text/html; charset=utf-8', '.mjs':'text/javascript; charset=utf-8',
  '.js':'text/javascript; charset=utf-8', '.ass':'text/plain; charset=utf-8', '.json':'application/json; charset=utf-8', '.css':'text/css; charset=utf-8' };
export async function serve(port = 0) {
  const server = createServer(async (req,res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const path = resolve(root, '.' + (pathname === '/' ? '/web/index.html' : pathname));
      if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) { res.writeHead(403); res.end(); return; }
      if (!contentTypes[extname(path)]) { res.writeHead(404); res.end(); return; }
      const bytes = await readFile(path);
      res.writeHead(200, { 'Content-Type':contentTypes[extname(path)], 'Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff' }); res.end(bytes);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(port,'127.0.0.1',resolve); });
  return server;
}
