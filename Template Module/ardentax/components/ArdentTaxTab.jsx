// The tab as the CRM mounts it: the page, the real database and storage, and the known clients.
import { useClientLookup } from "@banking/components/ClientLookup";
import { ardentaxApi } from "../services/ardentaxApi";
import ArdentTaxView from "./ArdentTaxView";

export default function ArdentTaxTab() {
  const clients = useClientLookup();
  return <ArdentTaxView api={ardentaxApi} clients={clients} />;
}
