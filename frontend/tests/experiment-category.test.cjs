const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const api = {};
const code = ts.transpileModule(fs.readFileSync("src/components/experimentCategory.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
vm.runInNewContext(code, { exports: api });

test("groups representative biological workflows by their primary activity", () => {
  const examples = {
    bioinformatics: ["GEO数据库筛选差异基因", "单细胞数据分析", "GO富集分析", "免疫浸润分析", "火山图", "蛋白互作网络分析"],
    cell: ["细胞共培养", "免疫细胞流式检测", "细胞基因敲除", "CCK-8", "Transwell", "条件培养基转移实验", "培养上清转移", "conditioned medium transfer"],
    animal: ["小鼠基因敲除", "动物对照实验", "裸鼠成瘤实验"],
    molecular: ["Western blot", "qPCR", "蛋白表达检测"],
    histology: ["组织病理", "HE染色", "histopathology"],
    sample: ["临床样本收集", "患者样本处理"],
    microbiology: ["细菌培养", "菌落计数"],
    pharmacology: ["药物筛选", "药代动力学"],
    metabolism: ["糖酵解检测", "脂质代谢"],
    sequencing: ["单细胞测序", "单细胞 RNA 测序", "RNA测序", "全基因组测序", "测序建库"],
    vesicle: ["外泌体分离与鉴定", "细胞外囊泡提取", "extracellular vesicle isolation"],
    biochemical: ["生化指标检测", "酶活性测定"],
    microscopy: ["共聚焦成像", "显微镜观察"],
  };
  for (const [expected, names] of Object.entries(examples)) for (const name of names) {
    assert.equal(api.effectiveCategory(name), expected, name);
  }
});

test("unrelated names do not receive a fabricated biology category", () => {
  assert.equal(api.effectiveCategory("fuel cell performance"), "generic");
  assert.equal(api.effectiveCategory("司法判例"), "generic");
  assert.equal(api.effectiveCategory("尚未指定的研究环节"), "generic");
  assert.equal(api.effectiveCategory("患者 MRI 检查"), "imaging");
  assert.equal(api.effectiveCategory("单细胞微流控液滴捕获"), "microfluidic");
  assert.equal(api.effectiveCategory("条件培养基转移实验", "constraint"), "cell");
  assert.equal(api.effectiveCategory("培养条件优化"), "generic");
});

test("legacy saved biological illustration choices remain meaningful", () => {
  assert.equal(api.effectiveCategory("蛋白检测", "protein"), "molecular");
  assert.equal(api.effectiveCategory("通路富集", "pathway"), "bioinformatics");
  assert.equal(api.effectiveCategory("未识别", "education"), "generic");
});

test("every current category has a positioned and available illustration", () => {
  const css = fs.readFileSync("src/components/experiment-route.css", "utf8");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)];
  for (const [category] of api.CATEGORY_OPTIONS) {
    const selector = `.er-illustration-${category}`;
    assert.ok(rules.some(([, selectors, body]) => selectors.split(",").some(s => s.trim() === selector) && /background-position/.test(body)), `${category}: no position`);
    const images = rules.filter(([, selectors, body]) => selectors.split(",").some(s => s.trim() === selector) && /background-image/.test(body));
    assert.ok(images.length || ["analysis"].includes(category), `${category}: no image sheet`);
    const rule = images.at(-1);
    const image = rule?.[2].match(/url\('([^']+)'\)/)?.[1] || "/research-elements/editorial-v2.png";
    assert.ok(fs.existsSync(`public${image}`), `${category}: missing ${image}`);
  }
});
