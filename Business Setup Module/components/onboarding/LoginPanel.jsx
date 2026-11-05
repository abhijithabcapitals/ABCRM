// The client's login, issued with the quote. The server makes the details and emails them, so nothing secret is ever shown here. When the email did not go,
// or the quote was saved before a login could be issued, staff can issue it or send it again. A refusal is shown in its own words.
import { useState } from "react";
import { Badge, Button, Panel } from "@banking/components/shared";
import { useSetup } from "../SetupContext";
import { issueLogin } from "../../services/businessSetupApi";
import { issueNotice } from "../../logic/issueLogin";
import { itemState, itemTone } from "../../logic/checklist";

export default function LoginPanel({ c, onChanged }) {
  const { can } = useSetup();
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async (resend) => {
    setBusy(true);
    try { setNotice(issueNotice(await issueLogin(c.id, resend))); } catch (e) { setNotice(issueNotice(null, e)); }
    setBusy(false);
    await onChanged?.();
  };
  const manage = can("setup.leads.manage");
  const has = !!c.docs?.login;
  return (
    <Panel title="Client login" sub="Issued with the quote and emailed to the client from info@abcapital.ae.">
      <div className="bk-actions bk-wrap">
        <Badge tone={itemTone(itemState(c, "login"))}>Login: {itemState(c, "login")}</Badge>
        {manage && c.docs?.quote && !has && <Button variant="primary" busy={busy} onClick={() => run(false)}>Issue login</Button>}
        {manage && has && (!notice || notice.resend) && <Button busy={busy} onClick={() => run(true)}>Resend</Button>}
      </div>
      {!c.docs?.quote && <p className="bk-note">The login is issued when the quote is issued.</p>}
      {notice && <div className={`bk-alert ${notice.tone === "ok" ? "bk-alert-ok" : "bk-alert-warn"} bk-mt`} role="status">{notice.text}{notice.note && <> {notice.note}</>}</div>}
    </Panel>
  );
}
