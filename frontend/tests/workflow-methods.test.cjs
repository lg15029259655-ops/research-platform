const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('module');
const compiled = ts.transpileModule(fs.readFileSync('src/lib/experiment-categories.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const loaded = new Module('categories'); loaded._compile(compiled, 'categories.js');
const { specificMethodCategory, categoryById } = loaded.exports;
test('specific methods receive distinct illustrations without forcing vague names', () => {
  for (const [name, expected] of [['Western blot 蛋白检测', 'western_blot'], ['RT-qPCR 检测', 'pcr_assay'], ['Transwell 侵袭实验', 'transwell_assay'], ['流式细胞术', 'flow_cytometry'], ['ELISA检测', 'elisa_assay'], ['免疫组化 IHC', 'ihc_assay'], ['CCK-8细胞增殖', 'cell_proliferation'], ['免疫荧光染色', 'immunofluorescence'], ['RNA测序', 'sequencing_lab'], ['外泌体分离', 'vesicle_lab'], ['HE染色', 'histology_lab'], ['细菌培养', 'microbiology_lab'], ['糖酵解检测', 'metabolism_lab']]) {
    assert.equal(specificMethodCategory(name), expected);
    assert.ok(categoryById(expected));
  }
  assert.equal(specificMethodCategory('细胞培养'), null);
  assert.equal(specificMethodCategory('动物模型'), null);
  assert.equal(specificMethodCategory('RNA-seq data analysis'), null);
});
