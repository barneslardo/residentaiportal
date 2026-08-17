"""Shared Okta Management API helpers for the Riverbend setup scripts."""
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Okta group display names — must match PERSONAS[].oktaGroup in packages/shared.
GROUPS = [
    ("resident", "Riverbend Residents", "Riverbend households using the resident portal"),
    ("clerk", "Riverbend City Clerk", "Maintains the resident roll and program registrations"),
    ("utility_billing", "Riverbend Utility Billing", "Utility accounts, statements, credits"),
    ("public_works", "Riverbend Public Works", "311 dispatch and work orders"),
    ("building_permits", "Riverbend Building Permits", "Permit review and inspections"),
    ("code_enforcement", "Riverbend Code Enforcement", "Code cases and citation queue"),
    ("treasurer", "Riverbend Treasurer", "Property tax assessments and bills"),
    ("social_services", "Riverbend Social Services", "Income-qualified assistance cases"),
    ("administrator", "Riverbend City Administrator", "Full municipal access and agent audit log"),
]

GROUP_REGEX = r"^Riverbend .*$"

SCOPES = [
    ("resident.profile.read.self", "Read your own resident profile and household record"),
    ("resident.profile.write.self", "Update your own contact info and alert preferences"),
    ("resident.billing.read.self", "Read your own utility account and statements"),
    ("resident.billing.pay", "Submit a payment against your own balance"),
    ("resident.permits.read.self", "Read permits and licenses you hold"),
    ("resident.permits.apply", "Submit a permit or license application"),
    ("resident.requests.read.self", "Read the 311 requests you reported"),
    ("resident.requests.create", "Open a new 311 service request"),
    ("resident.citations.read.self", "Read citations issued to you"),
    ("resident.citations.pay", "Pay one of your own citations"),
    ("resident.citations.contest", "File a contest for one of your own citations"),
    ("resident.programs.register", "Register a household member for a city program"),
    ("resident.records.read", "Look up any resident's core record (staff)"),
    ("resident.records.write", "Create or amend any resident record (staff)"),
    ("resident.billing.read", "Read any utility account (staff)"),
    ("resident.billing.adjust", "Apply credits and waive fees (staff)"),
    ("resident.requests.manage", "Triage, assign, and close any 311 request (staff)"),
    ("resident.permits.review", "Review, approve, and inspect any permit (staff)"),
    ("resident.code.enforcement", "Read and update code-enforcement cases (staff)"),
    ("resident.tax.read", "Read any parcel's property tax records (staff)"),
    ("resident.assistance", "Read income-qualified assistance case files (staff)"),
    ("resident.admin", "Full administrative access to every municipal dataset"),
]

SCOPE_NAMES = [name for name, _ in SCOPES]


def load_env(path: Path | None = None) -> dict[str, str]:
    path = path or (ROOT / ".env")
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        out[key.strip()] = value.strip().strip('"').strip("'")
    return out


def upsert_env(updates: dict[str, str], path: Path | None = None) -> None:
    """Rewrite .env in place, preserving comments and key order."""
    path = path or (ROOT / ".env")
    lines = path.read_text().splitlines() if path.exists() else []
    remaining = dict(updates)

    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key = stripped.split("=", 1)[0].strip()
        if key in remaining:
            lines[i] = f"{key}={remaining.pop(key)}"

    if remaining:
        lines.append("")
        lines.append("# --- written by scripts/setup_okta.py ---")
        for key, value in remaining.items():
            lines.append(f"{key}={value}")

    path.write_text("\n".join(lines) + "\n")


class Okta:
    def __init__(self, org_url: str, token: str):
        self.org = org_url.rstrip("/")
        self.token = token.strip().removeprefix("SSWS ").strip()

    def call(self, method: str, path: str, body=None) -> tuple[int, object]:
        url = path if path.startswith("http") else f"{self.org}{path}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            url,
            data=data,
            method=method,
            headers={
                "Authorization": f"SSWS {self.token}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req) as resp:
                raw = resp.read().decode()
                return resp.status, json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            raw = e.read().decode()
            try:
                return e.code, json.loads(raw)
            except json.JSONDecodeError:
                return e.code, {"raw": raw}

    def get(self, path):
        return self.call("GET", path)

    def post(self, path, body):
        return self.call("POST", path, body)

    def put(self, path, body):
        return self.call("PUT", path, body)

    def require(self, status: int, payload, what: str, ok=(200, 201)):
        if status not in ok:
            print(f"\n✗ {what} failed ({status}):\n{json.dumps(payload, indent=2)}", file=sys.stderr)
            sys.exit(1)
        return payload


def verify_token(okta: Okta) -> None:
    status, payload = okta.get("/api/v1/users/me")
    if status == 401:
        print(
            "✗ OKTA_API_TOKEN is invalid or expired.\n"
            "  Create a new one: Okta Admin Console → Security → API → Tokens → Create Token,\n"
            "  then put it in .env as OKTA_API_TOKEN and re-run.",
            file=sys.stderr,
        )
        sys.exit(1)
    if status not in (200, 403):
        print(f"✗ Could not reach {okta.org} ({status}): {payload}", file=sys.stderr)
        sys.exit(1)
