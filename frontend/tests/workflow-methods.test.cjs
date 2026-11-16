const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('module');
const compiled = ts.transpileModule(fs.readFileSync('src/lib/experiment-categories.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const loaded = new Module('categories'); loaded._compile(compiled, 'categories.js');
const { specificMethodCategory, stageIllustrationCategory, categoryById } = loaded.exports;
test('specific methods receive distinct illustrations without forcing vague names', () => {
  for (const [name, expected] of [['Western blot 蛋白检测', 'western_blot'], ['RT-qPCR 检测', 'pcr_assay'], ['Transwell 侵袭实验', 'transwell_assay'], ['流式细胞术', 'flow_cytometry'], ['ELISA检测', 'elisa_assay'], ['免疫组化 IHC', 'ihc_assay'], ['CCK-8细胞增殖', 'cell_proliferation'], ['免疫荧光染色', 'immunofluorescence'], ['RNA测序', 'sequencing_lab'], ['外泌体分离', 'vesicle_lab'], ['HE染色', 'histology_lab'], ['细菌培养', 'microbiology_lab'], ['糖酵解检测', 'metabolism_lab']]) {
    assert.equal(specificMethodCategory(name), expected);
    assert.ok(categoryById(expected));
  }
  assert.equal(specificMethodCategory('细胞培养'), null);
  assert.equal(specificMethodCategory('动物模型'), null);
  assert.equal(specificMethodCategory('RNA-seq data analysis'), null);
});

test('research stage illustrations follow their actual titles', () => {
  assert.equal(stageIllustrationCategory('STAB2在Kupffer细胞中的表达谱与定位分析'), 'expression_analysis');
  assert.equal(stageIllustrationCategory('STAB2缺失对Kupffer细胞表型及YAP/TEAD通路的影响'), 'gene_perturbation');
  assert.equal(stageIllustrationCategory('STAB2介导的Kupffer细胞对CD8+ T细胞功能的调控'), 'immune_interaction');
  assert.equal(stageIllustrationCategory('细胞培养'), null);
});
