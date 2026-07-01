const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

async function main() {
  const target = process.argv[2] || 'http://127.0.0.1:8087/';
  const badPath = path.resolve(__dirname, 'fake-photo.heic');
  fs.writeFileSync(badPath, Buffer.from('not a real heic image'));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const logs = [];
  page.on('console', msg => logs.push(`${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => logs.push(`pageerror: ${err.message}`));
  await page.goto(target, { waitUntil: 'networkidle', timeout: 60000 });
  await page.setInputFiles('#fileInput', { name: 'fake-photo.heic', mimeType: 'image/heic', buffer: fs.readFileSync(badPath) });
  await page.waitForSelector('.card img', { timeout: 15000 });
  await page.waitForFunction(() => {
    const img = document.querySelector('.card img');
    return img && img.complete && img.naturalWidth > 0;
  }, null, { timeout: 15000 });
  const result = await page.evaluate(() => ({
    status: document.querySelector('#status')?.textContent || '',
    cardCount: document.querySelectorAll('.card').length,
    thumbNaturalWidth: document.querySelector('.card img')?.naturalWidth || 0,
    badge: document.querySelector('.badge')?.textContent || '',
    previewTitle: document.querySelector('#previewTitle')?.textContent || '',
    previewMeta: document.querySelector('#previewMeta')?.textContent || '',
    processDisabled: document.querySelector('#processSelected')?.disabled,
  }));
  await page.screenshot({ path: path.resolve(__dirname, 'e2e-invalid-screenshot.png'), fullPage: true });
  await browser.close();
  console.log(JSON.stringify({ target, result, logs }, null, 2));
  if (!result.cardCount || !result.thumbNaturalWidth || result.badge !== 'Error' || result.previewMeta !== 'Cannot load' || result.processDisabled !== true) {
    process.exitCode = 1;
  }
}
main().catch(err => { console.error(err); process.exit(1); });
