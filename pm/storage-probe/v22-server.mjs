// Local v22 server for the storage check: a run ends as a win 1.5 s after the start (or as a «Владыка повержен» with LORD=1).
// VIBE_APP_KEY=… [FAKE_UID=999999998] HORDE_STORAGE_PREFIX=selftest-v22/ PORT=3622 node pm/storage-probe/v22-server.mjs
import http from 'node:http';
import { Room } from '../../app/server/game.js';
// FAKE_UID=… stands in for the Gateway's X-Vibe-User-Id in a local browser (test only).
if (process.env.FAKE_UID) {
	const create = http.createServer;
	http.createServer = (handler) => create((req, res) => {
		req.headers['x-vibe-user-id'] = process.env.FAKE_UID;
		req.headers['x-vibe-user-name-encoded'] ??= encodeURIComponent('Тест браузер');
		handler(req, res);
	});
}
const start = Room.prototype.start;
Room.prototype.start = function () {
	start.call(this);
	setTimeout(() => {
		if (this.state !== 'play') return;
		this.time = 600;
		this.finish(true, process.env.LORD === '1' ? 2 : 1);
	}, 1500);
};
await import('../../app/server/server.js');
