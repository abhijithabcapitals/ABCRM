import CeoAgentWorkspace from "@ceo-agent";
import { supabase } from "../supabase";

// The CEO Agent page lives in the sibling "CEO Agent Module" folder. Its data
// is in the "ceo" schema of the CRM project and it reuses the CRM sign-in.
// Setting VITE_CEO_SUPABASE_URL and VITE_CEO_SUPABASE_PUBLISHABLE_KEY points it
// at a separate CEO project instead, with its own sign-in.
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
          supabaseUrl={import.meta.env.VITE_CEO_SUPABASE_URL}
          publishableKey={import.meta.env.VITE_CEO_SUPABASE_PUBLISHABLE_KEY}
        />
      </div>
    </div>
  );
}
