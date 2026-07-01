import type {
  AdminItem,
  CatalogItem,
  JobsResponse,
  ObjectDetails,
  QnaResponse,
  RbacExplanation,
  SessionResponse
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  session: () => request<SessionResponse>("/api/session"),
  login: (userId: string, token: string) =>
    request<SessionResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ user_id: userId, token })
    }),
  logout: () =>
    request<SessionResponse>("/api/auth/logout", {
      method: "POST"
    }),
  catalogRoot: () => request<{ items: CatalogItem[] }>("/api/catalog"),
  catalogChildren: (id: string) =>
    request<{ items: CatalogItem[] }>(`/api/catalog/${encodeURIComponent(id)}/children`),
  objectDetails: (id: string) =>
    request<ObjectDetails>(`/api/catalog/${encodeURIComponent(id)}`),
  jobs: (limit = 50) => request<JobsResponse>(`/api/jobs?limit=${limit}`),
  runSql: (sql: string, context: string[]) =>
    request<{ job_id: string }>("/api/sql", {
      method: "POST",
      body: JSON.stringify({ sql, context })
    }),
  qna: (question: string, objectId?: string, jobIds: string[] = []) =>
    request<QnaResponse>("/api/qna", {
      method: "POST",
      body: JSON.stringify({
        question,
        object_id: objectId,
        job_ids: jobIds
      })
    }),
  explainRbac: (objectId: string, userId: string) =>
    request<RbacExplanation>(
      `/api/rbac/explain?object_id=${encodeURIComponent(objectId)}&user_id=${encodeURIComponent(userId)}`
    ),
  users: () => request<{ items: AdminItem[] }>("/api/admin/users"),
  roles: () => request<{ items: AdminItem[] }>("/api/admin/roles"),
  engines: () => request<{ items: AdminItem[] }>("/api/admin/engines")
};
