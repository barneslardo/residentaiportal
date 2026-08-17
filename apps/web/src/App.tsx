import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, type Me } from "./api";
import { Masthead } from "./components/Chrome";
import { Assistant } from "./components/Assistant";
import LoginPage from "./pages/LoginPage";
import OverviewPage from "./pages/OverviewPage";
import BillsPage from "./pages/BillsPage";
import RequestsPage from "./pages/RequestsPage";
import PermitsPage from "./pages/PermitsPage";
import CitationsPage from "./pages/CitationsPage";
import ProgramsPage from "./pages/ProgramsPage";
import StaffPage from "./pages/StaffPage";
import AuditPage from "./pages/AuditPage";

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [meta, setMeta] = useState<{ oidcEnabled?: boolean; devLoginEnabled?: boolean }>({});
  const [loading, setLoading] = useState(true);
  const [dataVersion, setDataVersion] = useState(0);

  const loadMe = useCallback(async () => {
    try {
      const res = await api.get<Me | null>("/auth/me");
      setMe(res.data);
      setMeta((res.meta ?? {}) as { oidcEnabled?: boolean; devLoginEnabled?: boolean });
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  async function signOut() {
    await api.post("/auth/logout").catch(() => undefined);
    setMe(null);
  }

  if (loading) {
    return (
      <div className="login-wrap">
        <div className="login-card">Loading the Riverbend portal…</div>
      </div>
    );
  }

  if (!me) {
    return <LoginPage meta={meta} onSignedIn={loadMe} />;
  }

  // The assistant re-renders portal data after any successful write, so a
  // payment or 311 report made through chat shows up without a manual refresh.
  const bump = () => setDataVersion((v) => v + 1);

  return (
    <>
      <Masthead me={me} onSignOut={signOut} />
      <div className="shell">
        <main className="main">
          <Routes>
            <Route path="/" element={<OverviewPage me={me} version={dataVersion} />} />
            <Route path="/bills" element={<BillsPage version={dataVersion} onChange={bump} />} />
            <Route path="/requests" element={<RequestsPage me={me} version={dataVersion} onChange={bump} />} />
            <Route path="/permits" element={<PermitsPage me={me} version={dataVersion} onChange={bump} />} />
            <Route path="/citations" element={<CitationsPage version={dataVersion} onChange={bump} />} />
            <Route path="/programs" element={<ProgramsPage me={me} version={dataVersion} onChange={bump} />} />
            <Route path="/staff" element={<StaffPage me={me} />} />
            <Route
              path="/audit"
              element={me.role === "admin" ? <AuditPage version={dataVersion} /> : <Navigate to="/" replace />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <div className="footer">
            City of Riverbend is a fictional municipality built to demonstrate Okta-secured AI agents.
            All records, residents, and payments shown here are simulated — no money moves and no real
            person is represented.
          </div>
        </main>
        <Assistant me={me} onDataChanged={bump} />
      </div>
    </>
  );
}
