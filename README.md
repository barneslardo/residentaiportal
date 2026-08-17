# City of Riverbend — Resident Portal

An **"Okta secures AI"** demo. A fictional municipality's resident portal with an
embedded AI assistant that can act on the resident's behalf — and can only reach
what Okta says that particular person may reach.

Sibling demos: [Super LMS](https://superlms.skylarbarnes.com) ·
[SIS](https://sis.skylarbarnes.com) · [Admin Portal](https://ai-admin.skylarbarnes.com)

| Piece | Value |
|---|---|
| Public URL | `https://resident.skylarbarnes.com` |
| Process | `resident-api` (pm2) on **:3220** — serves the API *and* the built SPA |
| Postgres | host port **5441** (docker compose), not public |
| MCP endpoint | `https://resident.skylarbarnes.com/mcp` |
| Okta org | `sledai.oktapreview.com` |

Unlike the SIS/LMS demos there is **one hostname and one process**: Express serves
the React build same-origin, so there is no second CNAME and no cross-site cookie
to reason about.

## What it demonstrates

1. **Human signs in with Okta** — OIDC authorization code + PKCE, `private_key_jwt`
   client auth, JIT-provisioned into a household record.
2. **The agent borrows the user's authority, briefly** — every chat turn mints a
   fresh delegated token through **Cross App Access (ID-JAG)**: the user's
   `id_token` → an ID-JAG assertion → a scoped access token on the municipal
   authorization server. The assistant holds no standing credential.
3. **Scopes decide what the agent can even attempt** — the model is only offered
   the tools its delegated scopes authorize. Withheld tools are listed in the
   trust panel rather than hidden.
4. **Refusals explain themselves** — a denial names the missing scope, what that
   scope authorizes, and which department holds it. See
   [the scope-refusal script](#demo-script).
5. **Money needs a human** — the agent can price a payment and create a
   confirmation token, but only a person clicking *Approve* in the portal can
   settle it. This is enforced in the data model, not the prompt.
6. **Same tools over MCP** — an external MCP client presenting a municipal access
   token gets the same registry, the same scope filter, and the same audit trail.
7. **Everything is logged** — allowed *and* refused tool calls, with the scopes
   that decided it, visible to the City Administrator.

## Personas

Nine Okta groups map to nine personas. The interesting demo move is asking the
**same question** as two different people.

| Okta group | Persona | Key scopes |
|---|---|---|
| Riverbend Residents | Resident | `resident.*.self`, `billing.pay`, `requests.create`, `permits.apply` |
| Riverbend City Clerk | City Clerk | `records.read`, `records.write` |
| Riverbend Utility Billing | Utility Billing | `billing.read`, `billing.adjust` |
| Riverbend Public Works | Public Works Dispatch | `requests.manage` |
| Riverbend Building Permits | Building & Permits | `permits.review` |
| Riverbend Code Enforcement | Code Enforcement | `code.enforcement`, `requests.manage` |
| Riverbend Treasurer | Treasurer | `tax.read`, `billing.read` |
| Riverbend Social Services | Social Services | `assistance` |
| Riverbend City Administrator | City Administrator | `resident.admin` |

The matrix lives in [`packages/shared/src/personas.ts`](packages/shared/src/personas.ts)
and is the single source of truth for the Okta groups, the app's scope ceiling,
and the refusal copy.

## Municipal services in the demo

Utility billing (water/sewer/trash/stormwater statements) · property tax ·
permits and licenses with inspections · 311 service requests with SLAs and status
history · parking and code citations with pay/contest · recreation program
catalog and registration · income-qualified assistance cases · code-enforcement
case files · payments with a two-phase approval · an agent audit log.

33 tools total; see `node scripts/try-tool.mjs --list`.

## Demo script

**1 — A resident asks the assistant to do ordinary things.**
Sign in as a Residents-group user and ask: *"What do I owe?"*, *"There's a pothole
on Cedar Hollow — report it"*, *"Sign my kid up for soccer"*. Watch the tool trace
under each answer.

**2 — The payment stops at a human.** *"Pay my water bill."* The assistant returns
an amount and a confirmation token — nothing is charged. The approval card appears
on **Bills & Taxes**; only clicking it settles the payment. Ask the assistant to
approve on your behalf and it will tell you it cannot.

**3 — The refusal.** *"Show me my caseworker's notes."* The resident's own
assistance case is refused, naming `resident.assistance` and Social Services.
This is the moment worth pausing on: being the data subject does not authorize
the agent.

**4 — Same question, different operator.** Sign in as a Social Services user and
ask again — the case file comes back. Nothing changed except the Okta group.

**5 — Show the receipts.** Sign in as the City Administrator → **Agent Audit
Log**, filter to refusals.

**6 — Show the plumbing.** The **Delegation & Trust** tab has the three-hop token
chain, a live delegation probe, the scopes on the current token, and the tools
withheld from this session.

## Setup

```bash
node scripts/gen-keys.mjs          # portal + agent signing keys (JWK)
cp .env.example .env               # then fill OKTA_API_TOKEN and GROK_API_KEY
python3 scripts/setup_okta.py      # groups, custom AS, scopes, claims, policy, OIDC app
```

`setup_okta.py` is idempotent and writes the resulting ids back into `.env`. It
does **not** create the AI agent registration — create that in the Admin Console
(Applications → AI Agents), give it the public half of
`secrets/agent-private-key.json`, connect it to the *Riverbend Municipal Services*
authorization server, then:

```bash
python3 scripts/setup_okta.py --agent-client-id <agent id>
```

Then bring it up:

```bash
pnpm install
bash scripts/db.sh push && bash scripts/db.sh seed
pnpm start                         # builds, pushes schema, runs under pm2
```

`/health` reports whether OIDC, OAuth, delegation, and the LLM are each live.

### Environment

| Variable | Notes |
|---|---|
| `OKTA_ISSUER` / `RESOURCE_AS_ISSUER` | The municipal custom AS (`…/oauth2/aus…`) |
| `OKTA_AUDIENCE` / `MCP_RESOURCE_URL` | Must match each other **and** the AS audience |
| `OKTA_OIDC_CLIENT_ID` | Portal web app (`private_key_jwt`) |
| `AGENT_CLIENT_ID` | AI agent registration — **must differ** from the OIDC client id |
| `GROK_API_KEY` | Default model (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` also work) |
| `DEV_LOGIN_ENABLED` | Local persona switching; ignored when `NODE_ENV=production` |
| `PAYMENTS_REQUIRE_CONFIRMATION` | Leave `true` — the approval step is the demo |

## Okta MCP Server catalog + agent inventory

The portal registers itself in Okta's **MCP Servers** catalog
(`/resource-servers/api/v1/mcp-servers`, beta). Okta discovers the server's name
and scopes by fetching its RFC 9728 metadata, so registration only succeeds if
`/.well-known/oauth-protected-resource` is reachable **and** lists
`authorization_servers` — a missing or unreadable document is what produces the
`No authorization servers found` error.

```bash
python3 scripts/register_mcp_server.py --list
python3 scripts/register_mcp_server.py --url https://resident.skylarbarnes.com/mcp \
    --name "Riverbend Resident Portal"
python3 scripts/register_mcp_server.py --refresh <id>   # re-scrape stale scopes
python3 scripts/register_mcp_server.py --preflight-only --url <url>
```

Notes learned the hard way: an ACTIVE server can't be deleted until it is
deactivated (`/lifecycle/deactivate`), activate does **not** re-read metadata, and
Cloudflare in front of these hosts 403s the default `Python-urllib` User-Agent —
so a healthy endpoint can look unreachable to a naive checker.

**AI Agent Inventory** (`/agents`, City Administrator only) answers the three
questions the Okta Agent Gateway material opens with — where agents exist, what
they can reach, and whether anything governs them — by joining `/oauth2/v1/clients`,
the MCP catalog, and the org's authorization servers. It flags agents with no
signing key, signing keys shared between an agent and a web app, MCP servers with
no resolved authorization server, and stale metadata.

## Tooling

```bash
node scripts/probe-agent.mjs          # is the agent's client auth trusted?
node scripts/try-tool.mjs --list
node scripts/try-tool.mjs --email dana.whitfield@riverbend.example \
     --groups "Riverbend Residents" get_assistance_cases      # → refusal + why
bash scripts/db.sh seed        # reset the demo dataset
pnpm logs                      # pm2 logs
```

`packages/mcp-server` bridges stdio MCP clients to the hosted endpoint with a
municipal access token you supply.

## Notes

- **Everything is fictional.** Riverbend is not a real city, the residents are
  invented (`@riverbend.example`), and no payment touches a real processor.
- Dev login is disabled whenever `NODE_ENV=production`, and returns 403 whenever
  `DEV_LOGIN_ENABLED` is not `true`. Do not enable it on the public host.
- `secrets/` and `.env` are gitignored. The `*.public.json` halves are safe to
  share; the private JWKs are not.
