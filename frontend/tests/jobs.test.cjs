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
  vm.runInNewContext(code, { exports, require: () => ({ API: "", ApiError, apiJson, ensureSession: async () => {} }),
    window: {}, EventSource: FakeEventSource, DOMException, AbortSignal, setTimeout: (fn, delay) => {
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
  await Promise.resolve();
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
  await Promise.resolve();
  h.timers.find(timer => timer.delay === 5000).fn();
  await assert.rejects(promise, error);
  assert.equal(h.FakeEventSource.current.closed, true);
});

test("preserves cancellation received over SSE", async () => {
  const h = harness(async () => { throw new Error("unexpected poll"); });
  const result = h.watchJob("job");
  await Promise.resolve();
  h.FakeEventSource.current.emit("snapshot", { id: "job", kind: "compare", status: "running" });
  h.FakeEventSource.current.emit("error", { code: "canceled", message: "任务已取消" });
  assert.equal((await result).status, "canceled");
  assert.equal(h.FakeEventSource.current.closed, true);
});

test("closes a failed event connection before polling", async () => {
  let closedBeforePoll;
  const h = harness(async () => {
    closedBeforePoll = h.FakeEventSource.current.closed;
    return { id: "job", kind: "compare", status: "done", result: { value: 42 } };
  });
  const result = h.watchJob("job");
  await Promise.resolve();
  h.FakeEventSource.current.emit("error");
  assert.equal((await result).status, "done");
  assert.equal(closedBeforePoll, true);
});

test("recovers a completed result after a temporary status failure", async () => {
  const network = [];
  let attempts = 0;
  const h = harness(async () => {
    if (++attempts === 1) throw new TypeError("offline");
    return { id: "job", kind: "compare", status: "done", result: { value: 42 } };
  });
  const promise = h.watchJob("job", { onConnection: (connected) => network.push(connected) });
  await Promise.resolve();
  h.FakeEventSource.current.emit("snapshot", { id: "job", kind: "compare", status: "done" });
  await new Promise(setImmediate);
  assert.deepEqual(network, [false]);
  h.timers.find((timer) => timer.delay === 2000).fn();
  assert.equal((await promise).result.value, 42);
  assert.deepEqual(network, [false, true]);
});

test("never replaces a newer stream stage with a delayed poll", async () => {
  let deliver;
  const h = harness(() => new Promise((resolve) => { deliver = resolve; }));
  const stages = [];
  const promise = h.watchJob("job", { onStage: (_id, label) => stages.push(label) });
  await Promise.resolve();
  const stream = h.FakeEventSource.current;
  stream.emit("snapshot", { id: "job", kind: "compare", status: "running", stage_label: "Reading" });
  h.timers.find((timer) => timer.delay === 5000).fn();
  stream.emit("stage", { stage: "writing", label: "Writing" });
  deliver({ id: "job", kind: "compare", status: "running", stage_label: "Reading" });
  await new Promise(setImmediate);
  stream.emit("result", { value: 42 });
  await promise;
  assert.deepEqual(stages, ["Reading", "Writing"]);
});
