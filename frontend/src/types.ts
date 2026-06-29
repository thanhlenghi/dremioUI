export type SessionResponse = {
  authenticated: boolean;
  user_id: string | null;
};

export type CatalogItem = {
  id: string;
  path: string[];
  type: string;
  tag?: string | null;
  container_type?: string | null;
};

export type ObjectDetails = {
  id: string;
  raw: Record<string, unknown>;
  permissions?: Record<string, unknown> | null;
};

export type JobSummary = {
  id: string;
  user_name?: string | null;
  query_type?: string | null;
  status?: string | null;
  start_time?: string | null;
  duration_ms?: number | null;
  sql?: string | null;
};

export type QnaResponse = {
  answer: string;
  draft_sql?: string | null;
  citations: string[];
};

export type AdminItem = Record<string, unknown>;
