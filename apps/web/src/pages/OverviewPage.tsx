import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Me, type PendingIntent } from "../api";
import { Badge, humanize, statusTone } from "../components/Chrome";

type Overview = {
  kind: "resident" | "staff";
  persona?: string;
  scopes?: string[];
  profile?: {
    name: string;
    accountNumber: string;
    serviceAddress: string;
    ward: number;
    householdSize: number;
  };
  utility?: { totalBalance: string; totalBalanceCents: number } | null;
  requests?: { count: number; requests: Array<{ requestNumber: string; categoryLabel: string; status: string }> } | null;
  permits?: { count: number; permits: Array<{ permitNumber: string; typeLabel: string; status: string }> } | null;
  citations?: { outstanding: string; outstandingCents: number; count: number } | null;
  registrations?: { count: number; registrations: Array<{ program: string; participantName: string; status: string }> } | null;
  pendingPayments?: PendingIntent[];
  codeCases?: { count: number } | null;
};

export default function OverviewPage({ me, version }: { me: Me; version: number }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Overview>("/api/v1/overview")
      .then((r) => setData(r.data))
      .catch((err) => setError(err.message));
  }, [version]);

  if (error) return <div className="notice error">{error}</div>;
  if (!data) return <div className="muted">Loading…</div>;

  if (data.kind === "staff") {
    return (
      <>
        <div className="page-head">
          <h1>Good day, {me.displayName}</h1>
          <p>
            You are signed in as <strong>{me.persona}</strong>. Your department console has the queues
            your Okta groups authorize; the assistant on the right works under the same limits.
          </p>
        </div>
        <div className="card">
          <Link to="/staff">
            <button>Open department console</button>
          </Link>
        </div>
      </>
    );
  }

  const balanceCents = data.utility?.totalBalanceCents ?? 0;
  const openRequests = data.requests?.requests.filter((r) => r.status !== "closed") ?? [];

  return (
    <>
      <div className="page-head">
        <h1>Welcome back, {data.profile?.name.split(" ")[0]}</h1>
        <p>
          Account {data.profile?.accountNumber} · {data.profile?.serviceAddress} · Ward{" "}
          {data.profile?.ward}
        </p>
      </div>

      {(data.pendingPayments?.length ?? 0) > 0 && (
        <div className="notice info">
          <strong>{data.pendingPayments!.length} payment request awaiting your approval.</strong>{" "}
          The assistant prepared it but cannot complete it — review and approve it on{" "}
          <Link to="/bills">Bills &amp; Taxes</Link>.
        </div>
      )}

      <div className="grid three" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-label">Utility balance</div>
          <div className={`stat ${balanceCents > 0 ? "due" : "ok"}`}>
            {data.utility?.totalBalance ?? "$0.00"}
          </div>
          <div className="muted">{balanceCents > 0 ? "Payment due" : "Nothing owed"}</div>
        </div>
        <div className="card">
          <div className="card-label">Open 311 requests</div>
          <div className="stat">{openRequests.length}</div>
          <div className="muted">{data.requests?.count ?? 0} reported in total</div>
        </div>
        <div className="card">
          <div className="card-label">Citations outstanding</div>
          <div className={`stat ${(data.citations?.outstandingCents ?? 0) > 0 ? "due" : "ok"}`}>
            {data.citations?.outstanding ?? "$0.00"}
          </div>
          <div className="muted">{data.citations?.count ?? 0} on file</div>
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <h3>Recent service requests</h3>
          {openRequests.length === 0 && <div className="muted">Nothing open right now.</div>}
          <ul className="record-list">
            {(data.requests?.requests ?? []).slice(0, 5).map((r) => (
              <li key={r.requestNumber}>
                <div className="record-main">
                  <div className="record-title">{r.categoryLabel}</div>
                  <div className="ref">{r.requestNumber}</div>
                </div>
                <Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge>
              </li>
            ))}
          </ul>
          <Link to="/requests">
            <button className="secondary small">All requests</button>
          </Link>
        </div>

        <div className="card">
          <h3>Permits & licenses</h3>
          {(data.permits?.count ?? 0) === 0 && <div className="muted">No applications on file.</div>}
          <ul className="record-list">
            {(data.permits?.permits ?? []).slice(0, 5).map((p) => (
              <li key={p.permitNumber}>
                <div className="record-main">
                  <div className="record-title">{p.typeLabel}</div>
                  <div className="ref">{p.permitNumber}</div>
                </div>
                <Badge tone={statusTone(p.status)}>{humanize(p.status)}</Badge>
              </li>
            ))}
          </ul>
          <Link to="/permits">
            <button className="secondary small">All permits</button>
          </Link>
        </div>

        <div className="card">
          <h3>Program registrations</h3>
          {(data.registrations?.count ?? 0) === 0 && (
            <div className="muted">Nobody in the household is registered this season.</div>
          )}
          <ul className="record-list">
            {(data.registrations?.registrations ?? []).map((r) => (
              <li key={`${r.program}-${r.participantName}`}>
                <div className="record-main">
                  <div className="record-title">{r.program}</div>
                  <div className="tiny">{r.participantName}</div>
                </div>
                <Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge>
              </li>
            ))}
          </ul>
          <Link to="/programs">
            <button className="secondary small">Browse programs</button>
          </Link>
        </div>

        <div className="card">
          <h3>Household</h3>
          <div className="kv">
            <span className="k">Service address</span>
            <span className="v">{data.profile?.serviceAddress}</span>
          </div>
          <div className="kv">
            <span className="k">Household size</span>
            <span className="v">{data.profile?.householdSize}</span>
          </div>
          <div className="kv">
            <span className="k">Open code cases</span>
            <span className="v">{data.codeCases?.count ?? 0}</span>
          </div>
          <div className="tiny" style={{ marginTop: 10 }}>
            Ask the assistant to update your mailing address or alert preferences.
          </div>
        </div>
      </div>
    </>
  );
}
