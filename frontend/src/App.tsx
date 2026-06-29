import {
  Bot,
  Database,
  Gauge,
  History,
  KeyRound,
  LogOut,
  Play,
  RefreshCw,
  Search,
  Shield,
  Users
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { AdminItem, CatalogItem, JobSummary, ObjectDetails, QnaResponse } from "./types";

type View = "catalog" | "jobs" | "qna" | "users" | "roles" | "engines";

const navItems: Array<{ view: View; label: string; icon: typeof Database }> = [
  { view: "catalog", label: "Catalog", icon: Database },
  { view: "jobs", label: "Jobs", icon: History },
  { view: "qna", label: "SQL/Q&A", icon: Bot },
  { view: "users", label: "Users", icon: Users },
  { view: "roles", label: "Roles", icon: Shield },
  { view: "engines", label: "Engines", icon: Gauge }
];

export function App() {
  const [userId, setUserId] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [view, setView] = useState<View>("catalog");
  const [selectedObject, setSelectedObject] = useState<CatalogItem | null>(null);

  useEffect(() => {
    api
      .session()
      .then((session) => setUserId(session.user_id))
      .catch(() => setUserId(null))
      .finally(() => setCheckingSession(false));
  }, []);

  if (checkingSession) {
    return <div className="loading-screen">Checking session</div>;
  }

  if (!userId) {
    return <Login onLogin={setUserId} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Database size={24} />
          <div>
            <strong>Dremio Console</strong>
            <span>{userId}</span>
          </div>
        </div>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.view}
                className={view === item.view ? "nav-active" : ""}
                onClick={() => setView(item.view)}
                type="button"
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <button
          className="logout"
          type="button"
          onClick={() => api.logout().finally(() => setUserId(null))}
          title="Sign out"
        >
          <LogOut size={18} />
          Sign out
        </button>
      </aside>

      <main className="workspace">
        {view === "catalog" && (
          <CatalogView selectedObject={selectedObject} onSelect={setSelectedObject} />
        )}
        {view === "jobs" && <JobsView />}
        {view === "qna" && <QnaView selectedObject={selectedObject} />}
        {view === "users" && <AdminList title="Users" load={api.users} />}
        {view === "roles" && <AdminList title="Roles" load={api.roles} />}
        {view === "engines" && <AdminList title="Engines" load={api.engines} />}
      </main>
    </div>
  );
}

function Login({ onLogin }: { onLogin: (userId: string) => void }) {
  const [userId, setUserId] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const session = await api.login(userId, token);
      onLogin(session.user_id ?? userId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-screen">
      <form className="login-panel" onSubmit={submit}>
        <div className="login-title">
          <KeyRound size={28} />
          <div>
            <h1>Dremio Console</h1>
            <p>Use an allowlisted identity and a Dremio personal token.</p>
          </div>
        </div>
        <label>
          User or email
          <input value={userId} onChange={(event) => setUserId(event.target.value)} required />
        </label>
        <label>
          Personal token
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            required
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={loading}>
          {loading ? "Signing in" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

function CatalogView({
  selectedObject,
  onSelect
}: {
  selectedObject: CatalogItem | null;
  onSelect: (item: CatalogItem) => void;
}) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [children, setChildren] = useState<CatalogItem[]>([]);
  const [details, setDetails] = useState<ObjectDetails | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .catalogRoot()
      .then((response) => setItems(response.items))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load catalog"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedObject) {
      return;
    }
    setError("");
    api
      .objectDetails(selectedObject.id)
      .then(setDetails)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load object"));
    api
      .catalogChildren(selectedObject.id)
      .then((response) => setChildren(response.items))
      .catch(() => setChildren([]));
  }, [selectedObject]);

  const filtered = useMemo(() => {
    const term = filter.toLowerCase();
    return items.filter((item) => item.path.join(".").toLowerCase().includes(term));
  }, [filter, items]);

  return (
    <section className="page-grid">
      <div className="panel browser-panel">
        <div className="toolbar">
          <h2>Catalog</h2>
          <button type="button" onClick={() => api.catalogRoot().then((r) => setItems(r.items))}>
            <RefreshCw size={16} />
          </button>
        </div>
        <label className="search-box">
          <Search size={16} />
          <input
            placeholder="Filter sources and spaces"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
        {loading && <div className="muted">Loading catalog</div>}
        {error && <div className="error">{error}</div>}
        <div className="object-list">
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              className={selectedObject?.id === item.id ? "object-row selected" : "object-row"}
              onClick={() => onSelect(item)}
            >
              <span>{item.path.join(".") || item.id}</span>
              <small>{item.type}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="panel details-panel">
        <h2>{selectedObject ? selectedObject.path.join(".") || selectedObject.id : "Select an object"}</h2>
        {selectedObject ? (
          <>
            <div className="metric-row">
              <InfoPill label="Type" value={selectedObject.type} />
              <InfoPill label="ID" value={selectedObject.id} />
              <InfoPill label="Tag" value={selectedObject.tag ?? "None"} />
            </div>
            <h3>Children</h3>
            <div className="compact-list">
              {children.length === 0 && <span className="muted">No child objects visible</span>}
              {children.map((child) => (
                <button key={child.id} type="button" onClick={() => onSelect(child)}>
                  {child.path.join(".") || child.id}
                </button>
              ))}
            </div>
            <h3>Metadata</h3>
            <pre>{JSON.stringify(details?.raw ?? {}, null, 2)}</pre>
            <h3>RBAC</h3>
            <pre>{JSON.stringify(details?.permissions ?? { status: "No permission details returned" }, null, 2)}</pre>
          </>
        ) : (
          <div className="empty-state">Choose a source, space, folder, dataset, or view.</div>
        )}
      </div>
    </section>
  );
}

function JobsView() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadJobs() {
    setLoading(true);
    setError("");
    try {
      const response = await api.jobs();
      setJobs(response.jobs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load jobs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadJobs();
  }, []);

  return (
    <section className="panel full-panel">
      <div className="toolbar">
        <h2>Recent Jobs</h2>
        <button type="button" onClick={loadJobs}>
          <RefreshCw size={16} />
        </button>
      </div>
      {loading && <div className="muted">Loading jobs</div>}
      {error && <div className="error">{error}</div>}
      <table>
        <thead>
          <tr>
            <th>Job</th>
            <th>User</th>
            <th>Status</th>
            <th>Type</th>
            <th>Started</th>
            <th>SQL</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td>{job.id}</td>
              <td>{job.user_name ?? "Unknown"}</td>
              <td>{job.status ?? "Unknown"}</td>
              <td>{job.query_type ?? "Unknown"}</td>
              <td>{job.start_time ?? "Unknown"}</td>
              <td className="sql-cell">{job.sql ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {jobs.length === 0 && !loading && <div className="empty-state">No recent jobs returned.</div>}
    </section>
  );
}

function QnaView({ selectedObject }: { selectedObject: CatalogItem | null }) {
  const [question, setQuestion] = useState("");
  const [sql, setSql] = useState("");
  const [answer, setAnswer] = useState<QnaResponse | null>(null);
  const [jobId, setJobId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function ask() {
    setLoading(true);
    setError("");
    try {
      const response = await api.qna(question, selectedObject?.id);
      setAnswer(response);
      if (response.draft_sql) {
        setSql(response.draft_sql);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Question failed");
    } finally {
      setLoading(false);
    }
  }

  async function runSql() {
    setLoading(true);
    setError("");
    try {
      const response = await api.runSql(sql, selectedObject?.path ?? []);
      setJobId(response.job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "SQL submission failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="page-grid">
      <div className="panel">
        <h2>Ask Dremio</h2>
        <p className="muted">
          Context: {selectedObject ? selectedObject.path.join(".") : "no catalog object selected"}
        </p>
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about metadata, recent jobs, or draft a read-only query"
        />
        <button type="button" onClick={ask} disabled={loading || !question.trim()}>
          <Bot size={16} />
          Ask
        </button>
        {answer && (
          <div className="answer">
            <h3>Answer</h3>
            <p>{answer.answer}</p>
          </div>
        )}
      </div>
      <div className="panel">
        <h2>SQL Draft</h2>
        <textarea
          className="sql-editor"
          value={sql}
          onChange={(event) => setSql(event.target.value)}
          placeholder="Generated or hand-written SQL"
        />
        <button type="button" onClick={runSql} disabled={loading || !sql.trim()}>
          <Play size={16} />
          Run manually
        </button>
        {jobId && <div className="success">Submitted job {jobId}</div>}
        {error && <div className="error">{error}</div>}
      </div>
    </section>
  );
}

function AdminList({ title, load }: { title: string; load: () => Promise<{ items: AdminItem[] }> }) {
  const [items, setItems] = useState<AdminItem[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    load()
      .then((response) => setItems(response.items))
      .catch((err) => setError(err instanceof Error ? err.message : `Could not load ${title}`));
  }, [load, title]);

  return (
    <section className="panel full-panel">
      <div className="toolbar">
        <h2>{title}</h2>
        <span className="readonly">Read-only</span>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="json-grid">
        {items.map((item, index) => (
          <pre key={String(item.id ?? item.name ?? index)}>{JSON.stringify(item, null, 2)}</pre>
        ))}
      </div>
      {items.length === 0 && !error && <div className="empty-state">No {title.toLowerCase()} returned.</div>}
    </section>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
