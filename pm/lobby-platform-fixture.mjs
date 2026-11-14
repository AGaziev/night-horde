// Test-process only: route every platform call to the isolated HTTP fixture, never the real API.
const platform = process.env.HORDE_TEST_PLATFORM_URL;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(platform ?? '')) throw new Error('Local platform fixture required');
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, options) => originalFetch(String(url).startsWith('https://vibecode.bitrix24.tech/v1/')
	? String(url).replace('https://vibecode.bitrix24.tech', platform) : url, options);

// IPC clock control belongs only to this test preload; production never imports it.
const realNow = Date.now;
let clockOffset = 0;
process.on('message', (message) => {
	if (message?.t !== 'advance-test-clock' || !Number.isSafeInteger(message.ms) || message.ms < 0) return;
	clockOffset += message.ms;
	Date.now = () => realNow() + clockOffset;
	process.send?.({ t: 'test-clock-advanced' });
});
