import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Seal } from "../components/Chrome";

type Persona = {
  id: string;
  label: string;
  oktaGroup: string;
  role: string;
  blurb: string;
  scopes: string[];
};

export default function LoginPage({
  meta,
  onSignedIn,
}: {
  meta: { oidcEnabled?: boolean; devLoginEnabled?: boolean };
  onSignedIn: () => void;
}) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [email, setEmail] = useState("dana.whitfield@riverbend.example");
  const [group, setGroup] = useState("Riverbend Residents");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const params = new URLSearchParams(window.location.search);
  const loginError = params.get("error");
  const loginMessage = params.get("message");

  useEffect(() => {
    api
      .get<Persona[]>("/auth/personas")
      .then((r) => setPersonas(r.data))
      .catch(() => setPersonas([]));
  }, []);

  async function devLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/dev-login", { email, groups: [group] });
      onSignedIn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="seal-lg" style={{ color: "#fff" }}>
          <Seal size={56} />
        </div>
        <h1 style={{ marginBottom: 2 }}>City of Riverbend</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Resident Services Portal — utilities, permits, 311, licenses, and city programs.
        </p>

        {loginError && (
          <div className="notice error">
            <strong>{loginError.replace(/_/g, " ")}</strong>
            {loginMessage ? <div style={{ marginTop: 4 }}>{loginMessage}</div> : null}
          </div>
        )}

        {meta.oidcEnabled ? (
          <a href="/auth/oidc/login">
            <button style={{ width: "100%", padding: "11px 16px" }}>Sign in with Okta</button>
          </a>
        ) : (
          <div className="notice warn">
            Okta sign-in is not configured yet. Set <code>OKTA_OIDC_CLIENT_ID</code> and run{" "}
            <code>scripts/setup_okta.py</code>.
          </div>
        )}

        {meta.devLoginEnabled && (
          <form onSubmit={devLogin} style={{ marginTop: 20, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
            <div className="card-label">Local demo sign-in (non-production only)</div>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="group">Okta group</label>
              <select id="group" value={group} onChange={(e) => setGroup(e.target.value)}>
                {personas.map((p) => (
                  <option key={p.id} value={p.oktaGroup}>
                    {p.oktaGroup} — {p.label}
                  </option>
                ))}
              </select>
            </div>
            {error && <div className="notice error">{error}</div>}
            <button className="secondary" disabled={busy} style={{ width: "100%" }}>
              {busy ? "Signing in…" : "Continue"}
            </button>
          </form>
        )}

        {personas.length > 0 && (
          <div style={{ marginTop: 22, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
            <div className="card-label">Personas in this demo</div>
            <ul className="record-list">
              {personas.map((p) => (
                <li key={p.id}>
                  <div className="record-main">
                    <div className="record-title">{p.label}</div>
                    <div className="tiny">{p.blurb}</div>
                    <div style={{ marginTop: 4 }}>
                      {p.scopes.slice(0, 4).map((s) => (
                        <span className="scope-chip" key={s}>
                          {s}
                        </span>
                      ))}
                      {p.scopes.length > 4 && <span className="tiny"> +{p.scopes.length - 4} more</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
