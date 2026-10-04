import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import pg from 'pg';
import {createOfficialHandler} from '../api/official.mjs';

const token = process.env.RULECRAFT_GATEWAY_TOKEN;
if (!token || token.length < 32) throw new Error('Gateway credential required');
const handler = createOfficialHandler({createPool(options) {
  if (options.host !== '127.0.0.1') throw new Error('Local database required');
  return new pg.Pool({...options, ssl:false});
}});
http.createServer(async (req,res) => {
  const supplied = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${token}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied,expected)) {
    res.writeHead(401,{'Content-Type':'application/json'});res.end('{"code":"unauthorized"}');return;
  }
  const url = new URL(req.url,'http://localhost');
  if (!/^\/api\/official\/(status|laws|document)$/.test(url.pathname)) {
    res.writeHead(404);res.end();return;
  }
  req.query = {route:url.pathname.split('/').pop()};
  try {await handler(req,res);} catch {res.writeHead(503);res.end('{"code":"gateway_unavailable"}');}
}).listen(8766,'127.0.0.1');
