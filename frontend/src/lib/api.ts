// An empty value uses the site's own origin, allowing Nginx to route /api to FastAPI.
export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

let session: Promise<void> | null = null;

export function ensureSession(): Promise<void> {
  session ??= fetch(`${API}/api/session`, { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(10000) })
    .then((response) => {
      if (!response.ok) throw new Error("无法连接研究工作区，请重试");
    }).catch((error) => {
      session = null;
      throw error;
    });
  return session;
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = "ApiError"; }
}

export async function apiJson<T>(path: string, options?: RequestInit): Promise<T> {
  await ensureSession();
  options?.signal?.throwIfAborted();
  const response = await fetch(`${API}${path}`, { credentials: "include", ...options });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(describeError(body, response.status), response.status);
  }
  return response.json() as Promise<T>;
}

/** FastAPI 的 detail 有两种形状：字符串（业务错误，如 "最多选择 5 篇论文"）
 *  与数组（422 请求校验错误，形如 [{loc, msg, type}]）。
 *  直接把 detail 交给 Error 会让数组变成 "[object Object]"，用户只看到一个空错误框。 */
function describeError(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0];
    if (typeof first === "string" && first.trim()) return first;
    const message = (first as { msg?: unknown } | null)?.msg;
    if (typeof message === "string" && message.trim()) return message;
  }
  if (status === 401 || status === 403) return "登录状态已失效，请刷新页面后重试";
  return `服务暂时不可用（HTTP ${status}）`;
}

export function postJson<T>(path: string, body: unknown): Promise<T> {
  return apiJson<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
