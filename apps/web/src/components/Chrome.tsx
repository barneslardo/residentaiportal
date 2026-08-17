import { NavLink } from "react-router-dom";
import type { Me } from "../api";

export function Seal({ size = 40 }: { size?: number }) {
  return (
    <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M6 22h20M8 22v-9m5 9v-9m6 9v-9m5 9v-9M16 4l11 7H5z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type NavItem = { to: string; label: string; end?: boolean };

const NAV_RESIDENT: NavItem[] = [
  { to: "/", label: "Overview", end: true },
  { to: "/bills", label: "Bills & Taxes" },
  { to: "/requests", label: "311 Requests" },
  { to: "/permits", label: "Permits & Licenses" },
  { to: "/citations", label: "Citations" },
  { to: "/programs", label: "Programs" },
];

const NAV_STAFF: NavItem[] = [
  { to: "/staff", label: "Department Console" },
  { to: "/requests", label: "311 Queue" },
  { to: "/permits", label: "Permits" },
];

export function Masthead({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const nav = me.role === "resident" ? NAV_RESIDENT : [...NAV_STAFF, { to: "/programs", label: "Programs" }];
  if (me.role === "admin") {
    nav.push({ to: "/audit", label: "Agent Audit Log" });
    nav.push({ to: "/agents", label: "AI Agent Inventory" });
  }

  return (
    <header>
      <div className="gov-banner">
        An official demonstration site — City of Riverbend is a fictional municipality
      </div>
      <div className="masthead">
        <div className="seal">
          <Seal />
        </div>
        <div>
          <div className="masthead-title">City of Riverbend</div>
          <div className="masthead-sub">Resident Services Portal</div>
        </div>
        <div className="masthead-spacer" />
        <div className="who">
          <div className="who-name">{me.displayName}</div>
          <div className="who-persona">{me.persona ?? "Resident"}</div>
        </div>
        <button className="secondary small" onClick={onSignOut}>
          Sign out
        </button>
      </div>
      <nav className="navbar">
        {nav.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end ?? false}>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}

export function Badge({
  tone,
  children,
}: {
  tone: "grey" | "green" | "red" | "amber" | "navy";
  children: React.ReactNode;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

/** Consistent colour language for the many status vocabularies in the portal. */
export function statusTone(status: string): "grey" | "green" | "red" | "amber" | "navy" {
  const s = status.toLowerCase();
  if (["paid", "closed", "approved", "issued", "abated", "settled", "registered", "passed", "dismissed"].includes(s))
    return "green";
  if (["overdue", "denied", "failed", "in_collections", "unpaid"].includes(s)) return "red";
  if (["due", "needs_info", "pending_documentation", "contested", "partial", "notice_sent", "registered_unpaid"].includes(s))
    return "amber";
  if (["open", "submitted", "under_review", "acknowledged", "scheduled", "in_progress", "hearing_scheduled"].includes(s))
    return "navy";
  return "grey";
}

export function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
