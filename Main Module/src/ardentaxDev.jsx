// Development page for the ArdentTax tab, with a fake backend. Not part of the production build (only index.html is built).
import { createRoot } from "react-dom/client";
import ArdentTaxView from "@template-hub/ardentax/components/ArdentTaxView";
import { createFakeApi } from "@template-hub/ardentax/services/fakeApi";

const api = createFakeApi();
window.ardentaxFake = api;
const clients = [{ name: "Sample Trading LLC", contact: "Pat Doe", email: "pat@sample.example", phone: "+971500000000", address: "Office 1, Sample Tower" }];
createRoot(document.getElementById("root")).render(<div style={{ display: "flex" }}><ArdentTaxView api={api} clients={clients} /></div>);
