import re
from typing import Any

from backend.app.dremio import DremioClient, DremioError
from backend.app.models import (
    CatalogItem,
    RbacExplanationResponse,
    RbacGrantExplanation,
    RbacPrincipal,
)


async def explain_rbac_access(
    client: DremioClient,
    object_id: str,
    user_id: str,
) -> RbacExplanationResponse:
    catalog_object = await client.get_catalog_object(object_id)
    object_path = _path_from_object(catalog_object)
    object_chain = await _resolve_object_chain(client, object_path, object_id)
    users = await client.list_users()
    user = _find_user(users, user_id)
    user_principal = _principal_from_user(user, user_id)
    roles = _role_refs_from_user(user)
    unresolved: list[str] = []

    if not user:
        unresolved.append(f"User {user_id} was not returned by Dremio user listing.")
    if not roles:
        unresolved.append(
            "No role membership was returned for this user; role-derived access may be incomplete."
        )
    if not object_chain:
        unresolved.append("Could not resolve parent objects; inherited grants may be incomplete.")

    grants: list[RbacGrantExplanation] = []
    for item in object_chain:
        permissions = await _safe_permissions(client, item.id)
        for grant in _grant_records(permissions):
            grants.extend(
                _matching_grant_explanations(grant, item, object_id, user_principal, roles)
            )

    effective_privileges = sorted({grant.privilege for grant in grants})
    return RbacExplanationResponse(
        object_id=object_id,
        object_path=object_path,
        user=user_principal,
        roles=roles,
        effective_privileges=effective_privileges,
        grants=_dedupe_grants(grants),
        unresolved=unresolved,
    )


def question_has_rbac_intent(question: str) -> bool:
    normalized = question.lower()
    terms = [
        "access",
        "grant",
        "grantee",
        "permission",
        "permissions",
        "privilege",
        "privileges",
        "rbac",
        "role",
        "roles",
        "user",
        "users",
    ]
    return any(term in normalized for term in terms)


async def explain_object_rbac_context(
    client: DremioClient,
    object_id: str,
    question: str,
) -> dict[str, Any]:
    catalog_object = await client.get_catalog_object(object_id)
    object_path = _path_from_object(catalog_object)
    object_chain = await _resolve_object_chain(client, object_path, object_id)
    users = await client.list_users()
    inferred_user = infer_user_from_question(question, users)
    roles = await _safe_list_roles(client)
    unresolved: list[str] = []

    if not object_chain:
        unresolved.append("Could not resolve parent objects; inherited grants may be incomplete.")

    object_grants: list[dict[str, Any]] = []
    for item in object_chain:
        permissions = await _safe_permissions(client, item.id)
        for grant in _grant_records(permissions):
            object_grants.extend(
                _object_grant_explanations(grant, item, selected_object_id=object_id)
            )

    context: dict[str, Any] = {
        "mode": "user" if inferred_user else "object",
        "object_id": object_id,
        "object_path": object_path,
        "inferred_user": _public_user(inferred_user) if inferred_user else None,
        "object_grants": _dedupe_object_grants(object_grants),
        "users": [_public_user(user) for user in users],
        "roles": [_public_principal(role) for role in roles],
        "unresolved": unresolved,
    }

    if inferred_user:
        user_key = _string_value(inferred_user.get("id")) or _string_value(
            inferred_user.get("email")
            or inferred_user.get("userName")
            or inferred_user.get("username")
            or inferred_user.get("name")
        )
        if user_key:
            context["user_provenance"] = (
                await explain_rbac_access(client, object_id, user_key)
            ).model_dump()
        else:
            unresolved.append("A user was inferred from the prompt, but it has no usable id or email.")

    return context


def infer_user_from_question(
    question: str,
    users: list[dict[str, Any]],
) -> dict[str, Any] | None:
    normalized_question = _principal_key(question)
    question_tokens = set(re.findall(r"[a-z0-9_.@+-]+", normalized_question))
    for user in users:
        for key in _user_lookup_values(user):
            normalized_key = _principal_key(key)
            if not normalized_key:
                continue
            if len(normalized_key) < 3 and normalized_key in question_tokens:
                return user
            if len(normalized_key) >= 3 and normalized_key in normalized_question:
                return user
    return None


async def _resolve_object_chain(
    client: DremioClient,
    object_path: list[str],
    object_id: str,
) -> list[CatalogItem]:
    try:
        return await client.resolve_catalog_path(object_path, object_id)
    except (DremioError, AttributeError):
        return [CatalogItem(id=object_id, path=object_path, type="unknown")]


async def _safe_permissions(client: DremioClient, object_id: str) -> dict[str, Any]:
    permissions = await client.get_catalog_permissions(object_id)
    return permissions if isinstance(permissions, dict) else {}


async def _safe_list_roles(client: DremioClient) -> list[dict[str, Any]]:
    try:
        return await client.list_roles()
    except (DremioError, AttributeError):
        return []


def _object_grant_explanations(
    grant: dict[str, Any],
    item: CatalogItem,
    selected_object_id: str,
) -> list[dict[str, Any]]:
    privileges = _privileges_from_grant(grant)
    if not privileges:
        return []
    grantee_type = str(grant.get("granteeType") or grant.get("type") or "UNKNOWN").upper()
    return [
        {
            "privilege": privilege,
            "grantee_type": grantee_type,
            "grantee_id": _string_value(grant.get("id")),
            "grantee_name": _string_value(grant.get("name")),
            "grantee_email": _string_value(grant.get("email")),
            "grant_object_id": item.id,
            "grant_object_path": item.path,
            "inherited": item.id != selected_object_id or _is_inherited_grant(grant),
            "explicit": True,
        }
        for privilege in privileges
    ]


def _matching_grant_explanations(
    grant: dict[str, Any],
    item: CatalogItem,
    selected_object_id: str,
    user: RbacPrincipal,
    roles: list[RbacPrincipal],
) -> list[RbacGrantExplanation]:
    grantee_type = str(grant.get("granteeType") or grant.get("type") or "").upper()
    privileges = _privileges_from_grant(grant)
    if not privileges:
        return []

    if grantee_type == "USER" and _principal_matches(grant, user):
        return [
            _grant_explanation(
                privilege=privilege,
                source="direct",
                grant=grant,
                item=item,
                selected_object_id=selected_object_id,
            )
            for privilege in privileges
        ]

    if grantee_type == "ROLE":
        matching_role = next((role for role in roles if _principal_matches(grant, role)), None)
        if matching_role:
            return [
                _grant_explanation(
                    privilege=privilege,
                    source="role",
                    grant=grant,
                    item=item,
                    selected_object_id=selected_object_id,
                    via_role=matching_role,
                )
                for privilege in privileges
            ]

    return []


def _grant_explanation(
    *,
    privilege: str,
    source: str,
    grant: dict[str, Any],
    item: CatalogItem,
    selected_object_id: str,
    via_role: RbacPrincipal | None = None,
) -> RbacGrantExplanation:
    return RbacGrantExplanation(
        privilege=privilege,
        source=source,
        grantee_type=str(grant.get("granteeType") or grant.get("type") or "UNKNOWN").upper(),
        grantee_id=_string_value(grant.get("id")),
        grantee_name=_string_value(grant.get("name")),
        grant_object_id=item.id,
        grant_object_path=item.path,
        inherited=item.id != selected_object_id or _is_inherited_grant(grant),
        via_role_id=via_role.id if via_role else None,
        via_role_name=via_role.name if via_role else None,
    )


def _grant_records(permissions: dict[str, Any]) -> list[dict[str, Any]]:
    grants = permissions.get("grants", [])
    return [grant for grant in grants if isinstance(grant, dict)]


def _privileges_from_grant(grant: dict[str, Any]) -> list[str]:
    privileges = grant.get("privileges") or grant.get("permissions") or []
    if not isinstance(privileges, list):
        return []
    return sorted(str(privilege) for privilege in privileges)


def _find_user(users: list[dict[str, Any]], user_id: str) -> dict[str, Any] | None:
    needle = _principal_key(user_id)
    for user in users:
        keys = _user_lookup_values(user)
        if needle in {_principal_key(key) for key in keys if key is not None}:
            return user
    return None


def _principal_from_user(user: dict[str, Any] | None, fallback: str) -> RbacPrincipal:
    if not user:
        return RbacPrincipal(id=fallback, name=fallback)
    email = _string_value(user.get("email") or user.get("userName") or user.get("username"))
    name = _string_value(
        user.get("name") or user.get("displayName") or user.get("userName") or user.get("username")
    )
    return RbacPrincipal(
        id=_string_value(user.get("id")) or email or name,
        name=name or email or _string_value(user.get("id")),
        email=email,
    )


def _role_refs_from_user(user: dict[str, Any] | None) -> list[RbacPrincipal]:
    if not user:
        return []
    role_values = [
        user.get("roles"),
        user.get("memberOf"),
        user.get("roleIds"),
        user.get("roleNames"),
        user.get("role"),
    ]
    roles: list[RbacPrincipal] = []
    for value in role_values:
        roles.extend(_role_refs_from_value(value))
    return _dedupe_principals(roles)


def _role_refs_from_value(value: Any) -> list[RbacPrincipal]:
    if not value:
        return []
    if isinstance(value, list):
        roles: list[RbacPrincipal] = []
        for item in value:
            roles.extend(_role_refs_from_value(item))
        return roles
    if isinstance(value, str):
        return [RbacPrincipal(id=value, name=value)]
    if isinstance(value, dict):
        role_id = _string_value(value.get("id") or value.get("roleId") or value.get("name"))
        role_name = _string_value(value.get("name") or value.get("roleName") or value.get("id"))
        return [RbacPrincipal(id=role_id, name=role_name)]
    return []


def _principal_matches(grant: dict[str, Any], principal: RbacPrincipal) -> bool:
    grant_keys = {
        _principal_key(value)
        for value in [grant.get("id"), grant.get("name"), grant.get("email")]
        if value is not None
    }
    principal_keys = {
        _principal_key(value)
        for value in [principal.id, principal.name, principal.email]
        if value is not None
    }
    return bool(grant_keys & principal_keys)


def _path_from_object(catalog_object: dict[str, Any]) -> list[str]:
    path = catalog_object.get("path")
    return [str(part) for part in path] if isinstance(path, list) else []


def _is_inherited_grant(grant: dict[str, Any]) -> bool:
    if isinstance(grant.get("inherited"), bool):
        return bool(grant["inherited"])
    if isinstance(grant.get("isInherited"), bool):
        return bool(grant["isInherited"])
    if grant.get("inheritedFrom"):
        return True
    return str(grant.get("source") or "").upper() == "INHERITED"


def _dedupe_grants(grants: list[RbacGrantExplanation]) -> list[RbacGrantExplanation]:
    deduped: dict[tuple[str, str, str | None, str, str], RbacGrantExplanation] = {}
    for grant in grants:
        key = (
            grant.privilege,
            grant.source,
            grant.via_role_id or grant.via_role_name,
            grant.grant_object_id,
            grant.grantee_id or grant.grantee_name or "",
        )
        deduped[key] = grant
    return sorted(
        deduped.values(),
        key=lambda grant: (
            grant.grant_object_path,
            grant.source,
            grant.via_role_name or "",
            grant.privilege,
        ),
    )


def _dedupe_principals(principals: list[RbacPrincipal]) -> list[RbacPrincipal]:
    deduped: dict[str, RbacPrincipal] = {}
    for principal in principals:
        key = _principal_key(principal.id or principal.name or principal.email or "")
        if key:
            deduped[key] = principal
    return sorted(deduped.values(), key=lambda principal: principal.name or principal.id or "")


def _dedupe_object_grants(grants: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[tuple[str, str, str, str, str], dict[str, Any]] = {}
    for grant in grants:
        key = (
            str(grant.get("privilege") or ""),
            str(grant.get("grantee_type") or ""),
            str(grant.get("grantee_id") or grant.get("grantee_name") or ""),
            str(grant.get("grant_object_id") or ""),
            str(grant.get("inherited") or ""),
        )
        deduped[key] = grant
    return sorted(
        deduped.values(),
        key=lambda grant: (
            grant.get("grant_object_path") or [],
            str(grant.get("grantee_type") or ""),
            str(grant.get("grantee_name") or grant.get("grantee_id") or ""),
            str(grant.get("privilege") or ""),
        ),
    )


def _public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _string_value(user.get("id")),
        "name": _string_value(user.get("name") or user.get("displayName")),
        "email": _string_value(user.get("email") or user.get("userName") or user.get("username")),
        "roles": [role.model_dump() for role in _role_refs_from_user(user)],
    }


def _public_principal(principal: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _string_value(principal.get("id") or principal.get("roleId")),
        "name": _string_value(principal.get("name") or principal.get("roleName")),
    }


def _user_lookup_values(user: dict[str, Any]) -> list[Any]:
    return [
        user.get("id"),
        user.get("name"),
        user.get("email"),
        user.get("userName"),
        user.get("username"),
        user.get("displayName"),
    ]


def _principal_key(value: Any) -> str:
    return str(value).strip().lower()


def _string_value(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None
