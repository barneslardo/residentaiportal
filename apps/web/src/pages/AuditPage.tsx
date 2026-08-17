import { useEffect, useState } from "react";
import { api } from "../api";
import { Badge } from "../components/Chrome";

type AuditEvent = {
  id: string;
  at: string;
  actor: string;
  persona: string | null;
  channel: string;
  tool: string;
  allowed: boolean;
  denyReason: string | null;
  requiredScopes: string[];
  presentedScopes: string[];
  delegationMode: string | null;
  delegationJti: string | null;
  summary: string | null;
};

export default function AuditPage({ version }: { version: number }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [deniedOnly, setDeniedOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ events: AuditEvent[] }>(`/api/v1/audit?limit=200${deniedOnly ? "&deniedOnly=true" : ""}`)
      .then((r) => setEvents(r.data.events))
      .catch((err) => setError(err.message));
  }, [deniedOnly, version]);

  const denied = events.filter((e) => !e.allowed).length;

  return (
    <>
      <div className="page-head">
        <h1>Agent Audit Log</h1>
        <p>
          Every tool call attempted through the assistant or the municipal MCP server — allowed or
          refused — with the scopes that decided it and the delegation it rode on.
        </p>
      </div>

      {error && <div className="notice error">{error}</div>}

      <div className="grid three" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-label">Events shown</div>
          <div className="stat">{events.length}</div>
        </div>
        <div className="card">
          <div className="card-label">Refused</div>
          <div className={`stat ${denied ? "due" : "ok"}`}>{denied}</div>
        </div>
        <div className="card">
          <div className="card-label">Filter</div>
          <button className={deniedOnly ? "" : "secondary"} onClick={() => setDeniedOnly(!deniedOnly)}>
            {deniedOnly ? "Showing refusals only" : "Show refusals only"}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Tool</th>
                <th>Channel</th>
                <th>Outcome</th>
                <th>Required</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="tiny">{new Date(e.at).toLocaleString()}</td>
                  <td>
                    {e.actor}
                    <div className="tiny">{e.persona ?? "—"}</div>
                  </td>
                  <td className="ref">{e.tool}</td>
                  <td className="tiny">
                    {e.channel}
                    <div>{e.delegationMode}</div>
                  </td>
                  <td>
                    <Badge tone={e.allowed ? "green" : "red"}>{e.allowed ? "allowed" : "refused"}</Badge>
                    {e.denyReason && <div className="tiny">{e.denyReason}</div>}
                  </td>
                  <td>
                    {e.requiredScopes.map((s) => (
                      <span className={`scope-chip ${e.allowed ? "" : "denied"}`} key={s}>
                        {s}
                      </span>
                    ))}
                  </td>
                  <td className="tiny" style={{ maxWidth: 380 }}>
                    {e.summary}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {events.length === 0 && <div className="muted">No agent activity recorded yet.</div>}
      </div>
    </>
  );
}
