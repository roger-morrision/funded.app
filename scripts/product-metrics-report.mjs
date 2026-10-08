import { readFile } from 'node:fs/promises';

const url = new URL(process.argv[2] || 'http://127.0.0.1:8788');
if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
  || !(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1','localhost'].includes(url.hostname))) {
  throw new Error('Pass an HTTPS app origin or a local HTTP origin.');
}
const token = process.env.FUNDED_API_TOKEN || (process.env.FUNDED_API_TOKEN_FILE ? (await readFile(process.env.FUNDED_API_TOKEN_FILE,'utf8')).trim() : '');
if (!token) throw new Error('Provide FUNDED_API_TOKEN or FUNDED_API_TOKEN_FILE in the operator environment.');
const response = await fetch(new URL('/api/product-metrics',url),{headers:{authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
if (!response.ok) throw new Error(`Product report unavailable (HTTP ${response.status}).`);
console.log(JSON.stringify(await response.json(),null,2));
