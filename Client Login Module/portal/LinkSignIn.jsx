// Opened from a request email (?client_link=...): signs the client in without a password, then shows the portal.
// The token leaves the address bar straight away, so it is not kept in history or shared by copying the address.
import { useEffect, useState } from "react";
import "@banking/components/banking.css";
import "./portal.css";
import { Button, ErrorNote, Spinner } from "@banking/components/shared";
import { portalLinkLogin } from "./portalApi";
import ClientPortal from "./ClientPortal";

export default function LinkSignIn({ link }) {
  const [state, setState] = useState("working");
  const [error, setError] = useState(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("client_link");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    portalLinkLogin(link).then(() => setState("in"), (e) => { setError(e.message); setState("failed"); });
  }, [link]);
  if (state === "in") return <ClientPortal />;
  if (state === "failed") {
    return (
      <div className="bk-root">
        <ErrorNote message={error} />
        <div className="bk-actions"><Button variant="primary" onClick={() => window.location.reload()}>Go to sign in</Button></div>
      </div>
    );
  }
  return <div className="bk-root"><Spinner label="Opening your portal" /></div>;
}
