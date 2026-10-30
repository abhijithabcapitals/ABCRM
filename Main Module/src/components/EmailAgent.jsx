import EmailAgentPanel from "@email-agent";
import { supabase } from "../supabase";

// The Email Agent page reads Email Base through the CRM Supabase project and CRM sign-in.
export default function EmailAgent() {
  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Email Agent</div>
          <div className="page-subtitle">Notifications, calendar entries and follow-ups from your mailboxes</div>
        </div>
      </div>
      <div className="content-area">
        <EmailAgentPanel crmClient={supabase} />
      </div>
    </div>
  );
}
