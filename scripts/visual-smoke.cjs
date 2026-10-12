const { chromium } = require("playwright");
const baseUrl = process.env.VISUAL_BASE_URL || "http://127.0.0.1:3000";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await page.screenshot({ path: "docs/home-visual-check.png", fullPage: true });
  if (await page.locator(".card").count() !== 4) throw new Error("首页入口数量错误");

  await page.goto(`${baseUrl}/discover`, { waitUntil: "networkidle" });
  await page.getByLabel("论文检索").fill("rotator cuff tear mitochondrial dysfunction");
  await page.getByRole("button", { name: "检索论文" }).click();
  await page.locator(".workCard").first().waitFor({ timeout: 15000 });
  await page.locator(".workMore summary").first().click();
  if (!(await page.locator(".workMore[open] .workActions").count())) throw new Error("论文次要操作未展开");
  await page.locator(".workMore summary").first().click();
  await page.getByRole("button", { name: /浏览文献关系/ }).first().click();
  await page.locator(".bubbleThreeStage canvas").waitFor({ timeout: 15000 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".networkArrival")).visibility === "hidden");
  await page.screenshot({ path: "docs/network-visual-check.png", fullPage: true });
  const cards = await page.locator(".graphCounts b").allTextContents();
  if (cards.reduce((sum, value) => sum + Number(value), 0) === 0) throw new Error("关系图没有可点击文献");
  const firstPaper = await page.locator(".networkFoot select option:nth-child(2)").getAttribute("value");
  if (!firstPaper) throw new Error("关系图缺少可选择的论文");
  await page.getByLabel("按标题选择关系图中的论文").selectOption(firstPaper);
  if (!(await page.locator(".bubbleSelection").count())) throw new Error("选中文献没有即时反馈");
  await page.locator(".bubbleThreeStage canvas").evaluate((canvas) => canvas.setAttribute("data-switch-probe", "same"));
  await page.getByRole("button", { name: "以这篇论文为中心展开" }).click();
  await page.waitForFunction((id) => document.querySelector(".networkFoot select")?.value !== id && !document.querySelector(".graphLoading"), firstPaper, { timeout: 30000 });
  if (await page.locator(".bubbleThreeStage canvas").getAttribute("data-switch-probe") !== "same") throw new Error("切换中心论文时重新创建了三维画布");
  if (!(await page.locator(".networkArrival").count())) throw new Error("切换中心论文缺少入场反馈");
  await page.getByRole("button", { name: "重置视角与位置" }).click();

  for (const route of ["read", "synthesis", "design"]) {
    await page.goto(`${baseUrl}/${route}`, { waitUntil: "networkidle" });
    await page.screenshot({ path: `docs/${route}-visual-check.png`, fullPage: false });
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)) throw new Error(`${route} 页面横向溢出`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await page.screenshot({ path: "docs/home-mobile-visual-check.png", fullPage: true });
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)) throw new Error("移动端首页横向溢出");
  await page.goto(`${baseUrl}/discover`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "关系图谱" }).click();
  await page.locator(".bubbleThreeStage canvas").waitFor({ timeout: 15000 });
  await page.screenshot({ path: "docs/network-mobile-visual-check.png", fullPage: true });
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)) throw new Error("移动端关系图横向溢出");
  if (errors.length) throw new Error(`浏览器脚本错误：${errors.join(" | ")}`);
  console.log(`视觉冒烟检查通过：首页 4 入口，图谱 ${cards.join("+")} 篇关联文献，移动端宽度正常`);
  await browser.close();
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
