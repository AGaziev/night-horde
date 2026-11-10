async (page) => {
	const GEN = '/Users/a.gaziev/src/modules/.tmp/vibe-survivors/client-scratch/results-gen/';
	await page.route('**/__gen/*', (route) => route.fulfill({ path: GEN + route.request().url().split('/__gen/')[1], contentType: 'application/json' }));
	await page.addInitScript(() => {
		// Strictly no sound: no AudioContext at all, media elements muted.
		window.AudioContext = undefined;
		window.webkitAudioContext = undefined;
		HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
		const WS = window.WebSocket;
		window.__ws = [];
		window.WebSocket = class extends WS {
			constructor(...a) {
				super(...a);
				window.__ws.push(this);
				this.addEventListener('message', (ev) => {
					try { const m = JSON.parse(ev.data); if (m.t === 'welcome') window.__me = m.pid; } catch {}
				});
			}
		};
		// Fire a generated `over` as if the server sent it: player 1 becomes «me».
		window.__over = async (name) => {
			const o = await (await fetch('/__gen/over-' + name + '.json')).json();
			const me = window.__me;
			const swap = (x) => (x === 1 ? me : x);
			for (const s of o.stats) s.pid = swap(s.pid);
			o.card.players.forEach((p) => (p.pid = swap(p.pid)));
			o.card.awards.forEach((a) => (a.pid = swap(a.pid)));
			if (o.fin?.by) o.fin.by.forEach((b) => (b.pid = swap(b.pid)));
			o.runId = o.card.id + name.slice(0, 1).toUpperCase();
			const ws = window.__ws.at(-1);
			ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(o) }));
			return [me, o.grade];
		};
	});
	await page.goto('http://localhost:3917/');
	await page.waitForFunction(() => window.__me !== undefined, null, { timeout: 15000 });
	return await page.evaluate(() => window.__me);
}
