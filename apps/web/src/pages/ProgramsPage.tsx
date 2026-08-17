import { useEffect, useState } from "react";
import { api, ApiError, type Me } from "../api";
import { Badge, humanize, statusTone } from "../components/Chrome";

type Program = {
  id: string;
  code: string;
  name: string;
  categoryLabel: string;
  season: string;
  description: string;
  location: string;
  schedule: string;
  ages: string;
  fee: string;
  spotsRemaining: number;
  registrationOpen: boolean;
  registrationCloses: string;
};

type Registration = {
  confirmationRef: string;
  program: string;
  participantName: string;
  schedule: string;
  fee: string;
  status: string;
};

export default function ProgramsPage({
  me,
  version,
  onChange,
}: {
  me: Me;
  version: number;
  onChange: () => void;
}) {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [signingUp, setSigningUp] = useState<string | null>(null);
  const [participant, setParticipant] = useState({ name: "", age: "" });
  const [busy, setBusy] = useState(false);

  function reload() {
    api
      .get<{ programs: Program[] }>(`/api/v1/programs${query ? `?query=${encodeURIComponent(query)}` : ""}`)
      .then((r) => setPrograms(r.data.programs))
      .catch((err) => setError(err.message));
    if (me.residentId) {
      api
        .get<{ registrations: Registration[] }>("/api/v1/programs/registrations")
        .then((r) => setRegistrations(r.data.registrations))
        .catch(() => setRegistrations([]));
    }
  }

  useEffect(reload, [version]);

  async function register(e: React.FormEvent) {
    e.preventDefault();
    if (!signingUp) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await api.post<{ message: string }>("/api/v1/programs/register", {
        programId: signingUp,
        participantName: participant.name,
        participantAge: participant.age ? Number(participant.age) : undefined,
      });
      setFlash(res.data.message);
      setSigningUp(null);
      setParticipant({ name: "", age: "" });
      reload();
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Programs &amp; Recreation</h1>
        <p>Classes, camps, aquatics, senior services, and youth sports run by the city.</p>
      </div>

      {error && <div className="notice error">{error}</div>}
      {flash && <div className="notice success">{flash}</div>}

      {registrations.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Your household's registrations</h3>
          <ul className="record-list">
            {registrations.map((r) => (
              <li key={r.confirmationRef}>
                <div className="record-main">
                  <div className="record-title">{r.program}</div>
                  <div className="tiny">
                    {r.participantName} · {r.schedule} · fee {r.fee} ·{" "}
                    <span className="ref">{r.confirmationRef}</span>
                  </div>
                </div>
                <Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            placeholder="Search programs…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && reload()}
          />
          <button className="secondary" onClick={reload}>
            Search
          </button>
        </div>
      </div>

      <div className="grid two">
        {programs.map((p) => (
          <div className="card" key={p.id}>
            <h3>
              {p.name} <Badge tone="navy">{p.categoryLabel}</Badge>
            </h3>
            <p className="muted" style={{ marginTop: 0 }}>
              {p.description}
            </p>
            <div className="kv">
              <span className="k">When</span>
              <span className="v">{p.schedule}</span>
            </div>
            <div className="kv">
              <span className="k">Where</span>
              <span className="v">{p.location}</span>
            </div>
            <div className="kv">
              <span className="k">Ages</span>
              <span className="v">{p.ages}</span>
            </div>
            <div className="kv">
              <span className="k">Fee</span>
              <span className="v">{p.fee}</span>
            </div>
            <div className="kv">
              <span className="k">Spots left</span>
              <span className="v">{p.spotsRemaining}</span>
            </div>
            <div style={{ marginTop: 10 }}>
              {p.spotsRemaining > 0 && p.registrationOpen ? (
                <button
                  className="small"
                  onClick={() => setSigningUp(signingUp === p.code ? null : p.code)}
                >
                  Register
                </button>
              ) : (
                <Badge tone="grey">{p.spotsRemaining === 0 ? "Full" : "Registration closed"}</Badge>
              )}
              <span className="tiny"> Registration closes {p.registrationCloses}</span>
            </div>
            {signingUp === p.code && (
              <form onSubmit={register} style={{ marginTop: 12 }}>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor={`n-${p.code}`}>Participant name</label>
                    <input
                      id={`n-${p.code}`}
                      required
                      value={participant.name}
                      onChange={(e) => setParticipant({ ...participant, name: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`a-${p.code}`}>Age</label>
                    <input
                      id={`a-${p.code}`}
                      type="number"
                      value={participant.age}
                      onChange={(e) => setParticipant({ ...participant, age: e.target.value })}
                    />
                  </div>
                </div>
                <button className="small" disabled={busy}>
                  Confirm registration
                </button>
              </form>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
