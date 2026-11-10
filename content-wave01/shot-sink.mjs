// Test-only: saves POSTed data URLs as shots/<name>.jpg (name from the query string).
import http from 'node:http';
import fs from 'node:fs';
http.createServer((req, res) => {
	let body = '';
	req.on('data', (c) => (body += c));
	req.on('end', () => {
		const name = (new URL(req.url, 'http://x').searchParams.get('n') || 'shot').replace(/[^a-z0-9-]/gi, '');
		const b64 = body.replace(/^data:image\/\w+;base64,/, '');
		fs.writeFileSync(new URL(`./shots/${name}.jpg`, import.meta.url), Buffer.from(b64, 'base64'));
		res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
		res.end();
	});
}).listen(3784, '127.0.0.1');
