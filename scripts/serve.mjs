import { serve } from './server.mjs';
const port = Number(process.env.PORT ?? 8000);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
const server = await serve(port);
console.log(`Asslang playground: http://127.0.0.1:${server.address().port}`);
