// A client signed in to the portal gets only the portal. The data rules live on the server, not here.
import { Suspense, lazy } from "react";
import App from "./App.jsx";
import { getPortalToken } from "@client-login/portal/portalApi";

const ClientPortal = lazy(() => import("@client-login/portal/ClientPortal"));
const IntakeForm = lazy(() => import("@business-setup/components/IntakeForm"));

export default function Root() {
  // A referral link: the public form, with no login and no staff code.
  if (new URLSearchParams(window.location.search).get("intake")) return <Suspense fallback={null}><IntakeForm /></Suspense>;
  if (getPortalToken()) return <Suspense fallback={null}><ClientPortal /></Suspense>;
  return <App />;
}
