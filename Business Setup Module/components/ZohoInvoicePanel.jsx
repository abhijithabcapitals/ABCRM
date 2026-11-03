// Where the Zoho invoice step goes once Zoho is connected. It never blocks sending to Accounts.
export default function ZohoInvoicePanel() {
  return <div className="bk-alert bk-alert-warn" role="note">Invoice: Zoho is not connected yet. You can still send this to Accounts.</div>;
}
