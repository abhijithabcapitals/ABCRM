// The Quote sheet and the Custom Quote sheet as a form, in the workbook's order.
import { Panel } from "@banking/components/shared";
import { ClientLists, listIdFor } from "@banking/components/ClientLookup";
import ClientPicker from "@banking/components/ClientPicker";
import { applyClient, pickClient } from "@banking/logic/clientLookup";
import { CHARGE_TYPES, COVERAGE, ERP_LIST, ROW_KEYS, money } from "../logic/quoteModel";

const CLIENT_MAP = { legal: "name", poc: "contact", email: "email", phone: "phone", address: "address" };
const TIER_ROWS = [["E", "Emerging"], ["S", "Established"], ["C", "Corporate"]];
const ROW_LABELS = {
  ONB: "Onboarding & Setup", SUP: "Integration support (client IT integrates)", FULL: "Full integration by Ardentax", GAP: "Gap assessment", TRN: "TRN fee (multi-entity)",
  ANN: "Annual package (always included)", ENT: "Entities included", CMP: "Complementary scope", X1: "Annual Maintenance Service", X2: "Training and Demo one-time fee",
};
const STANDARD_WORDING = { ONB: "Standard wording: 6 bullet points", SUP: "Standard wording: API access and documentation", FULL: "Standard wording: 9 bullet points" };

const setIn = (obj, path, value) => {
  if (!path.length) return value;
  const [head, ...rest] = path;
  const copy = Array.isArray(obj) ? [...obj] : { ...obj };
  copy[head] = setIn(obj?.[head], rest, value);
  return copy;
};

function Text({ id, label, value, onChange, hint, list, type = "text", required, placeholder, wide, disabled, picker }) {
  return (
    <div className={`bk-field${wide ? " at-wide" : ""}`}>
      <label htmlFor={id}>{label}{required && <em> *</em>}</label>
      {picker ? <ClientPicker id={id} value={value} clients={picker} disabled={disabled} onChange={onChange} /> : <input id={id} type={type} list={list} value={value ?? ""} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />}
      {hint && <small className="bk-muted">{hint}</small>}
    </div>
  );
}

function Choice({ id, label, value, options, onChange, hint }) {
  return (
    <div className="bk-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
      {hint && <small className="bk-muted">{hint}</small>}
    </div>
  );
}

export default function QuoteForm({ details: d, setDetails, totals: t, clients, locked, fixedType }) {
  const put = (path) => (value) => setDetails((cur) => setIn(cur, path, value));
  const putClient = (field) => (value, picked) => setDetails((cur) => ({ ...cur, client: picked ? pickClient(cur.client, CLIENT_MAP, field, picked, clients) : CLIENT_MAP[field] ? applyClient(cur.client, CLIENT_MAP, field, value, clients) : { ...cur.client, [field]: value } }));
  const custom = d.quoteType === "Custom";
  const client = (id, label, field, extra = {}) => <Text id={`at-${id}`} label={label} value={d.client[field]} onChange={putClient(field)} {...extra} />;

  return (
    <div className="at-form">
      <ClientLists clients={clients} />
      <Panel title="Document">
        <div className="bk-grid">
          {locked || fixedType
            ? <div className="bk-field"><label>Document</label><div className="at-fixed">{d.docType === "letter" ? "Engagement Letter" : "Quote"}</div></div>
            : <Choice id="at-doc" label="Document" value={d.docType === "letter" ? "Engagement Letter" : "Quote"} options={["Quote", "Engagement Letter"]} onChange={(v) => put(["docType"])(v === "Quote" ? "quote" : "letter")} hint="Quote = short quotation, no legal terms. Engagement Letter = full terms for signing." />}
          <Choice id="at-type" label="Quote type" value={d.quoteType} options={["Standard", "Custom"]} onChange={put(["quoteType"])} hint="Standard = three package cards. Custom = no cards, your own line items." />
          <Text id="at-date" label="Date" type="date" value={d.date} onChange={put(["date"])} hint="Printed in the letter. The reference uses the issue date." />
        </div>
      </Panel>

      <Panel title="1. Client details" sub="Pick a known client to fill the rest. Blank contact lines are left out of the document.">
        <div className="bk-grid">
          {client("legal", "Client legal name", "legal", { required: true, picker: clients, hint: "Exactly as on the trade licence" })}
          {client("letter", "Client name in the letter", "letterName", { hint: "For a longer form, e.g. with TINs. Blank = legal name" })}
          {client("short", "Short name", "short", { hint: "For the file name" })}
          {client("poc", "POC name", "poc")}
          {client("desig", "POC designation", "pocDesig")}
          {client("phone", "POC phone", "phone", { list: listIdFor("phone") })}
          {client("email", "POC email", "email", { type: "email", list: listIdFor("email"), hint: "The email draft goes here" })}
          {client("city", "City", "city", { hint: "Blank = Dubai" })}
          {client("sign", "Client signatory name", "signName", { hint: "Blank = left empty for signing" })}
          {client("signd", "Client signatory designation", "signDesig")}
          {client("erp", "ERP / accounting system", "erp", { list: "at-erp-list", hint: "Blank = Ardentax web application" })}
          <datalist id="at-erp-list">{ERP_LIST.map((e) => <option key={e} value={e} />)}</datalist>
          {client("addr", "Client address", "address", { wide: true })}
        </div>
      </Panel>

      {custom ? (
        <Panel title="2. Custom quote" sub="No package cards. The quote shows these line items in this order, up to 7. A blank fee leaves the item out.">
          <div className="bk-grid">
            <Text id="at-cvol" label="Invoices included per year" required type="number" value={d.custom.volume} onChange={put(["custom", "volume"])} />
            <Choice id="at-ccov" label="Invoices covered" value={d.custom.coverage} options={COVERAGE} onChange={put(["custom", "coverage"])} />
          </div>
          <div className="bk-table-wrap">
            <table className="bk-table at-rows">
              <thead><tr><th>Service component</th><th>Scope / description</th><th>Fee (AED, or text)</th><th>Fee note</th><th>Charge type</th><th /></tr></thead>
              <tbody>
                {d.custom.items.map((item, i) => (
                  <tr key={i}>
                    <td><input aria-label={`Item ${i + 1} name`} value={item.title} onChange={(e) => put(["custom", "items", i, "title"])(e.target.value)} /></td>
                    <td><input aria-label={`Item ${i + 1} description`} value={item.desc ?? ""} placeholder={t.items[i]?.desc} onChange={(e) => put(["custom", "items", i, "desc"])(e.target.value || null)} /></td>
                    <td><input aria-label={`Item ${i + 1} fee`} value={item.fee} onChange={(e) => put(["custom", "items", i, "fee"])(e.target.value)} /></td>
                    <td><input aria-label={`Item ${i + 1} note`} value={item.note} onChange={(e) => put(["custom", "items", i, "note"])(e.target.value)} /></td>
                    <td><select aria-label={`Item ${i + 1} type`} value={item.type} onChange={(e) => put(["custom", "items", i, "type"])(e.target.value)}>{CHARGE_TYPES.map((c) => <option key={c}>{c}</option>)}</select></td>
                    <td><button type="button" className="bk-link" onClick={() => put(["custom", "items"])(d.custom.items.filter((_, n) => n !== i))}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.custom.items.length < 7 && <button type="button" className="bk-link" onClick={() => put(["custom", "items"])([...d.custom.items, { title: "", desc: "", fee: "", note: "", type: "One-time" }])}>Add a line item</button>}
        </Panel>
      ) : (
        <>
          <Panel title="2. Package cards" sub="The selected card is highlighted and the others are struck through. A card with no documents and no price is left out.">
            <div className="bk-table-wrap">
              <table className="bk-table at-rows">
                <thead><tr><th>Tier</th><th>Entity line on the card</th><th>Documents / year</th><th>Annual price (AED)</th><th>Monthly (AED)</th><th>Legal entity line</th></tr></thead>
                <tbody>
                  {TIER_ROWS.map(([k, name]) => (
                    <tr key={k}>
                      <td>{name}</td>
                      <td><input aria-label={`${name} entity line`} value={d.tiers[k].entity} onChange={(e) => put(["tiers", k, "entity"])(e.target.value)} /></td>
                      <td><input aria-label={`${name} documents`} type="number" value={d.tiers[k].docs} onChange={(e) => put(["tiers", k, "docs"])(e.target.value)} /></td>
                      <td><input aria-label={`${name} annual price`} type="number" value={d.tiers[k].year} onChange={(e) => put(["tiers", k, "year"])(e.target.value)} /></td>
                      <td><input aria-label={`${name} monthly price`} type="number" value={d.tiers[k].month} placeholder={money(t.tierMonth[k])} onChange={(e) => put(["tiers", k, "month"])(e.target.value)} /></td>
                      <td><input aria-label={`${name} legal entity line`} value={d.tiers[k].legal} onChange={(e) => put(["tiers", k, "legal"])(e.target.value)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bk-grid">
              <Choice id="at-sel" label="Selected package" value={d.selected} options={TIER_ROWS.map(([, n]) => n)} onChange={put(["selected"])} />
              <Text id="at-trns" label="TRNs included" type="number" value={d.trns} onChange={put(["trns"])} />
              <Choice id="at-cov" label="Invoices covered" value={d.coverage} options={COVERAGE} onChange={put(["coverage"])} />
            </div>
          </Panel>

          <Panel title="3. Options and terms">
            <div className="bk-grid">
              <Choice id="at-opt" label="Show Option #1 / Option #2?" value={d.options.showOptions ? "Yes" : "No"} options={["No", "Yes"]} onChange={(v) => put(["options", "showOptions"])(v === "Yes")} hint="Yes = both integration rows are shown and the total is TBD" />
              <Text id="at-paid" label="Paid TRNs" type="number" value={d.options.paidTrns} onChange={put(["options", "paidTrns"])} hint="Only used if the TRN fee row is included" />
              <Text id="at-trnfee" label="Fee per TRN (AED)" type="number" value={d.options.trnFee} onChange={put(["options", "trnFee"])} />
              <Text id="at-over" label="Overage per extra invoice (AED)" type="number" value={d.options.overage ?? ""} placeholder={t.overage ? t.overage.toFixed(2) : ""} onChange={(v) => put(["options", "overage"])(v === "" ? null : v)} hint="Blank = annual price / documents + 0.08. Enter 0 to leave the sentence out" />
              <Text id="at-buy" label="Non-solicitation buy-out (AED)" type="number" value={d.options.buyout} onChange={put(["options", "buyout"])} />
            </div>
            <div className="bk-grid">
              <Text id="at-note" wide label="One-time fee note (Inclusions)" value={d.options.oneTimeNote ?? ""} disabled={d.options.oneTimeNote === ""} placeholder={d.options.oneTimeNote === "" ? "Left out" : t.oneTimeNote || "Automatic: nothing to show"} onChange={(v) => put(["options", "oneTimeNote"])(v || null)} />
              <label className="at-check"><input type="checkbox" checked={d.options.oneTimeNote === ""} onChange={(e) => put(["options", "oneTimeNote"])(e.target.checked ? "" : null)} /> Leave this line out</label>
            </div>
          </Panel>

          <Panel title="4. Pricing rows" sub="Include puts the row in the quote, in this order. A row with no fee is left out. An old price shows struck through as a discount.">
            <div className="bk-table-wrap">
              <table className="bk-table at-rows">
                <thead><tr><th>Include</th><th>Row</th><th>Title shown</th><th>Old price</th><th>Fee (AED, or text)</th><th>Fee note</th><th>Charge type</th><th>Description shown</th></tr></thead>
                <tbody>
                  {ROW_KEYS.map((k) => {
                    const r = d.rows[k];
                    const fixed = STANDARD_WORDING[k];
                    const isAnnual = k === "ANN";
                    return (
                      <tr key={k}>
                        <td><input type="checkbox" aria-label={`Include ${ROW_LABELS[k]}`} checked={!!r.inc} disabled={isAnnual} onChange={(e) => put(["rows", k, "inc"])(e.target.checked)} /></td>
                        <td>{ROW_LABELS[k]}</td>
                        <td><input aria-label={`${ROW_LABELS[k]} title`} value={r.title ?? ""} placeholder={t.rows[k].title} onChange={(e) => put(["rows", k, "title"])(e.target.value || null)} /></td>
                        <td><input aria-label={`${ROW_LABELS[k]} old price`} type="number" value={r.old} onChange={(e) => put(["rows", k, "old"])(e.target.value)} /></td>
                        <td><input aria-label={`${ROW_LABELS[k]} fee`} value={r.fee} placeholder={isAnnual ? money(t.annual) : ""} disabled={r.type === "Included"} onChange={(e) => put(["rows", k, "fee"])(e.target.value)} /></td>
                        <td><input aria-label={`${ROW_LABELS[k]} fee note`} value={r.note} onChange={(e) => put(["rows", k, "note"])(e.target.value)} /></td>
                        <td><select aria-label={`${ROW_LABELS[k]} charge type`} value={r.type} onChange={(e) => put(["rows", k, "type"])(e.target.value)}>{CHARGE_TYPES.map((c) => <option key={c}>{c}</option>)}</select></td>
                        <td>{fixed ? <small className="bk-muted">{fixed}</small> : <input aria-label={`${ROW_LABELS[k]} description`} value={r.desc ?? ""} placeholder={t.rows[k].desc} onChange={(e) => put(["rows", k, "desc"])(e.target.value || null)} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
