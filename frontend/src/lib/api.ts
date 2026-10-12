// An empty value uses the site's own origin, allowing Nginx to route /api to FastAPI.
export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

export async function apiJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, { credentials: "include", ...options });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || "服务暂时不可用，请稍后重试");
  }
  return response.json() as Promise<T>;
}

export function postJson<T>(path: string, body: unknown): Promise<T> {
  return apiJson<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
