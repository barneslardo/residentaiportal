#!/usr/bin/env python3
"""
Register (or refresh) an MCP server in Okta's MCP Server catalog.

    POST /resource-servers/api/v1/mcp-servers   → 202 + Location
    GET  /resource-servers/api/v1/operations/{id}  (poll)

Okta discovers the server's name and scopes by fetching its RFC 9728 protected
resource metadata, so the endpoint must publish
`/.well-known/oauth-protected-resource` with `authorization_servers` populated
before this will succeed.

    python3 scripts/register_mcp_server.py --list
    python3 scripts/register_mcp_server.py --url https://resident.skylarbarnes.com/mcp \
        --name "Riverbend Resident Portal" --description "Municipal services"
    python3 scripts/register_mcp_server.py --delete <id>
    python3 scripts/register_mcp_server.py --refresh <id>     # delete + re-register
"""
import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from okta_common import Okta, load_env, verify_token  # noqa: E402

BASE = "/resource-servers/api/v1/mcp-servers"


def show(servers) -> None:
    rows = servers.get("data", servers) if isinstance(servers, dict) else servers
    print(f"{len(rows)} MCP server(s) registered\n")
    for s in rows:
        dm = s.get("detectedMetadata") or {}
        print(f"  {s.get('id')}  [{s.get('status')}]  asCount={s.get('authorizationServerCount')}")
        print(f"    url    {s.get('resourceUrl')}")
        print(f"    name   {s.get('displayName') or dm.get('resourceName') or '—'}")
        if dm.get("scopesSupported"):
            print(f"    scopes {len(dm['scopesSupported'])}: {', '.join(dm['scopesSupported'][:6])}"
                  + (" …" if len(dm["scopesSupported"]) > 6 else ""))
        if dm.get("lastRefreshedAt"):
            print(f"    seen   {dm['lastRefreshedAt']}")
        print()


def preflight(url: str) -> bool:
    """Check the PRM the way Okta will, so a failure names the real cause."""
    origin = "/".join(url.split("/")[:3])
    ok = True
    for probe in (
        f"{origin}/.well-known/oauth-protected-resource",
        f"{url.rstrip('/')}/.well-known/oauth-protected-resource",
    ):
        try:
            # Cloudflare in front of these hosts 403s the default Python-urllib
            # User-Agent, which would make a perfectly healthy endpoint look
            # unreachable. Send something ordinary.
            req = urllib.request.Request(probe, headers={"User-Agent": "okta-mcp-preflight/1.0"})
            with urllib.request.urlopen(req, timeout=15) as r:
                body = json.loads(r.read().decode())
            servers = body.get("authorization_servers") or []
            print(f"  ✓ {probe}")
            print(f"      resource              {body.get('resource')}")
            print(f"      authorization_servers {servers or '⚠ EMPTY'}")
            print(f"      scopes_supported      {len(body.get('scopes_supported') or [])}")
            if not servers:
                print("      ⚠ Okta rejects registration with 'No authorization servers found'")
                ok = False
            return ok
        except Exception as exc:  # noqa: BLE001
            print(f"  · {probe} → {exc}")
    print("  ✗ no protected-resource metadata found at either path")
    return False


def poll(okta: Okta, location: str) -> None:
    path = location if location.startswith("/") else "/" + location.split("/", 3)[-1]
    for attempt in range(30):
        st, out = okta.get(path)
        status = (out or {}).get("status") if isinstance(out, dict) else None
        if st != 200:
            print(f"  poll {path} → HTTP {st}: {json.dumps(out)[:300]}")
            return
        if status in ("SUCCESS", "COMPLETED", "DONE"):
            print(f"  ✓ operation {status}")
            return
        if status in ("FAILED", "ERROR"):
            print(f"  ✗ operation {status}: {json.dumps(out, indent=2)[:800]}")
            return
        time.sleep(2)
    print("  … still pending after 60s; check the console")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--url")
    ap.add_argument("--name")
    ap.add_argument("--description")
    ap.add_argument("--delete", metavar="ID")
    ap.add_argument("--refresh", metavar="ID")
    ap.add_argument("--preflight-only", action="store_true")
    args = ap.parse_args()

    env = load_env()
    okta = Okta(env["OKTA_ORG_URL"], env["OKTA_API_TOKEN"])
    verify_token(okta)

    if args.list:
        st, out = okta.get(BASE)
        okta.require(st, out, "list MCP servers")
        show(out)
        return

    if args.delete:
        st, out = okta.call("DELETE", f"{BASE}/{args.delete}")
        print(f"delete {args.delete} → HTTP {st} {json.dumps(out)[:200]}")
        return

    if args.refresh:
        st, existing = okta.get(f"{BASE}/{args.refresh}")
        if st != 200:
            sys.exit(f"cannot read {args.refresh}: {existing}")
        url = existing.get("resourceUrl")
        print(f"refreshing {args.refresh} ({url})")

        # Okta re-reads the protected-resource metadata only on registration —
        # activate/deactivate does not re-scrape it — so a stale entry has to be
        # replaced. Verify the endpoint is healthy BEFORE removing the old row,
        # otherwise a bad endpoint leaves the catalog empty.
        print("  checking the endpoint before removing the existing registration…")
        if not preflight(url):
            sys.exit("  ✗ endpoint is not registrable; leaving the existing entry alone.")

        st, out = okta.post(f"{BASE}/{args.refresh}/lifecycle/deactivate", {})
        print(f"  deactivate → HTTP {st}")
        if st in (200, 202, 204):
            time.sleep(3)

        st, out = okta.call("DELETE", f"{BASE}/{args.refresh}")
        print(f"  delete → HTTP {st}")
        if st in (200, 202, 204):
            time.sleep(3)
        if st not in (200, 202, 204):
            # Never fall through to a re-register after a failed delete: the POST
            # will collide on resourceUrl, and a partial success here would leave
            # the catalog worse than it started.
            sys.exit(
                f"  ✗ delete failed ({st}): {json.dumps(out)[:400]}\n"
                "    The registration was left untouched. A 409 usually means something\n"
                "    still references it (e.g. an agent resource connection) — remove that\n"
                "    reference first, or update it in the console instead."
            )
        args.url = url
        args.name = args.name or (existing.get("detectedMetadata") or {}).get("resourceName")

    if not args.url:
        sys.exit("need --url (or --list / --delete / --refresh)")

    print(f"preflight for {args.url}")
    ok = preflight(args.url)
    if args.preflight_only:
        return
    if not ok:
        sys.exit("\nFix the protected-resource metadata before registering.")

    body = {"resourceUrl": args.url}
    if args.name:
        body["displayName"] = args.name
    if args.description:
        body["description"] = args.description

    print(f"\nPOST {BASE}")
    st, out = okta.post(BASE, body)
    print(f"  → HTTP {st} {json.dumps(out)[:300] if out else ''}")
    if st not in (200, 201, 202):
        sys.exit(1)

    st2, listing = okta.get(BASE)
    if st2 == 200:
        print()
        show(listing)


if __name__ == "__main__":
    main()
