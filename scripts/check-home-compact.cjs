const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({headless: true});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('medread-intro-acknowledged-v4', '1'));
  for (const width of [1440, 390]) {
    await page.setViewportSize({width, height: 900});
    await page.goto(process.env.VISUAL_BASE_URL || 'http://127.0.0.1:3011', {waitUntil: 'networkidle'});
    if (await page.locator('.home-project-badge, .home-kicker').count()) throw Error('Hero banner still present');
    const metrics = await page.locator('.home-hero-actions').evaluate(el => {
      const buttons = [...el.children].map(x => x.getBoundingClientRect());
      return {gap: getComputedStyle(el.children[0]).gap, widths: buttons.map(x => x.width),
        overflow: document.documentElement.scrollWidth > innerWidth};
    });
    if (metrics.overflow || metrics.gap !== '18px' || metrics.widths.some(w => w > 220)) throw Error(JSON.stringify(metrics));
    await page.screenshot({path: `docs/home-compact-${width}.png`, fullPage: false});
    console.log(width, metrics);
  }
  await browser.close();
  if (errors.length) throw Error(errors.join('\n'));
})().catch(e => {console.error(e); process.exit(1);});
