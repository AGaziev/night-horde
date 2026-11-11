import fs from 'node:fs';

const KEEP_FEEDBACK = 500;

export function readFeedback(file) {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch (e) {
		if (e.code === 'ENOENT') return [];
		throw e;
	}
}

export function saveFeedback(file, row) {
	const rows = readFeedback(file);
	rows.push(row);
	const tmp = file + '.tmp';
	try {
		fs.writeFileSync(tmp, JSON.stringify(rows.slice(-KEEP_FEEDBACK)), { mode: 0o600, flush: true });
		fs.renameSync(tmp, file);
	} finally {
		fs.rmSync(tmp, { force: true });
	}
}
