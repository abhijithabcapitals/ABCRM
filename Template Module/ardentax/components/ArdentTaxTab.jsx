// As the CRM mounts it in Template Hub > Company Templates > Ardentax: the page, the real database and storage, and the known clients.
import { useClientLookup } from "@banking/components/ClientLookup";
import { ardentaxApi } from "../services/ardentaxApi";
import ArdentTaxView from "./ArdentTaxView";

export default function ArdentTaxTab({ docType }) {
  const clients = useClientLookup();
  return <ArdentTaxView api={ardentaxApi} clients={clients} docType={docType} embedded />;
}
