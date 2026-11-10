async (page) => {
	const dir = '/Users/a.gaziev/src/modules/.tmp/vibe-survivors/pm/results-screen/';
	const shots = [];
	// [scenario, viewport width, tab to open (player name) or null]
	const plan = [['gold', 1280, 'Артём'], ['win', 1280, null], ['lose', 1280, 'Сергей'], ['gold', 375, null], ['win', 375, 'Артём'], ['lose', 375, null]];
	for (const [name, w, tab] of plan) {
		await page.setViewportSize({ width: w, height: w > 500 ? 900 : 812 });
		await page.evaluate(() => { document.documentElement.style.cssText = ''; document.body.style.cssText = ''; const s = document.getElementById('screen-over'); s.style.cssText = ''; });
		await page.evaluate((n) => window.__over(n), name);
		await page.waitForTimeout(800);
		if (tab) await page.locator('#over-card .res-tab', { hasText: tab }).click();
		await page.waitForTimeout(200);
		const t0 = await page.evaluate(() => { const t = performance.now(); document.querySelector('#over-card .res-tab')?.click(); return performance.now() - t; });
		// Unroll the scrolling screen so the full-page shot holds all of it.
		await page.evaluate(() => {
			document.documentElement.style.cssText = 'overflow:visible;height:auto';
			document.body.style.cssText = 'overflow:visible;height:auto';
			document.getElementById('screen-over').style.cssText = 'position:absolute;min-height:100%;height:auto;overflow:visible';
		});
		if (tab) await page.locator('#over-card .res-tab', { hasText: tab }).click();
		await page.waitForTimeout(150);
		const file = `${dir}${name}-${w}${tab ? '-tab' : ''}.png`;
		await page.screenshot({ path: file, fullPage: true });
		const hscroll = await page.evaluate(() => document.querySelector('.over-panel').scrollWidth > document.querySelector('.over-panel').clientWidth + 1 || document.documentElement.scrollWidth > window.innerWidth + 1);
		shots.push({ file, hscroll, tabMs: Math.round(t0 * 10) / 10 });
	}
	return shots;
}
