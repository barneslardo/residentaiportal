import { useEffect, useState } from "react";
import { api, ApiError, type Me } from "../api";
import { Badge, humanize, statusTone } from "../components/Chrome";

type ServiceRequest = {
  id: string;
  requestNumber: string;
  categoryLabel: string;
  description: string;
  address: string;
  status: string;
  priority: string;
  assignedCrew: string | null;
  openedAt: string;
  dueBy: string | null;
};

const CATEGORIES = [
  "pothole",
  "streetlight_out",
  "missed_collection",
  "graffiti",
  "downed_tree",
  "water_main_break",
  "snow_removal",
  "illegal_dumping",
  "sidewalk_damage",
  "noise_complaint",
  "stray_animal",
  "other",
];

export default function RequestsPage({
  me,
  version,
  onChange,
}: {
  me: Me;
  version: number;
  onChange: () => void;
}) {
  const canManage = me.scopes.includes("resident.requests.manage") || me.role === "admin";
  const [scope, setScope] = useState<"mine" | "all">(canManage ? "all" : "mine");
  const [items, setItems] = useState<ServiceRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [form, setForm] = useState({ category: "pothole", description: "", address: "", crossStreet: "" });
  const [busy, setBusy] = useState(false);

  function reload() {
    api
      .get<{ requests: ServiceRequest[] }>(`/api/v1/requests?scope=${scope}`)
      .then((r) => setItems(r.data.requests))
      .catch((err) => setError(err.message));
  }

  useEffect(reload, [scope, version]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const created = await api.post<{ requestNumber: string; message: string }>("/api/v1/requests", {
        category: form.category,
        description: form.description,
        address: form.address,
        crossStreet: form.crossStreet || undefined,
      });
      setFlash(created.data.message);
      setForm({ category: "pothole", description: "", address: "", crossStreet: "" });
      reload();
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open the request");
    } finally {
      setBusy(false);
    }
  }

  async function advance(requestNumber: string, status: string) {
    try {
      await api.patch(`/api/v1/requests/${requestNumber}`, {
        status,
        note: `Status set to ${status} from the department console.`,
      });
      reload();
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>311 Service Requests</h1>
        <p>
          Report a problem in the right-of-way and follow it to closure. Each category has a published
          target response time.
        </p>
      </div>

      {error && <div className="notice error">{error}</div>}
      {flash && <div className="notice success">{flash}</div>}

      {canManage && (
        <div style={{ marginBottom: 14 }}>
          <button className={scope === "all" ? "" : "secondary"} onClick={() => setScope("all")}>
            Citywide queue
          </button>{" "}
          <button className={scope === "mine" ? "" : "secondary"} onClick={() => setScope("mine")}>
            Reported by me
          </button>
        </div>
      )}

      <div className="grid two">
        <div className="card">
          <h3>{scope === "all" ? "Citywide queue" : "Your reports"}</h3>
          {items.length === 0 && <div className="muted">Nothing here yet.</div>}
          <ul className="record-list">
            {items.map((r) => (
              <li key={r.id}>
                <div className="record-main">
                  <div className="record-title">{r.categoryLabel}</div>
                  <div className="tiny">{r.description}</div>
                  <div className="tiny">
                    <span className="ref">{r.requestNumber}</span> · {r.address}
                    {r.assignedCrew ? ` · ${r.assignedCrew}` : ""}
                    {r.dueBy ? ` · target ${r.dueBy}` : ""}
                  </div>
                  {canManage && r.status !== "closed" && (
                    <div style={{ marginTop: 6 }}>
                      <button className="secondary small" onClick={() => advance(r.requestNumber, "in_progress")}>
                        In progress
                      </button>{" "}
                      <button className="secondary small" onClick={() => advance(r.requestNumber, "closed")}>
                        Close
                      </button>
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right" }}>
                  <Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge>
                  {r.priority !== "normal" && (
                    <div style={{ marginTop: 4 }}>
                      <Badge tone={r.priority === "emergency" ? "red" : "amber"}>{humanize(r.priority)}</Badge>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <h3>Report a problem</h3>
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="cat">Category</label>
              <select id="cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {humanize(c)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="addr">Location</label>
              <input
                id="addr"
                required
                value={form.address}
                placeholder="Street address or nearest intersection"
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="cross">Cross street (optional)</label>
              <input id="cross" value={form.crossStreet} onChange={(e) => setForm({ ...form, crossStreet: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="desc">What's wrong?</label>
              <textarea
                id="desc"
                required
                minLength={5}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <button disabled={busy}>{busy ? "Submitting…" : "Submit request"}</button>
          </form>
          <div className="notice warn" style={{ marginTop: 14, marginBottom: 0 }}>
            For a gas smell, an active water main break, or a downed power line, call 911 — do not use
            this form.
          </div>
        </div>
      </div>
    </>
  );
}
