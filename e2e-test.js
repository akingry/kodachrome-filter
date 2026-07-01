const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

async function main() {
  const target = process.argv[2] || 'http://127.0.0.1:8087/';
  const imgPath = path.resolve(__dirname, 'test-upload.svg');
  fs.writeFileSync(imgPath, `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420">
    <defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#2f6db3"/><stop offset="0.5" stop-color="#f4c35a"/><stop offset="1" stop-color="#b33d28"/></linearGradient></defs>
    <rect width="640" height="420" fill="url(#g)"/>
    <circle cx="180" cy="160" r="90" fill="#f7dfb0" opacity=".8"/>
    <rect x="340" y="90" width="180" height="240" fill="#194d30" opacity=".85"/>
  </svg>`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const logs = [];
  page.on('console', msg => logs.push(`${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => logs.push(`pageerror: ${err.message}`));
  await page.goto(target, { waitUntil: 'networkidle', timeout: 60000 });
  await page.setInputFiles('#fileInput', imgPath);
  await page.waitForSelector('.card img', { timeout: 15000 });
  await page.waitForFunction(() => {
    const img = document.querySelector('.card img');
    return img && img.complete && img.naturalWidth > 0;
  }, null, { timeout: 15000 });
  await page.waitForFunction(() => {
    const before = document.querySelector('#beforeCanvas');
    return before && before.width > 0 && before.height > 0;
  }, null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('Preview rendered'), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const after = document.querySelector('#afterCanvas');
    return after && after.width > 0 && after.height > 0;
  }, null, { timeout: 15000 });

  const result = await page.evaluate(() => {
    const img = document.querySelector('.card img');
    const before = document.querySelector('#beforeCanvas');
    const after = document.querySelector('#afterCanvas');
    const status = document.querySelector('#status')?.textContent || '';
    function diffCanvases(a, b) {
      const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
      const ca = a.getContext('2d').getImageData(0,0,w,h).data;
      const cb = b.getContext('2d').getImageData(0,0,w,h).data;
      let sum = 0;
      for (let i=0;i<ca.length;i+=4) sum += Math.abs(ca[i]-cb[i]) + Math.abs(ca[i+1]-cb[i+1]) + Math.abs(ca[i+2]-cb[i+2]);
      return sum / (w*h*3);
    }
    return {
      status,
      cardCount: document.querySelectorAll('.card').length,
      thumbNaturalWidth: img?.naturalWidth || 0,
      before: { width: before?.width || 0, height: before?.height || 0 },
      after: { width: after?.width || 0, height: after?.height || 0 },
      diff: diffCanvases(before, after),
      downloadEnabled: !document.querySelector('#downloadSelected')?.disabled,
    };
  });
  await page.screenshot({ path: path.resolve(__dirname, 'e2e-screenshot.png'), fullPage: true });
  await browser.close();
  console.log(JSON.stringify({ target, result, logs }, null, 2));
  if (!result.cardCount || !result.thumbNaturalWidth || !result.before.width || !result.after.width || result.diff <= 0.1 || !result.downloadEnabled) {
    process.exitCode = 1;
  }
}
main().catch(err => { console.error(err); process.exit(1); });
