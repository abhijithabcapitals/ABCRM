// A client signed in to the portal gets only the portal. The data rules live on the server, not here.
import { Suspense, lazy } from "react";
import App from "./App.jsx";
import { getPortalToken } from "@client-module/portal/portalApi";

const ClientPortal = lazy(() => import("@client-module/portal/ClientPortal"));

export default function Root() {
  if (getPortalToken()) return <Suspense fallback={null}><ClientPortal /></Suspense>;
  return <App />;
}
