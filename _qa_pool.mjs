export default async function run(page, ui) {
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

  await page.waitForTimeout(1500);

  const probe = await page.evaluate(() => ({
    supabase: typeof window.supabase,
    bridge: {
      read: typeof window.__oddzoneReadScore,
      start: typeof window.__oddzoneStart,
      end: typeof window.__oddzoneEnd,
      mute: typeof window.__oddzoneSetMuted,
      forceEnd: typeof window.__oddzone_forceEnd
    },
    sbHelpers: typeof window.getSB,
    reportScore: typeof window.reportScore,
    asyncStatus: typeof window.asyncStatus,
    submitMatchScore: typeof window.submitMatchScore,
    canvasPainted: (() => {
      const c = document.getElementById('game');
      if (!c || !c.width) return 'no-canvas';
      const g = c.getContext('2d');
      try {
        const d = g.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
        return `painted rgb(${d[0]},${d[1]},${d[2]})`;
      } catch (e) { return 'blocked: ' + e.message; }
    })()
  }));

  return { probe, errs };
}