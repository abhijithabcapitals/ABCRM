// Business Setup tab: the department's services and documents. The case workflow comes later.
import "@banking/components/banking.css";
import ServiceDesk from "@template-hub/components/ServiceDesk";

export default function BusinessSetup({ profile }) {
  return (
    <div className="bk-root">
      <header className="bk-header"><span className="bk-eyebrow">AB CAPITAL SERVICES FZE</span><h1>Business Setup</h1></header>
      <ServiceDesk department="Business Setup" profile={profile} />
    </div>
  );
}
