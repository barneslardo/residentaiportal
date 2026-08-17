#!/usr/bin/env python3
"""
Register the agent's public JWK on its Okta AI agent registration.

An agent registration is not a normal app — it is invisible to /api/v1/apps and
is read and written through the DCR endpoint /oauth2/v1/clients/{id} instead.

The key is APPENDED to the registration's JWKS rather than replacing it, so a
key that something else is already relying on keeps working. Okta accepts
multiple keys and selects by the `kid` in the assertion header.

    python3 scripts/register_agent_jwk.py            # append + verify
    python3 scripts/register_agent_jwk.py --replace  # make ours the only key
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from okta_common import ROOT, Okta, load_env, verify_token  # noqa: E402


def main() -> None:
    replace = "--replace" in sys.argv
    env = load_env()
    org = env.get("OKTA_ORG_URL", "").rstrip("/")
    token = env.get("OKTA_API_TOKEN", "").strip()
    client_id = env.get("AGENT_CLIENT_ID", "").strip()

    if not (org and token and client_id):
        sys.exit("Need OKTA_ORG_URL, OKTA_API_TOKEN, and AGENT_CLIENT_ID in .env")

    key_path = env.get("AGENT_PRIVATE_KEY_PATH", "secrets/agent-private-key.json")
    pub_path = ROOT / key_path.replace(".json", ".public.json")
    if not pub_path.exists():
        sys.exit(f"Missing {pub_path}. Run: node scripts/gen-keys.mjs")
    jwk = json.loads(pub_path.read_text())

    okta = Okta(org, token)
    verify_token(okta)

    st, client = okta.get(f"/oauth2/v1/clients/{client_id}")
    if st != 200:
        sys.exit(f"Could not read agent registration {client_id} ({st}): {client}")

    print(f"agent registration : {client.get('client_name')} ({client_id})")
    print(f"auth method        : {client.get('token_endpoint_auth_method')}")
    print(f"grant types        : {client.get('grant_types')}")

    existing = (client.get("jwks") or {}).get("keys", [])
    print(f"keys before        : {[k.get('kid') for k in existing]}")

    if any(k.get("kid") == jwk["kid"] for k in existing) and not replace:
        print(f"\n✓ kid {jwk['kid']} is already registered — nothing to do.")
        return

    keys = [jwk] if replace else [k for k in existing if k.get("kid") != jwk["kid"]] + [jwk]

    body = {k: v for k, v in client.items() if k not in {"client_id_issued_at", "client_secret"}}
    body["jwks"] = {"keys": keys}

    st, updated = okta.put(f"/oauth2/v1/clients/{client_id}", body)
    if st not in (200, 201):
        print(f"\n✗ update failed ({st}):\n{json.dumps(updated, indent=2)[:1200]}", file=sys.stderr)
        print(
            "\nFall back to the console: Applications → the agent registration → "
            f"add the public key from {pub_path}",
            file=sys.stderr,
        )
        sys.exit(1)

    # Do not trust the PUT response. Okta answers 200 here and then silently
    # drops the jwks change on agent registrations, so the only honest check is
    # to read the registration back.
    st, fresh = okta.get(f"/oauth2/v1/clients/{client_id}")
    after = [k.get("kid") for k in (fresh.get("jwks") or {}).get("keys", [])]
    print(f"keys after         : {after}")

    if jwk["kid"] in after:
        print(f"\n✓ registered kid {jwk['kid']}")
        print("Now run:  node scripts/probe-agent.mjs")
        return

    print(
        f"\n✗ Okta returned {st} but did NOT persist the key — the JWKS on an agent\n"
        "  registration is not writable through the DCR endpoint in this tenant.\n\n"
        "  Two ways forward:\n"
        f"   1. Console: open registration {client_id} and replace its public key with\n"
        f"      {pub_path}\n"
        "   2. Or sign with the key Okta already trusts, by pointing\n"
        "      AGENT_PRIVATE_KEY_PATH at the private half matching a kid in the list\n"
        "      above. Works immediately, at the cost of the portal app and the agent\n"
        "      sharing one signing key.",
        file=sys.stderr,
    )
    sys.exit(1)


if __name__ == "__main__":
    main()
