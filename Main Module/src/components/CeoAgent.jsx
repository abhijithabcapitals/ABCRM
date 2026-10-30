import CeoAgentWorkspace from "@ceo-agent";
import { supabase } from "../supabase";

// The CEO Agent page and Email Base use the CRM Supabase project and CRM sign-in.
export default function CeoAgent() {
  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">CEO Agent</div>
          <div className="page-subtitle">Private executive capture and memory</div>
        </div>
      </div>
      <div className="content-area">
        <CeoAgentWorkspace
          crmClient={supabase}
        />
      </div>
    </div>
  );
}
