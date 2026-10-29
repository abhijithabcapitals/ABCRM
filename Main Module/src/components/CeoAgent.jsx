import CeoAgentWorkspace from "@ceo-agent";

// The CEO Agent page lives in the sibling "CEO Agent Module" folder. It uses
// its own Supabase project, configured by the two VITE_CEO_* variables.
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
          supabaseUrl={import.meta.env.VITE_CEO_SUPABASE_URL}
          publishableKey={import.meta.env.VITE_CEO_SUPABASE_PUBLISHABLE_KEY}
        />
      </div>
    </div>
  );
}
