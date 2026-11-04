// The Windows app: the CRM's login and the Messenger page, and nothing else of the CRM.
import { lazy, Suspense, useEffect, useState } from "react";
import { supabase } from "../supabase";
import Login from "./Login";
import { openExternal, isDesktop } from "@messenger/services/desktop.js";
import CallHost from "@messenger/components/CallHost";

const MessengerApp = lazy(() => import("@messenger/components/MessengerApp"));
const ForcePasswordChange = lazy(() => import("./ForcePasswordChange"));

// A link in a message would otherwise try to open inside the app. It goes to the default browser, https only.
function useExternalLinks() {
  useEffect(() => {
    if (!isDesktop()) return undefined;
    const onClick = (e) => {
      const link = e.target.closest?.('a[target="_blank"]');
      if (!link) return;
      e.preventDefault();
      if (link.protocol === "https:") openExternal(link.href).catch(() => {});
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
}

export default function DesktopApp() {
  const [session, setSession] = useState(undefined); // undefined while the saved login is being read
  const [profile, setProfile] = useState(null);
  const [problem, setProblem] = useState("");
  const user = session?.user;
  const userId = user?.id;
  useExternalLinks();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId) return undefined;
    let live = true;
    supabase.from("profiles").select("id, full_name, role").eq("id", userId).maybeSingle().then(({ data, error }) => {
      if (!live) return;
      if (error || !data) setProblem("Could not load your profile. Please check your connection and restart the app.");
      else { setProfile(data); setProblem(""); }
    });
    return () => { live = false; };
  }, [userId]);

  const signOut = () => { setProfile(null); supabase.auth.signOut(); };

  if (session === undefined) return null;
  if (!user) return <Login onLogin={() => {}} />;
  if (user.user_metadata?.must_change_password) {
    return <Suspense fallback={null}><ForcePasswordChange onDone={() => supabase.auth.refreshSession()} onSignOut={signOut} /></Suspense>;
  }
  if (problem) {
    return (
      <main style={{ padding: 24 }} role="alert">
        <p>{problem}</p>
        <button type="button" style={{ marginTop: 12 }} onClick={signOut}>Sign out</button>
      </main>
    );
  }
  if (!profile) return null;
  return (
    <div className="app-layout">
      <CallHost profile={profile} />
      <div className="app-body">
        <main className="app-main">
          <Suspense fallback={null}><MessengerApp key={profile.id} profile={profile} onSignOut={signOut} /></Suspense>
        </main>
      </div>
    </div>
  );
}
