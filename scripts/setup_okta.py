#!/usr/bin/env python3
"""
Stand up the Okta side of the Riverbend Resident Portal demo.

Idempotent — safe to re-run. Creates or reconciles:

  1. Nine Riverbend groups (the persona matrix)
  2. A dedicated custom authorization server with 22 resident.* scopes
  3. email + resident_entitlement claims on its access tokens
  4. An access policy with two rules:
       · authorization_code / refresh_token for the portal web app
       · jwt-bearer for ID-JAG hop 2 (the agent exchanging an assertion)
  5. The portal OIDC web app (private_key_jwt, groups claim, group assignment)

The AI agent registration itself is not created here — see --agent-client-id.

Usage:
    python3 scripts/setup_okta.py                       # create/reconcile
    python3 scripts/setup_okta.py --agent-client-id X   # also wire the agent in
    python3 scripts/setup_okta.py --dry-run
"""
import argparse
import json
import sys
from pathlib import Path

from okta_common import (
    GROUP_REGEX,
    GROUPS,
    ROOT,
    SCOPE_NAMES,
    SCOPES,
    Okta,
    load_env,
    upsert_env,
    verify_token,
)

AS_NAME = "Riverbend Municipal Services"
APP_LABEL = "Riverbend Resident Portal"
POLICY_NAME = "Riverbend portal + agent"
RULE_PORTAL = "Portal sign-in (authorization_code)"
RULE_AGENT = "Riverbend agent (ID-JAG hop 2)"


def ensure_groups(okta: Okta, dry: bool) -> dict[str, str]:
    """Create the nine persona groups; return persona_id → Okta group id."""
    ids: dict[str, str] = {}
    for persona_id, name, description in GROUPS:
        status, found = okta.get(f"/api/v1/groups?q={name.replace(' ', '%20')}&limit=50")
        okta.require(status, found, "list groups")
        existing = next((g for g in found if g.get("profile", {}).get("name") == name), None)
        if existing:
            ids[persona_id] = existing["id"]
            print(f"  · group exists: {name}")
            continue
        if dry:
            print(f"  + would create group: {name}")
            continue
        status, created = okta.post(
            "/api/v1/groups", {"profile": {"name": name, "description": description}}
        )
        okta.require(status, created, f"create group {name}")
        ids[persona_id] = created["id"]
        print(f"  + created group: {name}")
    return ids


def ensure_authorization_server(okta: Okta, audience: str, dry: bool) -> dict:
    status, servers = okta.get("/api/v1/authorizationServers?limit=200")
    okta.require(status, servers, "list authorization servers")
    existing = next((s for s in servers if s.get("name") == AS_NAME), None)

    if existing:
        print(f"  · authorization server exists: {AS_NAME} ({existing['id']})")
        if audience not in existing.get("audiences", []):
            if dry:
                print(f"  ~ would add audience {audience}")
            else:
                body = {
                    "name": existing["name"],
                    "description": existing.get("description", AS_NAME),
                    "audiences": sorted(set(existing.get("audiences", []) + [audience])),
                }
                status, updated = okta.put(
                    f"/api/v1/authorizationServers/{existing['id']}", body
                )
                okta.require(status, updated, "update AS audiences")
                print(f"  ~ added audience {audience}")
        return existing

    if dry:
        print(f"  + would create authorization server: {AS_NAME} (audience {audience})")
        return {"id": "<new>", "issuer": "<new>"}

    status, created = okta.post(
        "/api/v1/authorizationServers",
        {
            "name": AS_NAME,
            "description": "Municipal services API for the Riverbend resident portal and its AI agent",
            "audiences": [audience],
            "issuerMode": "ORG_URL",
        },
    )
    okta.require(status, created, "create authorization server")
    print(f"  + created authorization server: {AS_NAME} ({created['id']})")
    return created


def ensure_scopes(okta: Okta, as_id: str, dry: bool) -> None:
    status, existing = okta.get(f"/api/v1/authorizationServers/{as_id}/scopes?limit=200")
    okta.require(status, existing, "list scopes")
    have = {s["name"] for s in existing}

    for name, description in SCOPES:
        if name in have:
            continue
        if dry:
            print(f"  + would create scope: {name}")
            continue
        status, created = okta.post(
            f"/api/v1/authorizationServers/{as_id}/scopes",
            {
                "name": name,
                "displayName": name,
                "description": description,
                "consent": "IMPLICIT",
                "metadataPublish": "ALL_CLIENTS",
            },
        )
        okta.require(status, created, f"create scope {name}")
        print(f"  + created scope: {name}")
    print(f"  · {len(have)} of {len(SCOPES)} scopes already present")


def ensure_claims(okta: Okta, as_id: str, dry: bool) -> None:
    """
    email and resident_entitlement on the access token.

    The portal keys authorization off the operator's identity, so a bearer token
    that carries neither claim cannot be mapped to a household — MCP calls would
    fail closed with no way to explain why.
    """
    wanted = [
        {
            "name": "email",
            "status": "ACTIVE",
            "claimType": "RESOURCE",
            "valueType": "EXPRESSION",
            "value": "user.email",
            "conditions": {"scopes": []},
            "alwaysIncludeInToken": True,
        },
        {
            "name": "resident_entitlement",
            "status": "ACTIVE",
            "claimType": "RESOURCE",
            "valueType": "GROUPS",
            "value": GROUP_REGEX,
            "group_filter_type": "REGEX",
            "conditions": {"scopes": []},
            "alwaysIncludeInToken": True,
        },
    ]

    status, existing = okta.get(f"/api/v1/authorizationServers/{as_id}/claims")
    okta.require(status, existing, "list claims")
    by_name = {c["name"]: c for c in existing}

    for claim in wanted:
        current = by_name.get(claim["name"])
        if dry:
            print(f"  {'~' if current else '+'} would {'update' if current else 'create'} claim: {claim['name']}")
            continue
        if current:
            status, updated = okta.put(
                f"/api/v1/authorizationServers/{as_id}/claims/{current['id']}", claim
            )
            okta.require(status, updated, f"update claim {claim['name']}")
            print(f"  ~ updated claim: {claim['name']}")
        else:
            status, created = okta.post(
                f"/api/v1/authorizationServers/{as_id}/claims", claim
            )
            okta.require(status, created, f"create claim {claim['name']}")
            print(f"  + created claim: {claim['name']}")


def ensure_policy(okta: Okta, as_id: str, client_ids: list[str], dry: bool) -> str:
    status, policies = okta.get(f"/api/v1/authorizationServers/{as_id}/policies")
    okta.require(status, policies, "list policies")
    existing = next((p for p in policies if p.get("name") == POLICY_NAME), None)
    clients = [c for c in client_ids if c] or ["ALL_CLIENTS"]

    body = {
        "type": "OAUTH_AUTHORIZATION_POLICY",
        "status": "ACTIVE",
        "name": POLICY_NAME,
        "description": "Portal sign-in and Riverbend agent delegation",
        "priority": 1,
        "conditions": {"clients": {"include": clients}},
    }

    if existing:
        merged = sorted(
            set(existing.get("conditions", {}).get("clients", {}).get("include", []))
            | set(clients)
        )
        # "ALL_CLIENTS" is a placeholder for the bootstrap pass; drop it once we
        # know the real client ids, or the policy stays wider than intended.
        if len(merged) > 1 and "ALL_CLIENTS" in merged:
            merged.remove("ALL_CLIENTS")
        body["conditions"]["clients"]["include"] = merged
        if dry:
            print(f"  ~ would update policy clients: {merged}")
            return existing["id"]
        status, updated = okta.put(
            f"/api/v1/authorizationServers/{as_id}/policies/{existing['id']}", body
        )
        okta.require(status, updated, "update policy")
        print(f"  ~ policy clients: {merged}")
        return existing["id"]

    if dry:
        print(f"  + would create policy: {POLICY_NAME} for {clients}")
        return "<new>"

    status, created = okta.post(f"/api/v1/authorizationServers/{as_id}/policies", body)
    okta.require(status, created, "create policy")
    print(f"  + created policy: {POLICY_NAME}")
    return created["id"]


def ensure_rules(okta: Okta, as_id: str, policy_id: str, dry: bool) -> None:
    status, rules = okta.get(
        f"/api/v1/authorizationServers/{as_id}/policies/{policy_id}/rules"
    )
    okta.require(status, rules, "list rules")
    by_name = {r.get("name"): r for r in rules}

    portal_rule = {
        "type": "RESOURCE_ACCESS",
        "name": RULE_PORTAL,
        "priority": 1,
        "conditions": {
            "people": {"users": {"exclude": [], "include": []}, "groups": {"include": ["EVERYONE"]}},
            "grantTypes": {"include": ["authorization_code", "implicit", "refresh_token"]},
            "scopes": {"include": SCOPE_NAMES},
        },
        "actions": {
            "token": {
                "accessTokenLifetimeMinutes": 60,
                "refreshTokenLifetimeMinutes": 0,
                "refreshTokenWindowMinutes": 10080,
            }
        },
    }

    # Hop 2 authenticates as the *agent*, not as the user, so the people
    # condition cannot be group-scoped — the scope ceiling is enforced by the
    # hop-1 assertion and again by the portal's persona cap.
    agent_rule = {
        "type": "RESOURCE_ACCESS",
        "name": RULE_AGENT,
        "priority": 2,
        "conditions": {
            "people": {"users": {"exclude": [], "include": []}, "groups": {"include": ["EVERYONE"]}},
            "grantTypes": {"include": ["urn:ietf:params:oauth:grant-type:jwt-bearer"]},
            "scopes": {"include": SCOPE_NAMES},
        },
        "actions": {
            "token": {
                "accessTokenLifetimeMinutes": 60,
                "refreshTokenLifetimeMinutes": 0,
                "refreshTokenWindowMinutes": 10080,
            }
        },
    }

    for rule in (portal_rule, agent_rule):
        current = by_name.get(rule["name"])
        base = f"/api/v1/authorizationServers/{as_id}/policies/{policy_id}/rules"
        if current:
            if dry:
                print(f"  ~ would update rule: {rule['name']}")
                continue
            status, updated = okta.put(f"{base}/{current['id']}", rule)
            okta.require(status, updated, f"update rule {rule['name']}")
            if current.get("status") == "INACTIVE":
                okta.post(f"{base}/{current['id']}/lifecycle/activate", None)
            print(f"  ~ updated rule: {rule['name']}")
            continue
        if dry:
            print(f"  + would create rule: {rule['name']}")
            continue
        status, created = okta.post(base, rule)
        okta.require(status, created, f"create rule {rule['name']}")
        print(f"  + created rule: {rule['name']}")


def ensure_oidc_app(okta: Okta, app_url: str, dry: bool) -> dict:
    """Portal web app using private_key_jwt with the key from scripts/gen-keys.mjs."""
    pub_path = ROOT / "secrets" / "app-sign-on-key.public.json"
    if not pub_path.exists():
        print(
            "✗ secrets/app-sign-on-key.public.json is missing. Run:  node scripts/gen-keys.mjs",
            file=sys.stderr,
        )
        sys.exit(1)
    jwk = json.loads(pub_path.read_text())

    redirect_uri = f"{app_url.rstrip('/')}/auth/oidc/callback"
    settings = {
        "oauthClient": {
            "client_uri": app_url,
            "redirect_uris": [redirect_uri, "http://localhost:3220/auth/oidc/callback"],
            "post_logout_redirect_uris": [app_url, "http://localhost:5175"],
            "response_types": ["code"],
            "grant_types": ["authorization_code", "refresh_token"],
            "application_type": "web",
            "consent_method": "TRUSTED",
            "issuer_mode": "ORG_URL",
            "jwks": {"keys": [jwk]},
            "groups_claim": {
                "type": "FILTER",
                "filter_type": "REGEX",
                "name": "groups",
                "value": GROUP_REGEX,
            },
        }
    }

    status, apps = okta.get(f"/api/v1/apps?q={APP_LABEL.replace(' ', '%20')}&limit=50")
    okta.require(status, apps, "list apps")
    existing = next((a for a in apps if a.get("label") == APP_LABEL), None)

    body = {
        "name": "oidc_client",
        "label": APP_LABEL,
        "signOnMode": "OPENID_CONNECT",
        "credentials": {"oauthClient": {"token_endpoint_auth_method": "private_key_jwt"}},
        "settings": settings,
    }

    if existing:
        if dry:
            print(f"  ~ would update app: {APP_LABEL} ({existing['id']})")
            return existing
        status, updated = okta.put(f"/api/v1/apps/{existing['id']}", body)
        if status != 200:
            print(
                f"  ! could not update the app automatically ({status}). "
                "Check the redirect URI and groups claim in the console.",
                file=sys.stderr,
            )
            print(json.dumps(updated, indent=2)[:800], file=sys.stderr)
            return existing
        print(f"  ~ updated app: {APP_LABEL}")
        return updated

    if dry:
        print(f"  + would create app: {APP_LABEL} → {redirect_uri}")
        return {"id": "<new>", "credentials": {"oauthClient": {"client_id": "<new>"}}}

    status, created = okta.post("/api/v1/apps", body)
    okta.require(status, created, "create OIDC app")
    print(f"  + created app: {APP_LABEL} ({created['id']})")
    return created


def assign_groups_to_app(okta: Okta, app_id: str, group_ids: dict[str, str], dry: bool) -> None:
    for persona_id, gid in group_ids.items():
        if dry:
            print(f"  + would assign group {persona_id} to the app")
            continue
        status, payload = okta.put(f"/api/v1/apps/{app_id}/groups/{gid}", {})
        if status not in (200, 201, 204):
            print(f"  ! could not assign group {persona_id} ({status}): {payload}", file=sys.stderr)
        else:
            print(f"  · assigned group: {persona_id}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--agent-client-id", help="Okta AI agent registration id used for ID-JAG")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--env", type=Path, default=ROOT / ".env")
    args = parser.parse_args()

    env = load_env(args.env)
    org = env.get("OKTA_ORG_URL", "").rstrip("/")
    token = env.get("OKTA_API_TOKEN", "").strip()
    app_url = env.get("APP_URL", "https://resident.skylarbarnes.com").rstrip("/")
    audience = env.get("OKTA_AUDIENCE") or f"{app_url}/mcp"

    if not org or not token:
        print("✗ Set OKTA_ORG_URL and OKTA_API_TOKEN in .env first.", file=sys.stderr)
        sys.exit(1)

    okta = Okta(org, token)
    verify_token(okta)
    print(f"Okta org: {org}")
    print(f"Portal:   {app_url}")
    print(f"Audience: {audience}\n")

    print("Groups")
    group_ids = ensure_groups(okta, args.dry_run)

    print("\nAuthorization server")
    server = ensure_authorization_server(okta, audience, args.dry_run)
    as_id = server["id"]
    issuer = server.get("issuer") or f"{org}/oauth2/{as_id}"

    print("\nScopes")
    ensure_scopes(okta, as_id, args.dry_run)

    print("\nClaims")
    ensure_claims(okta, as_id, args.dry_run)

    print("\nPortal OIDC app")
    app = ensure_oidc_app(okta, app_url, args.dry_run)
    client_id = app.get("credentials", {}).get("oauthClient", {}).get("client_id", "")

    if not args.dry_run and app.get("id", "").startswith("0oa"):
        print("\nGroup assignment")
        assign_groups_to_app(okta, app["id"], group_ids, args.dry_run)

    agent_client_id = args.agent_client_id or env.get("AGENT_CLIENT_ID", "")

    print("\nAccess policy")
    policy_id = ensure_policy(okta, as_id, [client_id, agent_client_id], args.dry_run)
    print("\nPolicy rules")
    ensure_rules(okta, as_id, policy_id, args.dry_run)

    if args.dry_run:
        print("\n(dry run — nothing was changed)")
        return

    updates = {
        "OKTA_ISSUER": issuer,
        "RESOURCE_AS_ISSUER": issuer,
        "OKTA_AUDIENCE": audience,
        "MCP_RESOURCE_URL": audience,
        "OKTA_OIDC_CLIENT_ID": client_id,
        "OKTA_GROUP_IDS": ",".join(f"{k}={v}" for k, v in group_ids.items()),
    }
    if agent_client_id:
        updates["AGENT_CLIENT_ID"] = agent_client_id
        updates["OKTA_AGENT_REGISTRATION_ID"] = agent_client_id
    upsert_env(updates, args.env)

    print("\n" + "=" * 72)
    print("Written to .env:")
    for key, value in updates.items():
        print(f"  {key}={value}")

    if not agent_client_id:
        print(
            "\nStill to do — the AI agent registration (ID-JAG):\n"
            "  1. Okta Admin Console → Applications → AI Agents → create a registration\n"
            "     for 'Riverbend Assistant'.\n"
            "  2. Give it the PUBLIC key from secrets/agent-private-key.public.json.\n"
            "  3. Connect it to the '" + AS_NAME + "' authorization server.\n"
            "  4. Re-run:  python3 scripts/setup_okta.py --agent-client-id <its id>\n"
            "     (that adds it to the access policy so hop 2 is allowed)."
        )
    print("\nThen: pnpm start   and check /health for agentDelegation.enabled=true")


if __name__ == "__main__":
    main()
