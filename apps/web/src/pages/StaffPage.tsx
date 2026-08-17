import { useEffect, useState } from "react";
import { api, ApiError, type Me } from "../api";
import { Badge, humanize, statusTone } from "../components/Chrome";

type Resident = {
  id: string;
  accountNumber: string;
  name: string;
  email: string;
  phone: string;
  serviceAddress: string;
  ward: number;
  parcelId: string | null;
};

type CodeCase = {
  caseNumber: string;
  address: string;
  violationType: string;
  status: string;
  inspectorName: string | null;
  inspectorNotes: string | null;
  hearingDate: string | null;
  fine: string;
};

type AssistanceCase = {
  caseNumber: string;
  resident: string;
  programLabel: string;
  status: string;
  householdIncome: string;
  householdSize: number;
  benefit: string;
  caseworkerName: string | null;
  caseworkerNotes: string | null;
  reviewDate: string | null;
};

/** A panel whose failure mode is the point: show why a dataset is unreachable. */
function ScopedPanel({
  title,
  scope,
  error,
  children,
}: {
  title: string;
  scope: string;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="card">
      <h3>{title}</h3>
      {error ? (
        <div className="notice info" style={{ marginBottom: 0 }}>
          <div style={{ marginBottom: 6 }}>{error}</div>
          <span className="scope-chip denied">{scope}</span>
        </div>
      ) : (
        children
      )}
    </div>
  );
}

export default function StaffPage({ me }: { me: Me }) {
  const [query, setQuery] = useState("");
  const [residents, setResidents] = useState<Resident[]>([]);
  const [residentError, setResidentError] = useState<string | null>(null);
  const [codeCases, setCodeCases] = useState<CodeCase[]>([]);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [assistance, setAssistance] = useState<AssistanceCase[]>([]);
  const [assistanceError, setAssistanceError] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);

  async function search() {
    setResidentError(null);
    try {
      const r = await api.get<{ residents: Resident[] }>(
        `/api/v1/staff/residents${query ? `?query=${encodeURIComponent(query)}` : ""}`
      );
      setResidents(r.data.residents);
    } catch (err) {
      setResidentError(err instanceof ApiError ? err.message : "Lookup failed");
    }
  }

  useEffect(() => {
    search();
    api
      .get<CodeCase[] | { cases: CodeCase[] }>("/api/v1/staff/code-cases")
      .then((r) => setCodeCases((r.data as { cases: CodeCase[] }).cases ?? []))
      .catch((err) => setCodeError(err instanceof ApiError ? err.message : "Unavailable"));
    api
      .get<{ cases: AssistanceCase[] }>("/api/v1/staff/assistance-cases")
      .then((r) => setAssistance(r.data.cases))
      .catch((err) => setAssistanceError(err instanceof ApiError ? err.message : "Unavailable"));
    api
      .get<Record<string, unknown>>("/api/v1/requests/stats")
      .then((r) => setStats(r.data))
      .catch(() => setStats(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="page-head">
        <h1>Department Console</h1>
        <p>
          Signed in as <strong>{me.persona}</strong>. Panels below reflect the scopes on your Okta
          groups — a dataset you cannot reach says which scope it needs and who holds it.
        </p>
      </div>

      {stats && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>311 queue</h3>
          <div className="grid three">
            {Object.entries((stats.byStatus ?? {}) as Record<string, number>).map(([status, count]) => (
              <div key={status}>
                <div className="card-label">{humanize(status)}</div>
                <div className="stat">{count}</div>
              </div>
            ))}
            <div>
              <div className="card-label">Past SLA</div>
              <div className="stat due">{String(stats.overdue ?? 0)}</div>
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Resident lookup</h3>
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <input
            placeholder="Name, address, email, account number, or parcel"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
          />
          <button className="secondary" onClick={search}>
            Search
          </button>
        </div>
        {residentError ? (
          <div className="notice info" style={{ marginBottom: 0 }}>
            <div style={{ marginBottom: 6 }}>{residentError}</div>
            <span className="scope-chip denied">resident.records.read</span>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Name</th>
                  <th>Service address</th>
                  <th>Ward</th>
                  <th>Contact</th>
                </tr>
              </thead>
              <tbody>
                {residents.map((r) => (
                  <tr key={r.id}>
                    <td className="ref">{r.accountNumber}</td>
                    <td>{r.name}</td>
                    <td>{r.serviceAddress}</td>
                    <td>{r.ward}</td>
                    <td className="tiny">
                      {r.email}
                      <br />
                      {r.phone}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid two">
        <ScopedPanel title="Code enforcement cases" scope="resident.code.enforcement" error={codeError}>
          {codeCases.length === 0 && <div className="muted">No open cases.</div>}
          <ul className="record-list">
            {codeCases.map((c) => (
              <li key={c.caseNumber}>
                <div className="record-main">
                  <div className="record-title">{humanize(c.violationType)}</div>
                  <div className="tiny">
                    <span className="ref">{c.caseNumber}</span> · {c.address}
                    {c.hearingDate ? ` · hearing ${c.hearingDate}` : ""}
                  </div>
                  {c.inspectorNotes && (
                    <div className="tiny" style={{ marginTop: 5, color: "var(--ink)" }}>
                      <strong>{c.inspectorName}:</strong> {c.inspectorNotes}
                    </div>
                  )}
                </div>
                <Badge tone={statusTone(c.status)}>{humanize(c.status)}</Badge>
              </li>
            ))}
          </ul>
        </ScopedPanel>

        <ScopedPanel title="Assistance case files" scope="resident.assistance" error={assistanceError}>
          {assistance.length === 0 && <div className="muted">No cases.</div>}
          <ul className="record-list">
            {assistance.map((c) => (
              <li key={c.caseNumber}>
                <div className="record-main">
                  <div className="record-title">
                    {c.resident} — {c.programLabel}
                  </div>
                  <div className="tiny">
                    <span className="ref">{c.caseNumber}</span> · household of {c.householdSize} ·
                    income {c.householdIncome} · benefit {c.benefit}
                  </div>
                  {c.caseworkerNotes && (
                    <div className="tiny" style={{ marginTop: 5, color: "var(--ink)" }}>
                      <strong>{c.caseworkerName}:</strong> {c.caseworkerNotes}
                    </div>
                  )}
                </div>
                <Badge tone={statusTone(c.status)}>{humanize(c.status)}</Badge>
              </li>
            ))}
          </ul>
        </ScopedPanel>
      </div>
    </>
  );
}
