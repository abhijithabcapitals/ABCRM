// Development page for the ArdentTax tab, with a fake backend. Not part of the production build (only index.html is built).
/* eslint-disable react-refresh/only-export-components */
import { createRoot } from "react-dom/client";
import ArdentTaxView from "@template-hub/ardentax/components/ArdentTaxView";
import CompanyTemplatesPage from "@template-hub/components/CompanyTemplatesPage";
import { createFakeApi } from "@template-hub/ardentax/services/fakeApi";

const api = createFakeApi();
window.ardentaxFake = api;
const clients = [{ name: "Sample Trading LLC", contact: "Pat Doe", email: "pat@sample.example", phone: "+971500000000", address: "Office 1, Sample Tower" }];
// ?hub=1 shows it as Template Hub does.
const Pane = ({ docType }) => <ArdentTaxView api={api} clients={clients} docType={docType} embedded />;
const hub = new URLSearchParams(location.search).has("hub");
createRoot(document.getElementById("root")).render(<div style={{ display: "flex" }}>{hub ? <CompanyTemplatesPage canArdentax ArdentaxPane={Pane} /> : <ArdentTaxView api={api} clients={clients} />}</div>);
