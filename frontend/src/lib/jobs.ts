/** 慢 AI 调用统一走任务接口：提交 → 订阅进度 → 取结果。
 *
 *  为什么不再用「一次性 POST 等结果」：
 *  模型思考往往 20–40 秒，HTTP 代理、浏览器和部署环境的超时会把「还在算」误判成
 *  「失败」（生产环境就出现过 35 秒 504）。改成任务后，提交立即返回，长任务在服务端
 *  继续跑，前端用 SSE 订阅阶段与进度，断线了还能重连/轮询，不会丢结果。
 */
import { API, ApiError, apiJson } from "@/lib/api";

export type JobKind = "xray" | "compare" | "novelty" | "design" | "mindmap" | "experiment" | "design_review" | "design_outcomes";

export type JobProgress = { done: number; total: number };

export type JobStatus = "queued" | "running" | "done" | "failed" | "canceled";

export type JobSnapshot = {
  id: string;
  kind: JobKind;
  status: JobStatus;
  stage?: string | null;
  stage_label?: string | null;
  progress?: JobProgress | null;
  result?: unknown | null;
  error?: { code: string; message: string } | null;
};

type Handlers = {
  onSnapshot?: (snapshot: JobSnapshot) => void;
  onStage?: (stage: string, label: string) => void;
  onProgress?: (progress: JobProgress) => void;
};

const TERMINAL: ReadonlySet<JobStatus> = new Set<JobStatus>(["done", "failed", "canceled"]);

/** 同一请求已在跑时，后端返回的是同一个 job（幂等），所以重复点击不会重复烧 token。 */
export async function submitJob(kind: JobKind, params: Record<string, unknown>): Promise<JobSnapshot> {
  // 后端返回 202；apiJson 只在 !ok 时抛错，202 属于 ok。
  return apiJson<JobSnapshot>("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, params }),
  });
}

export async function getJob(id: string): Promise<JobSnapshot> {
  return apiJson<JobSnapshot>(`/api/jobs/${encodeURIComponent(id)}`);
}

export async function cancelJob(id: string): Promise<void> {
  try {
    await apiJson<{ canceled: boolean }>(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    // 取消失败不应影响调用方：任务可能已经结束，或者页面已经离开、连接已断。
  }
}

function readEventData(event: Event): unknown {
  const data = (event as MessageEvent).data;
  if (typeof data !== "string" || !data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/** 订阅任务：优先 SSE，连不上或静默时降级为 1 秒轮询；返回最终快照。
 *
 *  - EventSource 在主域名同源时自动带 Cookie；dev 下前端 3000 端口直连 8000，
 *    必须 withCredentials 才能带上匿名会话 Cookie，否则后端看不到 owner。
 *  - signal abort（离开页面 / 切换论文）会关闭连接并调用 DELETE 取消任务，
 *    避免用户已经走了、后台还在白烧 token。
 *  - 约定：任务级失败（status=failed）不抛异常，交给调用方读 snapshot.error；
 *    只有「被 abort」才 reject AbortError，调用方用 signal.aborted 忽略即可。
 */
export function watchJob(id: string, handlers: Handlers = {}, signal?: AbortSignal): Promise<JobSnapshot> {
  return new Promise<JobSnapshot>((resolve, reject) => {
    let settled = false;
    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;
    let polling = false;
    let latest: JobSnapshot | null = null;

    const stop = () => {
      if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
      if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null; }
      if (source) { source.close(); source = null; }
      signal?.removeEventListener("abort", onAbort);
    };
    const settle = (snapshot: JobSnapshot) => {
      if (settled) return;
      settled = true;
      stop();
      resolve(snapshot);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      stop();
      reject(error);
    };
    const onAbort = () => {
      if (settled) return;
      stop();
      settled = true;
      void cancelJob(id);
      reject(new DOMException("任务已取消", "AbortError"));
    };

    const pushSnapshot = (snapshot: JobSnapshot) => {
      if (settled) return;
      latest = snapshot;
      handlers.onSnapshot?.(snapshot);
      if (snapshot.stage || snapshot.stage_label) handlers.onStage?.(snapshot.stage ?? "", snapshot.stage_label ?? "");
      if (snapshot.progress) handlers.onProgress?.(snapshot.progress);
      if (!TERMINAL.has(snapshot.status)) return;
      if (snapshot.status === "done" && snapshot.result == null) {
        // 结果事件偶尔会晚于终态快照到达；补一次完整记录，避免上层拿到空 result。
        getJob(id).then((full) => settle({ ...full, status: "done" })).catch(fail);
        return;
      }
      settle(snapshot);
    };

    const startPolling = (interval = 1000) => {
      if (polling || settled) return;
      polling = true;
      const tick = async () => {
        if (settled) return;
        try {
          const snapshot = await getJob(id);
          pushSnapshot(snapshot);
          if (settled) return;
        } catch (error) {
          if (error instanceof ApiError && [401, 403, 404].includes(error.status)) { fail(error); return; }
          // 网络抖动不应该中断等待：下一轮继续。
        }
        if (!settled) pollTimer = setTimeout(tick, interval);
      };
      void tick();
    };

    const startSse = () => {
      if (typeof window === "undefined" || typeof EventSource === "undefined") { startPolling(); return; }
      try {
        source = new EventSource(`${API}/api/jobs/${encodeURIComponent(id)}/events`, { withCredentials: true });
      } catch {
        startPolling();
        return;
      }
      source.addEventListener("snapshot", (event) => {
        const snapshot = readEventData(event) as JobSnapshot | null;
        if (snapshot) pushSnapshot(snapshot);
      });
      source.addEventListener("stage", (event) => {
        if (settled) return;
        const data = readEventData(event) as { stage?: string; label?: string } | null;
        if (data) handlers.onStage?.(data.stage ?? "", data.label ?? "");
      });
      source.addEventListener("progress", (event) => {
        if (settled) return;
        const data = readEventData(event) as { done?: number; total?: number } | null;
        if (data) handlers.onProgress?.({ done: data.done ?? 0, total: data.total ?? 0 });
      });
      source.addEventListener("result", (event) => {
        const artifact = readEventData(event);
        if (settled) return;
        if (latest) { settle({ ...latest, status: "done", result: artifact }); return; }
        getJob(id).then((full) => settle({ ...full, status: "done", result: full.result ?? artifact })).catch(fail);
      });
      source.addEventListener("error", (event) => {
        // 两种 error 要分开：业务错误事件带 data；传输层错误（network/chunked 断开）没有 data。
        // 业务错误是终态，直接给出快照；传输层错误则交给轮询兜底（EventSource 自己也会重连）。
        const data = readEventData(event) as { code?: string; message?: string } | null;
        if (data) {
          const error = { code: data.code ?? "unknown", message: data.message ?? "任务失败，请重试" };
          if (latest) { settle({ ...latest, status: "failed", error }); return; }
          getJob(id).then((full) => settle({ ...full, status: "failed", error })).catch(fail);
          return;
        }
        startPolling();
      });
      // SSE can stall silently after its initial snapshot. Periodic status
      // checks also recover terminal events dropped by a slow connection.
      safetyTimer = setTimeout(() => { if (!settled) startPolling(5000); }, 5000);
    };

    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    startSse();
  });
}
