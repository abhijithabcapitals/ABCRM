// A client signed in to the portal gets only the portal. The data rules live on the server, not here.
import { Suspense, lazy } from "react";
import App from "./App.jsx";
import { getPortalToken } from "@client-login/portal/portalApi";

const ClientPortal = lazy(() => import("@client-login/portal/ClientPortal"));

export default function Root() {
  if (getPortalToken()) return <Suspense fallback={null}><ClientPortal /></Suspense>;
  return <App />;
}
