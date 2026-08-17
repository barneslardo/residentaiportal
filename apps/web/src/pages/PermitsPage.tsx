import { useEffect, useState } from "react";
import { api, ApiError, type Me } from "../api";
import { Badge, humanize, statusTone } from "../components/Chrome";

type Permit = {
  id: string;
  permitNumber: string;
  typeLabel: string;
  status: string;
  address: string;
  description: string;
  fee: string;
  feePaid: boolean;
  submittedAt: string;
  decisionNote: string | null;
  inspections?: Array<{
    id: string;
    type: string;
    scheduledFor: string;
    status: string;
    inspectorName: string | null;
    inspectorNotes?: string;
    notesRedacted?: boolean;
  }>;
};

const TYPES = [
  "building",
  "electrical",
  "plumbing",
  "fence",
  "driveway",
  "business_license",
  "dog_license",
  "block_party",
  "sign",
  "short_term_rental",
];

export default function PermitsPage({
  me,
  version,
  onChange,
}: {
  me: Me;
  version: number;
  onChange: () => void;
}) {
  const canReview = me.scopes.includes("resident.permits.review") || me.role === "admin";
  const [scope, setScope] = useState<"mine" | "all">(canReview ? "all" : "mine");
  const [permits, setPermits] = useState<Permit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ type: "fence", address: "", description: "", contractorName: "" });

  function reload() {
    api
      .get<{ permits: Permit[] }>(`/api/v1/permits?scope=${scope}`)
      .then((r) => setPermits(r.data.permits))
      .catch((err) => setError(err.message));
  }

  useEffect(reload, [scope, version]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const created = await api.post<{ message: string }>("/api/v1/permits", {
        type: form.type,
        address: form.address,
        description: form.description,
        contractorName: form.contractorName || undefined,
      });
      setFlash(created.data.message);
      setForm({ type: "fence", address: "", description: "", contractorName: "" });
      reload();
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not submit the application");
    } finally {
      setBusy(false);
    }
  }

  async function decide(permitNumber: string, decision: string) {
    try {
      await api.post(`/api/v1/permits/${permitNumber}/review`, {
        decision,
        note: `Recorded from the department console.`,
      });
      reload();
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Review failed");
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Permits &amp; Licenses</h1>
        <p>
          Apply for building work, licenses, and one-off permits, then track review and inspections.
        </p>
      </div>

      {error && <div className="notice error">{error}</div>}
      {flash && <div className="notice success">{flash}</div>}

      {canReview && (
        <div style={{ marginBottom: 14 }}>
          <button className={scope === "all" ? "" : "secondary"} onClick={() => setScope("all")}>
            All applications
          </button>{" "}
          <button className={scope === "mine" ? "" : "secondary"} onClick={() => setScope("mine")}>
            Mine
          </button>
        </div>
      )}

      <div className="grid two">
        <div className="card">
          <h3>{scope === "all" ? "Review queue" : "Your applications"}</h3>
          {permits.length === 0 && <div className="muted">No applications on file.</div>}
          <ul className="record-list">
            {permits.map((p) => (
              <li key={p.id}>
                <div className="record-main">
                  <div className="record-title">{p.typeLabel}</div>
                  <div className="tiny">{p.description}</div>
                  <div className="tiny">
                    <span className="ref">{p.permitNumber}</span> · {p.address} · fee {p.fee}
                    {p.feePaid ? " (paid)" : ""}
                  </div>
                  {p.decisionNote && (
                    <div className="notice warn" style={{ marginTop: 6, marginBottom: 0, fontSize: 12.5 }}>
                      {p.decisionNote}
                    </div>
                  )}
                  {(p.inspections ?? []).map((i) => (
                    <div className="tiny" key={i.id} style={{ marginTop: 6 }}>
                      Inspection · {i.type} · {i.scheduledFor} · {humanize(i.status)}
                      {i.inspectorName ? ` · ${i.inspectorName}` : ""}
                      {i.inspectorNotes && (
                        <div style={{ marginTop: 2, color: "var(--ink)" }}>{i.inspectorNotes}</div>
                      )}
                      {i.notesRedacted && (
                        <div style={{ marginTop: 2 }}>
                          Inspector notes withheld —{" "}
                          <span className="scope-chip denied">resident.permits.review</span> required.
                        </div>
                      )}
                    </div>
                  ))}
                  {canReview && !["approved", "denied", "issued"].includes(p.status) && (
                    <div style={{ marginTop: 8 }}>
                      <button className="secondary small" onClick={() => decide(p.permitNumber, "approve")}>
                        Approve
                      </button>{" "}
                      <button className="secondary small" onClick={() => decide(p.permitNumber, "request_info")}>
                        Request info
                      </button>{" "}
                      <button className="secondary small" onClick={() => decide(p.permitNumber, "deny")}>
                        Deny
                      </button>
                    </div>
                  )}
                  {canReview && p.status === "approved" && (
                    <div style={{ marginTop: 8 }}>
                      <button className="small" onClick={() => decide(p.permitNumber, "issue")}>
                        Issue permit
                      </button>
                    </div>
                  )}
                </div>
                <Badge tone={statusTone(p.status)}>{humanize(p.status)}</Badge>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <h3>New application</h3>
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="ptype">Permit or license</label>
              <select id="ptype" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {humanize(t)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="paddr">Property address</label>
              <input id="paddr" required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="pdesc">Scope of work</label>
              <textarea
                id="pdesc"
                required
                minLength={5}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="pcon">Contractor (optional)</label>
              <input id="pcon" value={form.contractorName} onChange={(e) => setForm({ ...form, contractorName: e.target.value })} />
            </div>
            <button disabled={busy}>{busy ? "Submitting…" : "Submit application"}</button>
          </form>
        </div>
      </div>
    </>
  );
}
