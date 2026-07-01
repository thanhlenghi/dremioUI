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
  source_type?: string | null;
};

export type ObjectDetails = {
  id: string;
  raw: Record<string, unknown>;
  permissions?: Record<string, unknown> | unknown[] | null;
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
  raw: Record<string, unknown>;
};

export type RbacExplanation = {
  object_id: string;
  object_path: string[];
  user: {
    id?: string | null;
    name?: string | null;
    email?: string | null;
  };
  roles: Array<{
    id?: string | null;
    name?: string | null;
    email?: string | null;
  }>;
  effective_privileges: string[];
  grants: Array<{
    privilege: string;
    source: string;
    grantee_type: string;
    grantee_id?: string | null;
    grantee_name?: string | null;
    grant_object_id: string;
    grant_object_path: string[];
    inherited: boolean;
    explicit: boolean;
    via_role_id?: string | null;
    via_role_name?: string | null;
  }>;
  unresolved: string[];
};

export type AdminItem = Record<string, unknown>;
