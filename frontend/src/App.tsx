import {
  Bot,
  ChevronDown,
  ChevronRight,
  Cloud,
  Database,
  Eye,
  File,
  FileText,
  Folder,
  FolderOpen,
  Gauge,
  History,
  Home,
  Info,
  KeyRound,
  Library,
  Loader2,
  LogOut,
  Play,
  RefreshCw,
  Search,
  Shield,
  Table2,
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
  const [rootItems, setRootItems] = useState<CatalogItem[]>([]);
  const [childrenById, setChildrenById] = useState<Record<string, CatalogItem[]>>({});
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [loadingChildrenIds, setLoadingChildrenIds] = useState<Set<string>>(() => new Set());
  const [details, setDetails] = useState<ObjectDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadRoot() {
    setLoading(true);
    setError("");
    setChildrenById({});
    setExpandedIds(new Set());
    api
      .catalogRoot()
      .then((response) => setRootItems(response.items))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load catalog"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadRoot();
  }, []);

  useEffect(() => {
    if (!selectedObject) {
      setDetails(null);
      return;
    }
    setDetailsLoading(true);
    setError("");
    api
      .objectDetails(selectedObject.id)
      .then(setDetails)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load object"))
      .finally(() => setDetailsLoading(false));
  }, [selectedObject]);

  async function toggleNode(item: CatalogItem) {
    if (!isExpandable(item)) {
      return;
    }
    const next = new Set(expandedIds);
    if (next.has(item.id)) {
      next.delete(item.id);
      setExpandedIds(next);
      return;
    }
    next.add(item.id);
    setExpandedIds(next);
    if (childrenById[item.id]) {
      return;
    }

    setLoadingChildrenIds((current) => new Set(current).add(item.id));
    try {
      const response = await api.catalogChildren(item.id);
      setChildrenById((current) => ({ ...current, [item.id]: response.items }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load child objects");
      setChildrenById((current) => ({ ...current, [item.id]: [] }));
    } finally {
      setLoadingChildrenIds((current) => {
        const nextLoading = new Set(current);
        nextLoading.delete(item.id);
        return nextLoading;
      });
    }
  }

  const visibleRoots = useMemo(
    () => filterTree(rootItems, childrenById, filter),
    [childrenById, filter, rootItems]
  );

  return (
    <section className="catalog-layout">
      <div className="catalog-browser">
        <div className="catalog-header">
          <div>
            <h2>Catalog</h2>
            <span>{rootItems.length} root objects</span>
          </div>
          <button type="button" onClick={loadRoot} title="Refresh catalog">
            <RefreshCw size={16} />
          </button>
        </div>
        <label className="search-box catalog-search">
          <Search size={16} />
          <input
            placeholder="Filter loaded objects"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
        {error && <div className="error">{error}</div>}
        <div className="tree-shell">
          {loading && <div className="tree-status">Loading catalog</div>}
          {!loading && visibleRoots.length === 0 && (
            <div className="tree-status">No loaded objects match the filter.</div>
          )}
          {visibleRoots.map((item) => (
            <CatalogTreeNode
              key={item.id}
              item={item}
              depth={0}
              selectedId={selectedObject?.id}
              childrenById={childrenById}
              expandedIds={expandedIds}
              loadingChildrenIds={loadingChildrenIds}
              filter={filter}
              onSelect={onSelect}
              onToggle={toggleNode}
            />
          ))}
        </div>
      </div>

      <aside className="info-panel">
        <div className="info-panel-header">
          <div className="info-panel-icon">
            <Info size={18} />
          </div>
          <div>
            <h2>{selectedObject ? displayName(selectedObject) : "Object Info"}</h2>
            <span>{selectedObject ? selectedObject.path.join(".") : "Select an object in the tree"}</span>
          </div>
        </div>
        {selectedObject ? (
          <div className="info-panel-body">
            <div className="metric-row">
              <InfoPill label="Type" value={objectTypeLabel(selectedObject)} />
              <InfoPill label="ID" value={selectedObject.id} />
              <InfoPill label="Tag" value={selectedObject.tag ?? "None"} />
            </div>
            {detailsLoading && <div className="muted">Loading metadata</div>}
            <h3>Metadata</h3>
            <pre>{JSON.stringify(details?.raw ?? {}, null, 2)}</pre>
            <h3>RBAC</h3>
            <RbacPanel permissions={details?.permissions} />
          </div>
        ) : (
          <div className="empty-state">Choose a source, folder, dataset, or view.</div>
        )}
      </aside>
    </section>
  );
}

type RbacGrant = {
  id?: string;
  name?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  granteeType?: string;
  type?: string;
  privileges?: string[];
  permissions?: string[];
  inherited?: boolean;
  isInherited?: boolean;
  inheritedFrom?: unknown;
  source?: string;
  path?: string[];
};

type NormalizedGrant = {
  id: string;
  name: string;
  type: "USER" | "ROLE" | "OTHER";
  privileges: string[];
  inherited: boolean;
  inheritedFrom?: string;
};

type PrincipalRef = {
  id?: string;
  name?: string;
};

type RbacUser = {
  id: string;
  name: string;
  email?: string;
  roles: PrincipalRef[];
};

type EffectiveAccessEntry = {
  key: string;
  label: string;
  detail: string;
  privileges: string[];
  inherited: boolean;
};

type EffectivePrivilege = {
  privilege: string;
  inherited: boolean;
};

function RbacPanel({ permissions }: { permissions: ObjectDetails["permissions"] }) {
  const [rbacUsers, setRbacUsers] = useState<RbacUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [usersLoading, setUsersLoading] = useState(false);
  const [userLoadError, setUserLoadError] = useState("");
  const grants = normalizeGrants(permissions);
  const users = grants.filter((grant) => grant.type === "USER");
  const roles = grants.filter((grant) => grant.type === "ROLE");
  const effectivePermissions = normalizeEffectivePermissions(permissions);
  const selectableUsers = useMemo(() => mergeRbacUsers(rbacUsers, users), [rbacUsers, users]);
  const effectiveSelectedUserId = selectableUsers.some((user) => user.id === selectedUserId)
    ? selectedUserId
    : selectableUsers[0]?.id ?? "";
  const selectedUser = selectableUsers.find((user) => user.id === effectiveSelectedUserId);
  const userEffectiveAccess = selectedUser ? effectiveAccessForUser(selectedUser, grants) : [];
  const userEffectivePrivileges = aggregateEffectivePrivileges(userEffectiveAccess);

  useEffect(() => {
    let cancelled = false;
    setUsersLoading(true);
    setUserLoadError("");
    api
      .users()
      .then((response) => {
        if (cancelled) {
          return;
        }
        const normalizedUsers = normalizeRbacUsers(response.items);
        setRbacUsers(normalizedUsers);
        setSelectedUserId((current) =>
          normalizedUsers.some((user) => user.id === current)
            ? current
            : normalizedUsers[0]?.id ?? ""
        );
      })
      .catch((err) => {
        if (!cancelled) {
          setUserLoadError(err instanceof Error ? err.message : "Could not load users");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setUsersLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (grants.length === 0 && effectivePermissions.length === 0) {
    return <div className="empty-state rbac-empty">No RBAC details returned for this object.</div>;
  }

  return (
    <div className="rbac-panel">
      {effectivePermissions.length > 0 && (
        <div className="rbac-section">
          <div className="rbac-section-heading">
            <h4>Effective access</h4>
            <span>Current token</span>
          </div>
          <PermissionChips privileges={effectivePermissions} inherited={false} />
        </div>
      )}
      <div className="rbac-section">
        <div className="rbac-section-heading">
          <h4>User effective access</h4>
          <span>{selectableUsers.length} users</span>
        </div>
        <label className="effective-access-control">
          <span>User</span>
          <select
            value={effectiveSelectedUserId}
            onChange={(event) => setSelectedUserId(event.target.value)}
            disabled={selectableUsers.length === 0}
          >
            {selectableUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
        {usersLoading && <div className="rbac-empty-row">Loading users</div>}
        {userLoadError && <div className="rbac-empty-row">User list unavailable: {userLoadError}</div>}
        {!selectedUser ? (
          <div className="rbac-empty-row">No users returned for access calculation.</div>
        ) : (
          <div className="effective-access-card">
            <div className="rbac-principal">
              <strong>{selectedUser.name}</strong>
              <span>
                {selectedUser.roles.length > 0
                  ? `${selectedUser.roles.length} roles considered`
                  : "No roles returned for this user"}
              </span>
            </div>
            {userEffectivePrivileges.length > 0 ? (
              <EffectivePermissionChips privileges={userEffectivePrivileges} />
            ) : (
              <div className="rbac-empty-row">No direct or role-derived assignments on this object.</div>
            )}
            {userEffectiveAccess.length > 0 && (
              <div className="effective-access-breakdown">
                {userEffectiveAccess.map((entry) => (
                  <div
                    className={entry.inherited ? "rbac-grant inherited" : "rbac-grant explicit"}
                    key={entry.key}
                  >
                    <div className="rbac-principal">
                      <strong>{entry.label}</strong>
                      <span>{entry.detail}</span>
                    </div>
                    <PermissionChips privileges={entry.privileges} inherited={entry.inherited} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <GrantSection title="Users" grants={users} emptyText="No user assignments returned." />
      <GrantSection title="Roles" grants={roles} emptyText="No role assignments returned." />
    </div>
  );
}

function GrantSection({
  title,
  grants,
  emptyText
}: {
  title: string;
  grants: NormalizedGrant[];
  emptyText: string;
}) {
  return (
    <div className="rbac-section">
      <div className="rbac-section-heading">
        <h4>{title}</h4>
        <span>{grants.length} assignments</span>
      </div>
      {grants.length === 0 ? (
        <div className="rbac-empty-row">{emptyText}</div>
      ) : (
        <div className="rbac-grant-list">
          {grants.map((grant) => (
            <div
              className={grant.inherited ? "rbac-grant inherited" : "rbac-grant explicit"}
              key={`${grant.type}-${grant.id}-${grant.name}`}
            >
              <div className="rbac-principal">
                <strong>{grant.name}</strong>
                <span>{grant.inherited ? inheritedLabel(grant) : "Explicit assignment"}</span>
              </div>
              <PermissionChips privileges={grant.privileges} inherited={grant.inherited} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PermissionChips({
  privileges,
  inherited
}: {
  privileges: string[];
  inherited: boolean;
}) {
  return (
    <div className="permission-chips">
      {privileges.map((privilege) => (
        <span className={inherited ? "permission-chip inherited" : "permission-chip explicit"} key={privilege}>
          {privilege}
        </span>
      ))}
    </div>
  );
}

function EffectivePermissionChips({ privileges }: { privileges: EffectivePrivilege[] }) {
  return (
    <div className="permission-chips">
      {privileges.map((privilege) => (
        <span
          className={privilege.inherited ? "permission-chip inherited" : "permission-chip explicit"}
          key={privilege.privilege}
        >
          {privilege.privilege}
        </span>
      ))}
    </div>
  );
}

function normalizeGrants(permissions: ObjectDetails["permissions"]): NormalizedGrant[] {
  const payload = permissions && !Array.isArray(permissions) ? permissions : {};
  const grants = Array.isArray(payload.grants) ? payload.grants : [];
  return grants
    .filter(isRecord)
    .map((grant) => {
      const typedGrant = grant as RbacGrant;
      const granteeType = String(typedGrant.granteeType ?? typedGrant.type ?? "OTHER").toUpperCase();
      const type = granteeType === "USER" || granteeType === "ROLE" ? granteeType : "OTHER";
      return {
        id: String(typedGrant.id ?? typedGrant.name ?? "unknown"),
        name: principalName(typedGrant),
        type,
        privileges: normalizePrivilegeList(typedGrant.privileges ?? typedGrant.permissions ?? []),
        inherited: isInheritedGrant(typedGrant),
        inheritedFrom: inheritedFrom(typedGrant)
      };
    });
}

function normalizeEffectivePermissions(permissions: ObjectDetails["permissions"]) {
  if (Array.isArray(permissions)) {
    return normalizePrivilegeList(permissions);
  }
  if (permissions && Array.isArray(permissions.effectivePermissions)) {
    return normalizePrivilegeList(permissions.effectivePermissions);
  }
  if (permissions && Array.isArray(permissions.permissions)) {
    return normalizePrivilegeList(permissions.permissions);
  }
  return [];
}

function normalizeRbacUsers(items: AdminItem[]): RbacUser[] {
  return items.map((item) => {
    const name = adminItemName(item, "User");
    const email = stringValue(item.email ?? item.userName ?? item.username);
    return {
      id: stringValue(item.id ?? email ?? name) ?? name,
      name,
      email: email ?? undefined,
      roles: roleRefsFromUser(item)
    };
  });
}

function mergeRbacUsers(adminUsers: RbacUser[], userGrants: NormalizedGrant[]) {
  const merged = new Map<string, RbacUser>();
  adminUsers.forEach((user) => merged.set(user.id, user));
  userGrants.forEach((grant) => {
    const existing = Array.from(merged.values()).find((user) => principalMatchesUser(grant, user));
    if (!existing) {
      merged.set(grant.id, { id: grant.id, name: grant.name, roles: [] });
    }
  });
  return Array.from(merged.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function roleRefsFromUser(item: AdminItem): PrincipalRef[] {
  const roleFields = [item.roles, item.memberOf, item.roleIds, item.roleNames, item.role];
  return roleFields.flatMap(roleRefsFromValue).filter((role) => role.id || role.name);
}

function roleRefsFromValue(value: unknown): PrincipalRef[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(roleRefsFromValue);
  }
  if (typeof value === "string") {
    return [{ id: value, name: value }];
  }
  if (isRecord(value)) {
    const id = stringValue(value.id ?? value.roleId ?? value.name);
    const name = stringValue(value.name ?? value.roleName ?? value.id);
    return [{ id: id ?? undefined, name: name ?? undefined }];
  }
  return [];
}

function effectiveAccessForUser(user: RbacUser, grants: NormalizedGrant[]): EffectiveAccessEntry[] {
  const entries: EffectiveAccessEntry[] = [];
  grants.forEach((grant) => {
    if (grant.type === "USER" && principalMatchesUser(grant, user)) {
      entries.push({
        key: `user-${grant.id}-${grant.name}`,
        label: "Direct assignment",
        detail: grant.inherited ? inheritedLabel(grant) : "Explicit assignment",
        privileges: grant.privileges,
        inherited: grant.inherited
      });
    }
    if (grant.type === "ROLE") {
      const matchingRole = user.roles.find((role) => principalMatchesRole(grant, role));
      if (matchingRole) {
        entries.push({
          key: `role-${grant.id}-${grant.name}`,
          label: `Role: ${matchingRole.name ?? grant.name}`,
          detail: grant.inherited ? inheritedLabel(grant) : "Explicit role assignment",
          privileges: grant.privileges,
          inherited: grant.inherited
        });
      }
    }
  });
  return entries;
}

function aggregateEffectivePrivileges(entries: EffectiveAccessEntry[]): EffectivePrivilege[] {
  const privileges = new Map<string, boolean>();
  entries.forEach((entry) => {
    entry.privileges.forEach((privilege) => {
      const currentInherited = privileges.get(privilege);
      privileges.set(privilege, currentInherited === undefined ? entry.inherited : currentInherited && entry.inherited);
    });
  });
  return Array.from(privileges.entries())
    .map(([privilege, inherited]) => ({ privilege, inherited }))
    .sort((left, right) => left.privilege.localeCompare(right.privilege));
}

function principalMatchesUser(grant: NormalizedGrant, user: RbacUser) {
  const userKeys = [user.id, user.name, user.email].map(normalizePrincipalKey).filter(Boolean);
  const grantKeys = [grant.id, grant.name].map(normalizePrincipalKey).filter(Boolean);
  return grantKeys.some((key) => userKeys.includes(key));
}

function principalMatchesRole(grant: NormalizedGrant, role: PrincipalRef) {
  const roleKeys = [role.id, role.name].map(normalizePrincipalKey).filter(Boolean);
  const grantKeys = [grant.id, grant.name].map(normalizePrincipalKey).filter(Boolean);
  return grantKeys.some((key) => roleKeys.includes(key));
}

function normalizePrincipalKey(value: string | undefined) {
  return value?.trim().toLowerCase();
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizePrivilegeList(value: unknown) {
  return Array.isArray(value) ? value.map(String).sort() : [];
}

function principalName(grant: RbacGrant) {
  const fullName = [grant.firstName, grant.lastName].filter(Boolean).join(" ");
  return String(grant.name ?? (fullName || grant.email || grant.id || "Unknown principal"));
}

function isInheritedGrant(grant: RbacGrant) {
  if (typeof grant.inherited === "boolean") {
    return grant.inherited;
  }
  if (typeof grant.isInherited === "boolean") {
    return grant.isInherited;
  }
  if (grant.inheritedFrom) {
    return true;
  }
  return typeof grant.source === "string" && grant.source.toUpperCase() === "INHERITED";
}

function inheritedFrom(grant: RbacGrant) {
  if (Array.isArray(grant.path)) {
    return grant.path.join(".");
  }
  if (typeof grant.inheritedFrom === "string") {
    return grant.inheritedFrom;
  }
  if (isRecord(grant.inheritedFrom) && Array.isArray(grant.inheritedFrom.path)) {
    return grant.inheritedFrom.path.map(String).join(".");
  }
  return undefined;
}

function inheritedLabel(grant: NormalizedGrant) {
  return grant.inheritedFrom ? `Inherited from ${grant.inheritedFrom}` : "Inherited assignment";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function CatalogTreeNode({
  item,
  depth,
  selectedId,
  childrenById,
  expandedIds,
  loadingChildrenIds,
  filter,
  onSelect,
  onToggle
}: {
  item: CatalogItem;
  depth: number;
  selectedId: string | undefined;
  childrenById: Record<string, CatalogItem[]>;
  expandedIds: Set<string>;
  loadingChildrenIds: Set<string>;
  filter: string;
  onSelect: (item: CatalogItem) => void;
  onToggle: (item: CatalogItem) => void;
}) {
  const expanded = expandedIds.has(item.id);
  const loading = loadingChildrenIds.has(item.id);
  const expandable = isExpandable(item);
  const children = filterTree(childrenById[item.id] ?? [], childrenById, filter);
  const Icon = iconForItem(item, expanded);

  return (
    <div className="tree-node">
      <div
        className={selectedId === item.id ? "tree-row selected" : "tree-row"}
        style={{ paddingLeft: `${depth * 18 + 8}px` }}
      >
        <button
          className="tree-toggle"
          type="button"
          onClick={() => onToggle(item)}
          disabled={!expandable}
          title={expanded ? "Collapse" : "Expand"}
        >
          {loading ? (
            <Loader2 className="spin" size={15} />
          ) : expandable ? (
            expanded ? (
              <ChevronDown size={15} />
            ) : (
              <ChevronRight size={15} />
            )
          ) : (
            <span className="tree-spacer" />
          )}
        </button>
        <button className="tree-label" type="button" onClick={() => onSelect(item)}>
          <Icon size={17} />
          <span>{displayName(item)}</span>
          <small>{objectTypeLabel(item)}</small>
        </button>
      </div>
      {expanded && children.length > 0 && (
        <div className="tree-children">
          {children.map((child) => (
            <CatalogTreeNode
              key={child.id}
              item={child}
              depth={depth + 1}
              selectedId={selectedId}
              childrenById={childrenById}
              expandedIds={expandedIds}
              loadingChildrenIds={loadingChildrenIds}
              filter={filter}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
      {expanded && childrenById[item.id]?.length === 0 && !loading && (
        <div className="tree-empty" style={{ paddingLeft: `${(depth + 1) * 18 + 36}px` }}>
          No visible children
        </div>
      )}
    </div>
  );
}

function isExpandable(item: CatalogItem) {
  const type = item.type.toUpperCase();
  const containerType = item.container_type?.toUpperCase();
  return (
    type === "CONTAINER" ||
    type === "SOURCE" ||
    type === "SPACE" ||
    type === "FOLDER" ||
    containerType === "SOURCE" ||
    containerType === "SPACE" ||
    containerType === "FOLDER" ||
    containerType === "HOME"
  );
}

function iconForItem(item: CatalogItem, expanded: boolean) {
  const containerType = item.container_type?.toUpperCase() ?? "";
  const label = rawObjectTypeLabel(item).toUpperCase();

  if (isSourceItem(item)) {
    const sourceKind = classifySource(item);
    if (sourceKind === "s3") {
      return Cloud;
    }
    if (sourceKind === "catalog") {
      return Library;
    }
    return Database;
  }
  if (containerType === "SPACE") {
    return Library;
  }
  if (containerType === "HOME") {
    return Home;
  }
  if (label.includes("FOLDER")) {
    return expanded ? FolderOpen : Folder;
  }
  if (label.includes("VIEW")) {
    return Eye;
  }
  if (label.includes("DATASET") || label.includes("TABLE")) {
    return Table2;
  }
  if (label.includes("FILE")) {
    return FileText;
  }
  return File;
}

function objectTypeLabel(item: CatalogItem) {
  if (isSourceItem(item)) {
    return sourceTypeLabel(item);
  }
  const label = rawObjectTypeLabel(item);
  return titleCase(label);
}

function rawObjectTypeLabel(item: CatalogItem) {
  return item.container_type ?? item.type;
}

function isSourceItem(item: CatalogItem) {
  return item.type.toUpperCase() === "SOURCE" || item.container_type?.toUpperCase() === "SOURCE";
}

function sourceTypeLabel(item: CatalogItem) {
  const sourceType = item.source_type?.trim();
  const sourceKind = classifySource(item);
  if (sourceKind === "catalog") {
    return "Catalog";
  }
  if (sourceKind === "s3") {
    return "S3";
  }
  if (sourceKind === "sql") {
    return "SQL";
  }
  return sourceType ? titleCase(sourceType) : "Source";
}

function classifySource(item: CatalogItem): "catalog" | "s3" | "sql" | "source" {
  const descriptor = `${item.source_type ?? ""} ${displayName(item)}`.toUpperCase();
  if (/\bS3\b|AMAZON_S3|AWS_S3/.test(descriptor)) {
    return "s3";
  }
  if (
    descriptor.includes("OPEN_CATALOG") ||
    descriptor.includes("OPENCATALOG") ||
    descriptor.includes("NESSIE") ||
    descriptor.includes("ARCTIC") ||
    descriptor.includes("CATALOG")
  ) {
    return "catalog";
  }
  if (
    descriptor.includes("SQL") ||
    descriptor.includes("JDBC") ||
    descriptor.includes("POSTGRES") ||
    descriptor.includes("MYSQL") ||
    descriptor.includes("MSSQL") ||
    descriptor.includes("ORACLE") ||
    descriptor.includes("SNOWFLAKE") ||
    descriptor.includes("REDSHIFT") ||
    descriptor.includes("BIGQUERY") ||
    descriptor.includes("TERADATA") ||
    descriptor.includes("DB2")
  ) {
    return "sql";
  }
  return "source";
}

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayName(item: CatalogItem) {
  return item.path.at(-1) ?? item.id;
}

function filterTree(
  items: CatalogItem[],
  childrenById: Record<string, CatalogItem[]>,
  filter: string
): CatalogItem[] {
  const term = filter.trim().toLowerCase();
  if (!term) {
    return items;
  }
  return items.filter((item) => {
    const ownMatch =
      item.path.join(".").toLowerCase().includes(term) ||
      objectTypeLabel(item).toLowerCase().includes(term);
    const childMatch = filterTree(childrenById[item.id] ?? [], childrenById, filter).length > 0;
    return ownMatch || childMatch;
  });
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
  const [rbacUserId, setRbacUserId] = useState("");
  const [sql, setSql] = useState("");
  const [answer, setAnswer] = useState<QnaResponse | null>(null);
  const [jobId, setJobId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function ask() {
    setLoading(true);
    setError("");
    try {
      const response = await api.qna(
        question,
        selectedObject?.id,
        [],
        rbacUserId.trim() || undefined
      );
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
        <label>
          RBAC user or email
          <input
            value={rbacUserId}
            onChange={(event) => setRbacUserId(event.target.value)}
            placeholder="Optional, for permission provenance questions"
          />
        </label>
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
  const [selectedItem, setSelectedItem] = useState<AdminItem | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const response = await load();
      setItems(response.items);
      setSelectedItem((current) => current ?? response.items[0] ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not load ${title}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [load, title]);

  const filteredItems = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) {
      return items;
    }
    return items.filter((item) => JSON.stringify(item).toLowerCase().includes(term));
  }, [filter, items]);

  const Icon = adminIcon(title);

  return (
    <section className="catalog-layout admin-layout">
      <div className="catalog-browser">
        <div className="catalog-header">
          <div>
            <h2>{title}</h2>
            <span>{items.length} records</span>
          </div>
          <div className="admin-header-actions">
            <span className="readonly">Read-only</span>
            <button type="button" onClick={refresh} title={`Refresh ${title.toLowerCase()}`}>
              <RefreshCw size={16} />
            </button>
          </div>
        </div>
        <label className="search-box catalog-search">
          <Search size={16} />
          <input
            placeholder={`Filter ${title.toLowerCase()}`}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
        {error && <div className="error">{error}</div>}
        <div className="tree-shell">
          {loading && <div className="tree-status">Loading {title.toLowerCase()}</div>}
          {!loading && filteredItems.length === 0 && (
            <div className="tree-status">No {title.toLowerCase()} match the filter.</div>
          )}
          {filteredItems.map((item, index) => (
            <div
              className={selectedItem === item ? "tree-row selected" : "tree-row"}
              key={adminItemKey(item, index)}
            >
              <span className="tree-toggle">
                <span className="tree-spacer" />
              </span>
              <button className="tree-label admin-tree-label" type="button" onClick={() => setSelectedItem(item)}>
                <Icon size={17} />
                <span>{adminItemName(item, title)}</span>
                <small>{adminItemSubtitle(item)}</small>
              </button>
            </div>
          ))}
        </div>
      </div>

      <aside className="info-panel">
        <div className="info-panel-header">
          <div className="info-panel-icon">
            <Icon size={18} />
          </div>
          <div>
            <h2>{selectedItem ? adminItemName(selectedItem, title) : `${title} Info`}</h2>
            <span>{selectedItem ? adminItemSubtitle(selectedItem) : `Select a ${title.toLowerCase()} record`}</span>
          </div>
        </div>
        {selectedItem ? (
          <div className="info-panel-body">
            <div className="metric-row">
              <InfoPill label="Name" value={adminItemName(selectedItem, title)} />
              <InfoPill label="ID" value={String(selectedItem.id ?? "None")} />
              <InfoPill label="Type" value={adminItemSubtitle(selectedItem)} />
            </div>
            <h3>Details</h3>
            <pre>{JSON.stringify(selectedItem, null, 2)}</pre>
          </div>
        ) : (
          <div className="empty-state">Choose a {title.toLowerCase()} record.</div>
        )}
      </aside>
    </section>
  );
}

function adminIcon(title: string) {
  if (title === "Users") {
    return Users;
  }
  if (title === "Roles") {
    return Shield;
  }
  return Gauge;
}

function adminItemKey(item: AdminItem, index: number) {
  return String(item.id ?? item.name ?? item.email ?? index);
}

function adminItemName(item: AdminItem, fallback: string) {
  return String(
    item.name ??
      item.userName ??
      item.username ??
      item.email ??
      item.displayName ??
      item.id ??
      fallback
  );
}

function adminItemSubtitle(item: AdminItem) {
  if ("identityType" in item || "source" in item || "authProvider" in item) {
    return userOriginLabel(item);
  }
  return String(
    item.type ??
      item.identityType ??
      item.status ??
      item.state ??
      item.engineState ??
      "Record"
  );
}

function userOriginLabel(item: AdminItem) {
  const source = String(item.source ?? item.authProvider ?? item.provider ?? "").toLowerCase();
  const identityType = String(item.identityType ?? "").toUpperCase();
  if (source) {
    return source.includes("local") || source.includes("internal") ? "Internal" : "External";
  }
  if (identityType === "REGULAR_USER" || identityType === "SERVICE_USER") {
    return "Internal";
  }
  if (identityType) {
    return "External";
  }
  return "Unknown origin";
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
