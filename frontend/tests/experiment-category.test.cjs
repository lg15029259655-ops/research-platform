const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const exportsForTest = {};
const code = ts.transpileModule(fs.readFileSync("src/components/experimentCategory.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
vm.runInNewContext(code, { exports: exportsForTest });
const classify = exportsForTest.experimentCategory;
const effective = exportsForTest.effectiveCategory;

test("common experiments consistently map to their broad research category", () => {
  const examples = {
    cell: ["单细胞聚类与注释", "细胞增殖实验", "细胞凋亡", "流式细胞术"],
    protein: ["关键通路蛋白表达快速检测", "Western blot", "免疫组化"],
    metabolism: ["脂质代谢表型初筛", "糖酵解检测", "metabolomics"],
    gene: ["基因敲除", "siRNA knockdown", "qPCR"],
    microfluidic: ["微流控液滴生成与捕获", "microfluidic droplet assay"],
    analysis: ["热图", "火山图", "PCA 降维", "跨模态关联分析"],
    database: ["GEO 数据库", "TCGA 数据集"],
    animal: ["小鼠成瘤实验", "animal model"],
    clinical: ["随机对照临床试验", "病例对照研究", "clinical trial"],
    imaging: ["患者 MRI 检查", "医学影像分析", "CT 扫描"],
    materials: ["电池材料力学性能测试", "合金拉伸实验", "ceramic materials"],
    device: ["传感器原型机测试", "电路设计", "hardware prototype"],
    simulation: ["有限元仿真", "流体数值模拟", "computational model"],
    survey: ["问卷调查", "questionnaire survey"],
    interview: ["半结构化访谈", "焦点小组", "qualitative interview"],
    archive: ["历史档案研究", "话语分析", "textual analysis"],
    chemistry: ["有机合成", "色谱分析", "chemical reaction"],
    software: ["机器学习算法训练", "software development"],
    education: ["课堂教学干预", "educational intervention"],
    baseline: ["研究设计与基线评估", "基线学业与认知能力测评"],
    outcome: ["短期效果验证", "非认知因素短期变化评估", "即时学业成就后测"],
    followup: ["长期影响追踪与归因分析", "纵向追踪数据收集"],
    field: ["环境监测", "野外采样", "field observation"],
  };
  for (const [expected, names] of Object.entries(examples)) for (const name of names) {
    assert.equal(classify(name), expected, name);
  }
});

test("manual choice overrides automatic classification and can be reset", () => {
  assert.equal(effective("患者 MRI 检查", "cell"), "cell");
  assert.equal(effective("患者 MRI 检查", null), "imaging");
  assert.equal(effective("患者 MRI 检查", "unknown-category"), "imaging");
  assert.equal(effective("干预方案落地", null, "评估教育干预对学生的长期影响"), "education");
  assert.equal(effective("干预方案落地", null, "评估肿瘤治疗"), "generic");
  assert.equal(effective("细胞干预方案", null, "评估教育干预"), "cell");
});

test("specific technique beats a general cell or pathway keyword", () => {
  assert.equal(classify("单细胞微流控液滴捕获"), "microfluidic");
  assert.equal(classify("细胞中关键通路蛋白检测"), "protein");
  assert.equal(classify("细胞糖酵解检测"), "metabolism");
  assert.equal(classify("细胞基因敲除"), "gene");
  assert.equal(classify("患者来源细胞培养"), "cell");
  assert.equal(classify("微流控芯片"), "microfluidic");
  assert.equal(classify("患者 MRI 检查"), "imaging");
  assert.equal(classify("fuel cell performance"), "materials");
  assert.equal(classify("control group"), "control");
  assert.equal(classify("feedback control algorithm"), "software");
  assert.equal(classify("尚未指定的研究环节"), "generic");
});

test("every selectable category has a positioned, available illustration", () => {
  const css = fs.readFileSync("src/components/experiment-route.css", "utf8");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)];
  for (const [category] of exportsForTest.CATEGORY_OPTIONS) {
    const selector = `.er-illustration-${category}`;
    assert.ok(rules.some(([, selectors, body]) => selectors.split(",").some(s => s.trim() === selector) && /background-position/.test(body)), `${category}: no position`);
    const imageRule = rules.find(([, selectors, body]) => selectors.split(",").some(s => s.trim() === selector) && /background-image/.test(body));
    // The default sheet is used for database, cell, animal and analysis.
    assert.ok(imageRule || ["database", "cell", "animal", "analysis"].includes(category), `${category}: no image sheet`);
    const image = imageRule?.[2].match(/url\('([^']+)'\)/)?.[1] || "/research-elements/editorial-v2.png";
    assert.ok(fs.existsSync(`public${image}`), `${category}: missing ${image}`);
  }
});
