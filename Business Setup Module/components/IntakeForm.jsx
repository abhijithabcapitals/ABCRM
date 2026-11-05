// The public page behind a referral link: the client form, with no login. Terms first when any are published, then the same form and upload area clients get in the portal.
// Only setup-intake is called. What was sent cannot be read back, and a person who needs to change something tells staff.
import { useMemo, useRef, useState } from "react";
import "@banking/components/banking.css";
import "@client-login/portal/portal.css";
import { Button, ErrorNote, PageHead, Panel, Spinner, useLoad } from "@banking/components/shared";
import SetupForm from "@client-login/portal/SetupForm";
import TermsGate from "@client-login/portal/TermsGate";
import { intakePost, intakeToken, intakeUpload } from "../services/intakeApi";

const NOTICE = "We use what you send here to prepare your quote and provide our services. Please send it only if you have the authority to share these documents.";

export default function IntakeForm() {
  const token = useMemo(intakeToken, []);
  const submissionId = useMemo(() => crypto.randomUUID(), []);
  const opened = useLoad(() => intakePost({ action: "open", token }), [token]);
  const [agreed, setAgreed] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [sent, setSent] = useState(false);
  const latest = useRef({});
  const trap = useRef(null);

  const terms = opened.data?.terms;
  const api = useMemo(() => ({
    formSave: async (answers) => { latest.current = answers; },
    formUpload: async (file, kind) => {
      await intakeUpload(token, submissionId, file, kind);
      setDocuments((d) => [...d, { id: crypto.randomUUID(), doc_type: kind, file_name: file.name, status: "pending" }]);
    },
    formSubmit: async () => {
      await intakePost({ action: "submit", token, submission_id: submissionId, answers: latest.current, terms_id: terms?.id ?? null, website: trap.current?.value || "" });
      setSent(true);
    },
  }), [token, submissionId, terms?.id]);

  if (opened.loading && !opened.data) return <div className="bk-root"><Spinner /></div>;
  if (opened.error) return <div className="bk-root"><PageHead title="AB Capital Services FZE" /><ErrorNote message={opened.error} /></div>;
  if (sent) return <div className="bk-root"><PageHead title="Thank you" /><Panel title="We have your details">We will review them and contact you with a quote. If you need to change anything, please tell the person who sent you this link.</Panel></div>;
  if (declined) return <div className="bk-root"><PageHead title="AB Capital Services FZE" /><Panel title="You chose not to agree">We cannot take your documents without your agreement to the Terms and Conditions. <div className="bk-mt"><Button onClick={() => setDeclined(false)}>Read them again</Button></div></Panel></div>;
  if (terms && !agreed) return <TermsGate terms={terms} api={{ acceptTerms: async () => setAgreed(true), logout: () => setDeclined(true) }} onAgreed={() => {}} />;
  return (
    <div className="bk-root">
      <PageHead title="Become a client of AB Capital Services FZE" sub={NOTICE} />
      {/* A trap for simple bots: people never see or fill it. */}
      <input ref={trap} name="website" type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px" }} />
      <SetupForm form={{ status: "Draft", answers: {}, definition: opened.data.definition, documents }} api={api} onChange={async () => {}} />
    </div>
  );
}
