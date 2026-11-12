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
  };
  for (const [expected, names] of Object.entries(examples)) for (const name of names) {
    assert.equal(classify(name), expected, name);
  }
});

test("specific technique beats a general cell or pathway keyword", () => {
  assert.equal(classify("单细胞微流控液滴捕获"), "microfluidic");
  assert.equal(classify("细胞中关键通路蛋白检测"), "protein");
  assert.equal(classify("细胞糖酵解检测"), "metabolism");
  assert.equal(classify("细胞基因敲除"), "gene");
  assert.equal(classify("尚未指定的研究环节"), "generic");
});
