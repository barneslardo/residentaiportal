import { useEffect, useState } from "react";
import { api, ApiError, type PendingIntent } from "../api";
import { Badge, humanize, statusTone } from "../components/Chrome";

type Statement = {
  id: string;
  statementNumber: string;
  period: string;
  dueDate: string;
  status: string;
  waterGallons: number;
  amount: string;
  paid: string;
  balance: string;
  balanceCents: number;
};

type UtilityData = {
  totalBalance: string;
  totalBalanceCents: number;
  accounts: Array<{
    accountNumber: string;
    serviceAddress: string;
    services: string[];
    autopayEnabled: boolean;
    balance: string;
    statements: Statement[];
  }>;
};

type TaxData = {
  bills: Array<{
    billNumber: string;
    parcelId: string;
    taxYear: number;
    assessedValue: string;
    amount: string;
    balance: string;
    balanceCents: number;
    dueDate: string;
    status: string;
    exemptions: string[];
  }>;
};

export default function BillsPage({ version, onChange }: { version: number; onChange: () => void }) {
  const [utility, setUtility] = useState<UtilityData | null>(null);
  const [tax, setTax] = useState<TaxData | null>(null);
  const [pending, setPending] = useState<PendingIntent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function reload() {
    api.get<UtilityData>("/api/v1/billing/utility").then((r) => setUtility(r.data)).catch((e) => setError(e.message));
    api.get<TaxData>("/api/v1/billing/tax").then((r) => setTax(r.data)).catch(() => setTax(null));
    api
      .get<{ intents: PendingIntent[] }>("/api/v1/payments/pending")
      .then((r) => setPending(r.data.intents))
      .catch(() => setPending([]));
  }

  useEffect(reload, [version]);

  async function payNow(kind: string, referenceId: string) {
    setBusy(referenceId);
    setError(null);
    setFlash(null);
    try {
      const quote = await api.post<{ confirmationToken?: string; amount?: string; message: string }>(
        "/api/v1/payments/quote",
        { kind, referenceId }
      );
      if (!quote.data.confirmationToken) {
        setFlash(quote.data.message);
        return;
      }
      const settled = await api.post<{ confirmationCode: string; amount: string; referenceLabel: string }>(
        "/api/v1/payments/approve",
        { confirmationToken: quote.data.confirmationToken }
      );
      setFlash(
        `Paid ${settled.data.amount} toward ${settled.data.referenceLabel}. Confirmation ${settled.data.confirmationCode}.`
      );
      reload();
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Payment failed");
    } finally {
      setBusy(null);
    }
  }

  async function approveIntent(token: string) {
    setBusy(token);
    setError(null);
    try {
      const settled = await api.post<{ confirmationCode: string; amount: string; referenceLabel: string }>(
        "/api/v1/payments/approve",
        { confirmationToken: token }
      );
      setFlash(
        `Approved and paid ${settled.data.amount} toward ${settled.data.referenceLabel}. Confirmation ${settled.data.confirmationCode}.`
      );
      reload();
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Approval failed");
    } finally {
      setBusy(null);
    }
  }

  async function cancelIntent(token: string) {
    setBusy(token);
    try {
      await api.post("/api/v1/payments/cancel", { confirmationToken: token });
      setFlash("Payment request cancelled. Nothing was charged.");
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not cancel");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Bills &amp; Taxes</h1>
        <p>
          Utility statements and property tax for your parcel. Payments here are simulated — nothing is
          charged to a real account.
        </p>
      </div>

      {error && <div className="notice error">{error}</div>}
      {flash && <div className="notice success">{flash}</div>}

      {pending.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderColor: "#cbdcec" }}>
          <h3>Awaiting your approval</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            The assistant prepared these payments. It cannot complete them — approving is a step only
            you can take.
          </p>
          <ul className="record-list">
            {pending.map((intent) => (
              <li key={intent.token}>
                <div className="record-main">
                  <div className="record-title">
                    {intent.amount} — {intent.referenceLabel}
                  </div>
                  <div className="tiny">
                    Requested via {intent.createdVia} · expires{" "}
                    {new Date(intent.expiresAt).toLocaleTimeString()}
                  </div>
                </div>
                <button
                  className="small"
                  disabled={busy === intent.token}
                  onClick={() => approveIntent(intent.token)}
                >
                  Approve &amp; pay
                </button>
                <button
                  className="secondary small"
                  disabled={busy === intent.token}
                  onClick={() => cancelIntent(intent.token)}
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {utility?.accounts.map((account) => (
        <div className="card" style={{ marginBottom: 16 }} key={account.accountNumber}>
          <h3>
            Utility account <span className="ref">{account.accountNumber}</span>
            {account.autopayEnabled && <Badge tone="green">Autopay on</Badge>}
          </h3>
          <p className="muted" style={{ marginTop: 0 }}>
            {account.serviceAddress} · {account.services.join(", ")} · balance{" "}
            <strong>{account.balance}</strong>
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Statement</th>
                  <th>Period</th>
                  <th>Water used</th>
                  <th>Due</th>
                  <th>Amount</th>
                  <th>Balance</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {account.statements.map((s) => (
                  <tr key={s.id}>
                    <td className="ref">{s.statementNumber}</td>
                    <td>{s.period}</td>
                    <td>{s.waterGallons.toLocaleString()} gal</td>
                    <td>{s.dueDate}</td>
                    <td>{s.amount}</td>
                    <td>{s.balance}</td>
                    <td>
                      <Badge tone={statusTone(s.status)}>{humanize(s.status)}</Badge>
                    </td>
                    <td>
                      {s.balanceCents > 0 && (
                        <button
                          className="small"
                          disabled={busy === s.statementNumber}
                          onClick={() => payNow("utility", s.statementNumber)}
                        >
                          Pay
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="card">
        <h3>Property tax</h3>
        {!tax?.bills.length && (
          <div className="muted">
            No property-tax records are visible to this session. Reading a parcel you do not own
            requires <span className="scope-chip">resident.tax.read</span>.
          </div>
        )}
        {(tax?.bills.length ?? 0) > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Parcel</th>
                  <th>Year</th>
                  <th>Assessed</th>
                  <th>Amount</th>
                  <th>Balance</th>
                  <th>Due</th>
                  <th>Exemptions</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tax!.bills.map((b) => (
                  <tr key={b.billNumber}>
                    <td className="ref">{b.billNumber}</td>
                    <td className="ref">{b.parcelId}</td>
                    <td>{b.taxYear}</td>
                    <td>{b.assessedValue}</td>
                    <td>{b.amount}</td>
                    <td>{b.balance}</td>
                    <td>{b.dueDate}</td>
                    <td className="tiny">{b.exemptions.map(humanize).join(", ") || "—"}</td>
                    <td>
                      {b.balanceCents > 0 && (
                        <button
                          className="small"
                          disabled={busy === b.billNumber}
                          onClick={() => payNow("tax", b.billNumber)}
                        >
                          Pay
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
