const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('module');
const code = ts.transpileModule(fs.readFileSync('src/lib/mindmap.ts', 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const loaded = new Module('mindmap'); loaded._compile(code, 'mindmap.js');
const {nodeMetrics, measureLabel} = loaded.exports;
test('long root label wraps within the padded node width', () => {
  const label = 'YAP通过mTORC1在小鼠中加速Notch驱动的胆管癌发生';
  const node = {id:'root',label,kind:'title',unit_ids:[],page:null,inferred:false,children:[]};
  const metrics = nodeMetrics(node);
  assert.ok(metrics.lines.length > 1);
  assert.equal(metrics.lines.join(''), label);
  for (const line of metrics.lines) assert.ok(measureLabel(line) <= metrics.width - 44, line);
});
