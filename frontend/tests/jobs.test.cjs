const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function harness(apiJson) {
  class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
  class FakeEventSource {
    constructor() { this.handlers = {}; FakeEventSource.current = this; }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    emit(name, value) { this.handlers[name]({ data: JSON.stringify(value) }); }
    close() { this.closed = true; }
  }
  const timers = [];
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync("src/lib/jobs.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: () => ({ API: "", ApiError, apiJson }),
    window: {}, EventSource: FakeEventSource, DOMException, setTimeout: (fn, delay) => {
      const timer = { fn, delay, active: true }; timers.push(timer); return timer;
    }, clearTimeout: timer => { timer.active = false; }, console });
  return { ...exports, ApiError, FakeEventSource, timers };
}

test("polls for completion when SSE stalls after an initial snapshot", async () => {
  const calls = [];
  const h = harness(async path => {
    calls.push(path);
    return { id: "job", kind: "compare", status: "done", result: { value: 42 } };
  });
  const promise = h.watchJob("job");
  h.FakeEventSource.current.emit("snapshot", { id: "job", kind: "compare", status: "running" });
  h.timers.find(timer => timer.delay === 5000).fn();
  const result = await promise;
  assert.equal(result.status, "done");
  assert.equal(result.result.value, 42);
  assert.deepEqual(calls, ["/api/jobs/job"]);
  assert.equal(h.FakeEventSource.current.closed, true);
});

test("stops polling when the task no longer exists", async () => {
  let error;
  const h = harness(async () => { throw error; });
  error = new h.ApiError("任务不存在", 404);
  const promise = h.watchJob("missing");
  h.timers.find(timer => timer.delay === 5000).fn();
  await assert.rejects(promise, error);
  assert.equal(h.FakeEventSource.current.closed, true);
});
