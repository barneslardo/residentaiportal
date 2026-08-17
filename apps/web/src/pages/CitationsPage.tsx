import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Badge, humanize, statusTone } from "../components/Chrome";

type Citation = {
  id: string;
  citationNumber: string;
  plate: string | null;
  violationCode: string;
  description: string;
  location: string;
  issuedAt: string;
  dueDate: string;
  amount: string;
  balance: string;
  balanceCents: number;
  status: string;
};

export default function CitationsPage({ version, onChange }: { version: number; onChange: () => void }) {
  const [citations, setCitations] = useState<Citation[]>([]);
  const [outstanding, setOutstanding] = useState("$0.00");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [contesting, setContesting] = useState<string | null>(null);
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState(false);

  function reload() {
    api
      .get<{ citations: Citation[]; outstanding: string }>("/api/v1/citations")
      .then((r) => {
        setCitations(r.data.citations);
        setOutstanding(r.data.outstanding);
      })
      .catch((err) => setError(err.message));
  }

  useEffect(reload, [version]);

  async function pay(citationNumber: string) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const quote = await api.post<{ confirmationToken?: string; message: string }>("/api/v1/payments/quote", {
        kind: "citation",
        referenceId: citationNumber,
      });
      if (!quote.data.confirmationToken) {
        setFlash(quote.data.message);
        return;
      }
      const settled = await api.post<{ confirmationCode: string; amount: string }>("/api/v1/payments/approve", {
        confirmationToken: quote.data.confirmationToken,
      });
      setFlash(`Paid ${settled.data.amount}. Confirmation ${settled.data.confirmationCode}.`);
      reload();
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitContest(e: React.FormEvent) {
    e.preventDefault();
    if (!contesting) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ message: string }>("/api/v1/citations/contest", {
        citationId: contesting,
        statement,
      });
      setFlash(res.data.message);
      setContesting(null);
      setStatement("");
      reload();
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not file the contest");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Citations</h1>
        <p>
          Parking and municipal-code citations issued to your household. Outstanding balance:{" "}
          <strong>{outstanding}</strong>
        </p>
      </div>

      {error && <div className="notice error">{error}</div>}
      {flash && <div className="notice success">{flash}</div>}

      <div className="card">
        {citations.length === 0 && <div className="muted">No citations on file.</div>}
        <ul className="record-list">
          {citations.map((c) => (
            <li key={c.id}>
              <div className="record-main">
                <div className="record-title">{c.description}</div>
                <div className="tiny">
                  <span className="ref">{c.citationNumber}</span> · code {c.violationCode} · {c.location}
                  {c.plate ? ` · plate ${c.plate}` : ""}
                </div>
                <div className="tiny">
                  Issued {c.issuedAt} · due {c.dueDate} · {c.amount}
                </div>
                {c.status === "unpaid" && (
                  <div style={{ marginTop: 8 }}>
                    <button className="small" disabled={busy} onClick={() => pay(c.citationNumber)}>
                      Pay {c.balance}
                    </button>{" "}
                    <button
                      className="secondary small"
                      onClick={() => setContesting(contesting === c.citationNumber ? null : c.citationNumber)}
                    >
                      Contest
                    </button>
                  </div>
                )}
                {contesting === c.citationNumber && (
                  <form onSubmit={submitContest} style={{ marginTop: 10 }}>
                    <label htmlFor="stmt">Your account of what happened</label>
                    <textarea
                      id="stmt"
                      required
                      minLength={20}
                      value={statement}
                      placeholder="Describe in your own words why this citation should be dismissed."
                      onChange={(e) => setStatement(e.target.value)}
                    />
                    <div className="tiny" style={{ margin: "4px 0 8px" }}>
                      The hearing officer reads this verbatim. The assistant will not write it for you.
                    </div>
                    <button className="small" disabled={busy}>
                      File contest
                    </button>
                  </form>
                )}
              </div>
              <Badge tone={statusTone(c.status)}>{humanize(c.status)}</Badge>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
