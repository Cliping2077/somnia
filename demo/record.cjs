const path = require('node:path')
const fs = require('node:fs')
const { chromium } = require('C:\\Users\\陈佳宏\\Documents\\deepseek-harness\\default-workspace\\dsh-browser-use\\node_modules\\playwright-core')

const dir = __dirname
const outDir = path.join(dir, 'recordings')
fs.mkdirSync(outDir, { recursive: true })

;(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--force-device-scale-factor=1', '--hide-scrollbars'],
  })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: outDir, size: { width: 1280, height: 720 } },
  })
  const page = await context.newPage()
  await page.goto('file://' + path.join(dir, 'demo.html').replace(/\\/g, '/'))
  await page.waitForTimeout(32000)
  await context.close()
  await browser.close()
  const files = fs.readdirSync(outDir).filter((f) => f.endsWith('.webm'))
  console.log('webm=' + files.map((f) => path.join(outDir, f)).join(','))
})()
