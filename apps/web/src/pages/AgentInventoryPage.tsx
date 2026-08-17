import { useEffect, useState } from "react";
import { api } from "../api";
import { Badge } from "../components/Chrome";

type Finding = { severity: "high" | "medium" | "low"; subject: string; title: string; detail: string };

type Inventory = {
  generatedAt: string;
  org: string;
  summary: {
    agents: number;
    oauthClients: number;
    mcpServers: number;
    authorizationServers: number;
    findings: number;
    highSeverity: number;
  };
  agents: Array<{
    clientId: string;
    name: string;
    authMethod: string;
    grantTypes: string[];
    keyCount: number;
    keyIds: string[];
    createdAt: string | null;
    crossAppAccess: boolean;
  }>;
  mcpServers: Array<{
    id: string;
    resourceUrl: string;
    name: string;
    status: string;
    authorizationServerCount: number;
    scopes: string[];
    lastRefreshedAt: string | null;
    staleDays: number | null;
  }>;
  authorizationServers: Array<{ id: string; name: string; issuer: string; audiences: string[]; status: string }>;
  findings: Finding[];
};

const SEVERITY_TONE = { high: "red", medium: "amber", low: "grey" } as const;

export default function AgentInventoryPage() {
  const [data, setData] = useState<Inventory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Inventory>("/api/v1/agent-inventory")
      .then((r) => setData(r.data))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="notice error">{error}</div>;
  if (!data) return <div className="muted">Reading the Okta org…</div>;

  return (
    <>
      <div className="page-head">
        <h1>AI Agent Inventory</h1>
        <p>
          Every agent registration, MCP server, and authorization server in{" "}
          <strong>{data.org.replace("https://", "")}</strong> — the three questions an org usually
          can't answer: where agents exist, what they can reach, and whether anything governs them.
        </p>
      </div>

      <div className="grid three" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-label">Agent registrations</div>
          <div className="stat">{data.summary.agents}</div>
          <div className="muted">of {data.summary.oauthClients} OAuth clients</div>
        </div>
        <div className="card">
          <div className="card-label">MCP servers</div>
          <div className="stat">{data.summary.mcpServers}</div>
          <div className="muted">{data.summary.authorizationServers} authorization servers</div>
        </div>
        <div className="card">
          <div className="card-label">Findings</div>
          <div className={`stat ${data.summary.highSeverity ? "due" : "ok"}`}>
            {data.summary.findings}
          </div>
          <div className="muted">{data.summary.highSeverity} high severity</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Findings</h3>
        {data.findings.length === 0 && <div className="muted">Nothing flagged.</div>}
        <ul className="record-list">
          {data.findings.map((f, i) => (
            <li key={i}>
              <div className="record-main">
                <div className="record-title">{f.title}</div>
                <div className="tiny" style={{ marginBottom: 3 }}>
                  <span className="ref">{f.subject}</span>
                </div>
                <div className="tiny">{f.detail}</div>
              </div>
              <Badge tone={SEVERITY_TONE[f.severity]}>{f.severity}</Badge>
            </li>
          ))}
        </ul>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Agent registrations</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Client ID</th>
                <th>Auth</th>
                <th>Keys</th>
                <th>XAA</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {data.agents.map((a) => (
                <tr key={a.clientId}>
                  <td>{a.name}</td>
                  <td className="ref">{a.clientId}</td>
                  <td className="tiny">{a.authMethod}</td>
                  <td>
                    {a.keyCount === 0 ? <Badge tone="red">none</Badge> : a.keyCount}
                  </td>
                  <td>{a.crossAppAccess ? <Badge tone="green">yes</Badge> : <Badge tone="grey">no</Badge>}</td>
                  <td className="tiny">{a.createdAt?.slice(0, 10) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>MCP servers</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Resource URL</th>
                <th>Status</th>
                <th>Auth servers</th>
                <th>Scopes</th>
                <th>Metadata read</th>
              </tr>
            </thead>
            <tbody>
              {data.mcpServers.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td className="ref">{s.resourceUrl}</td>
                  <td>
                    <Badge tone={s.status === "ACTIVE" ? "green" : "red"}>{s.status}</Badge>
                  </td>
                  <td>
                    {s.authorizationServerCount === 0 ? (
                      <Badge tone="red">0</Badge>
                    ) : (
                      s.authorizationServerCount
                    )}
                  </td>
                  <td>{s.scopes.length}</td>
                  <td className="tiny">
                    {s.lastRefreshedAt?.slice(0, 10) ?? "—"}
                    {s.staleDays !== null && s.staleDays > 30 && (
                      <div>
                        <Badge tone="amber">{s.staleDays}d stale</Badge>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Authorization servers</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Issuer</th>
                <th>Audiences</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.authorizationServers.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td className="ref">{s.issuer}</td>
                  <td className="tiny">{s.audiences.join(", ") || "—"}</td>
                  <td>
                    <Badge tone={s.status === "ACTIVE" ? "green" : "grey"}>{s.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="tiny" style={{ marginTop: 14 }}>
        Generated {new Date(data.generatedAt).toLocaleString()} from the Okta Management API.
      </div>
    </>
  );
}
