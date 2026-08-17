import { useEffect, useRef, useState } from "react";
import { api, ApiError, type AgentStatus, type ChatReply, type Me, type ToolTrace } from "../api";

type Turn = {
  role: "user" | "assistant" | "system";
  content: string;
  trace?: ToolTrace[];
  meta?: string;
};

const RESIDENT_PROMPTS = [
  "What do I owe right now?",
  "There's a pothole on my street — report it",
  "Pay my water bill",
  "What's the status of my permit?",
  "Sign my kid up for soccer",
  "Show me my caseworker's notes",
];

const STAFF_PROMPTS = [
  "Show me the 311 queue",
  "Which requests are past their SLA?",
  "Look up the resident at 3390 North Levee Road",
  "Read the assistance case files",
];

export function Assistant({ me, onDataChanged }: { me: Me; onDataChanged: () => void }) {
  const [tab, setTab] = useState<"chat" | "trust">("chat");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<Array<{ id: string; label: string; provider: string }>>([]);
  const [model, setModel] = useState<string>("");
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [lastDelegation, setLastDelegation] = useState<ChatReply["delegation"] | null>(null);
  const [probe, setProbe] = useState<Record<string, { ok: boolean; error?: string; scope?: string }> | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .get<Array<{ id: string; label: string; provider: string }>>("/api/v1/chat/models")
      .then((r) => {
        setModels(r.data);
        if (r.data.length) setModel(r.data[0].id);
      })
      .catch(() => setModels([]));
    api
      .get<AgentStatus>("/auth/oidc/agent-status")
      .then((r) => setStatus(r.data))
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;

    const history = [...turns, { role: "user" as const, content: message }];
    setTurns(history);
    setDraft("");
    setBusy(true);

    try {
      const reply = await api.post<ChatReply>("/api/v1/chat", {
        messages: history
          .filter((t) => t.role !== "system")
          .map((t) => ({ role: t.role, content: t.content })),
        model: model || undefined,
      });
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: reply.data.content,
          trace: reply.data.toolTrace,
          meta: `${reply.data.model} · ${reply.data.delegation.effectiveScopes.length} scope(s) delegated`,
        },
      ]);
      setLastDelegation(reply.data.delegation);
      if (reply.data.toolTrace.some((t) => t.allowed)) onDataChanged();
    } catch (err) {
      const message =
        err instanceof ApiError ? `${err.message}` : "The assistant is unavailable right now.";
      setTurns((prev) => [...prev, { role: "system", content: message }]);
    } finally {
      setBusy(false);
    }
  }

  async function runProbe() {
    setProbe(null);
    try {
      const r = await api.get<Record<string, { ok: boolean; error?: string; scope?: string }>>(
        "/auth/oidc/delegation-probe"
      );
      setProbe(r.data);
    } catch (err) {
      setProbe({
        hop1: { ok: false, error: err instanceof ApiError ? err.message : "probe failed" },
      });
    }
  }

  const prompts = me.role === "resident" ? RESIDENT_PROMPTS : STAFF_PROMPTS;

  return (
    <aside className="assistant">
      <div className="assistant-head">
        <div className="assistant-name">Riverbend Assistant</div>
        <div style={{ fontSize: 12, color: "#a9c1d6" }}>
          Acting for {me.displayName} under delegated Okta authority
        </div>
      </div>

      <div className="assistant-tabs">
        <button className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}>
          Assistant
        </button>
        <button className={tab === "trust" ? "active" : ""} onClick={() => setTab("trust")}>
          Delegation & Trust
        </button>
      </div>

      {tab === "chat" ? (
        <>
          <div className="thread" ref={threadRef}>
            {turns.length === 0 && (
              <div className="muted" style={{ fontSize: 13.5 }}>
                <p style={{ marginTop: 0 }}>
                  Ask about your utility bill, a permit, a 311 report, citations, or city programs.
                </p>
                <p>
                  Every action the assistant takes runs on a token Okta issued for <em>you</em> — it can
                  only reach what your groups authorize, and it will tell you when something is out of
                  reach.
                </p>
              </div>
            )}
            {turns.map((turn, i) => (
              <div key={i} className={`msg ${turn.role}`}>
                <div className="msg-role">
                  {turn.role === "user" ? "You" : turn.role === "assistant" ? "Assistant" : "Portal"}
                </div>
                <div className="msg-body">{turn.content}</div>
                {turn.trace && turn.trace.length > 0 && (
                  <div className="trace">
                    {turn.trace.map((t, j) => (
                      <div className="trace-row" key={j}>
                        <span className={`badge ${t.allowed ? "green" : "red"}`}>
                          {t.allowed ? "allowed" : "denied"}
                        </span>
                        <span className="tool-name">{t.tool}</span>
                        <span className="tiny">{t.durationMs}ms</span>
                      </div>
                    ))}
                  </div>
                )}
                {turn.meta && <div className="tiny" style={{ marginTop: 4 }}>{turn.meta}</div>}
              </div>
            ))}
            {busy && <div className="muted">Working…</div>}
          </div>

          {turns.length === 0 && (
            <div className="suggestions">
              {prompts.map((p) => (
                <button key={p} onClick={() => send(p)}>
                  {p}
                </button>
              ))}
            </div>
          )}

          <div className="composer">
            <textarea
              value={draft}
              placeholder="Ask the assistant…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(draft);
                }
              }}
            />
            <div className="composer-actions">
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {models.length === 0 && <option value="">No model configured</option>}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <button onClick={() => send(draft)} disabled={busy || !draft.trim()}>
                Send
              </button>
            </div>
          </div>
        </>
      ) : (
        <TrustPanel
          me={me}
          status={status}
          delegation={lastDelegation}
          probe={probe}
          onProbe={runProbe}
        />
      )}
    </aside>
  );
}

function TrustPanel({
  me,
  status,
  delegation,
  probe,
  onProbe,
}: {
  me: Me;
  status: AgentStatus | null;
  delegation: ChatReply["delegation"] | null;
  probe: Record<string, { ok: boolean; error?: string; scope?: string }> | null;
  onProbe: () => void;
}) {
  return (
    <div className="trust-body">
      <div className="trust-section">
        <h4>Who the assistant is acting for</h4>
        <div className="kv">
          <span className="k">Subject</span>
          <span className="v">{me.email}</span>
        </div>
        <div className="kv">
          <span className="k">Persona</span>
          <span className="v">{me.persona ?? "—"}</span>
        </div>
        <div className="kv">
          <span className="k">Okta groups</span>
          <span className="v">{me.groups.join(", ") || "—"}</span>
        </div>
      </div>

      <div className="trust-section">
        <h4>Token chain</h4>
        <div className="hop">
          <span className={`hop-dot ${status?.hasIdToken ? "ok" : "fail"}`} />
          <div>
            <strong>1 · Human sign-in</strong>
            <div className="tiny">
              OIDC authorization code + PKCE against the Okta org. Produces the id_token that proves
              who is asking.
            </div>
            <div className="tiny">
              {status?.idTokenExpiresAt
                ? `id_token valid until ${new Date(status.idTokenExpiresAt).toLocaleTimeString()}`
                : "no id_token on this session"}
            </div>
          </div>
        </div>
        <div className="hop">
          <span className={`hop-dot ${probe?.hop1?.ok ?? status?.agentExchangeEnabled ? "ok" : ""}`} />
          <div>
            <strong>2 · ID-JAG exchange</strong>
            <div className="tiny">
              The agent registration presents the id_token and its own private_key_jwt to get a
              cross-app assertion addressed to the municipal authorization server.
            </div>
            {probe?.hop1?.error && <div className="tiny" style={{ color: "var(--red)" }}>{probe.hop1.error}</div>}
          </div>
        </div>
        <div className="hop">
          <span className={`hop-dot ${probe?.hop2?.ok ? "ok" : delegation ? "ok" : ""}`} />
          <div>
            <strong>3 · Delegated access token</strong>
            <div className="tiny">
              The assertion is exchanged for a scoped access token. This is what every tool call
              carries — it expires with the session and cannot be widened.
            </div>
            {probe?.hop2?.scope && <div className="tiny">granted: {probe.hop2.scope}</div>}
            {probe?.hop2?.error && <div className="tiny" style={{ color: "var(--red)" }}>{probe.hop2.error}</div>}
          </div>
        </div>
        <button className="secondary small" style={{ marginTop: 10 }} onClick={onProbe}>
          Run delegation probe
        </button>
      </div>

      {delegation && (
        <div className="trust-section">
          <h4>Last delegated token</h4>
          <div className="kv">
            <span className="k">Issued scopes</span>
            <span className="v">{delegation.issuedScopes.length}</span>
          </div>
          <div className="kv">
            <span className="k">Effective</span>
            <span className="v">{delegation.effectiveScopes.length}</span>
          </div>
          {delegation.cappedBy && (
            <div className="notice warn" style={{ marginTop: 8, fontSize: 12.5 }}>
              Okta issued more scopes than this persona is entitled to; the portal capped them before
              any tool ran.
            </div>
          )}
          {delegation.idJagJti && (
            <div className="kv">
              <span className="k">ID-JAG jti</span>
              <span className="v">{delegation.idJagJti}</span>
            </div>
          )}
          {delegation.expiresIn && (
            <div className="kv">
              <span className="k">Expires in</span>
              <span className="v">{delegation.expiresIn}s</span>
            </div>
          )}
        </div>
      )}

      <div className="trust-section">
        <h4>Scopes on this session ({me.scopes.length})</h4>
        {me.scopes.map((scope) => (
          <div key={scope} style={{ marginBottom: 7 }}>
            <span className="scope-chip">{scope}</span>
            <div className="tiny">{me.scopeDescriptions[scope]}</div>
          </div>
        ))}
        {me.scopes.length === 0 && <div className="tiny">No scopes — every tool will be refused.</div>}
      </div>

      <div className="trust-section">
        <h4>Tools withheld ({me.tools.blocked.length})</h4>
        <div className="tiny" style={{ marginBottom: 6 }}>
          These exist in the municipal MCP server but are not offered to this session's model.
        </div>
        {me.tools.blocked.map((t) => (
          <div key={t.name} style={{ marginBottom: 5 }}>
            <span className="scope-chip denied">{t.name}</span>
            <div className="tiny">needs {t.requiredScopes.join(" or ")}</div>
          </div>
        ))}
      </div>

      <div className="trust-section">
        <h4>Okta configuration</h4>
        <div className="kv">
          <span className="k">Portal app</span>
          <span className="v">{status?.oidcAppClientId ?? "—"}</span>
        </div>
        <div className="kv">
          <span className="k">Agent registration</span>
          <span className="v">{status?.agentClientId ?? "—"}</span>
        </div>
        <div className="kv">
          <span className="k">Municipal AS</span>
          <span className="v">{status?.resourceAuthorizationServer ?? "—"}</span>
        </div>
        {status?.agentDisabledReason && (
          <div className="notice error" style={{ marginTop: 8, fontSize: 12.5 }}>
            {status.agentDisabledReason}
          </div>
        )}
      </div>
    </div>
  );
}
