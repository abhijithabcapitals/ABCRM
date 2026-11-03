import { useMemo, useState } from "react";
import { Badge, Button, Empty, ErrorNote, Panel, Spinner, fmtDate } from "@banking/components/shared";
import { aed, bankingPriceToText, priceLinesToText, toAmount } from "../logic/copyText.js";
import { groupPriceLines } from "../logic/search.js";
import { groupCopyItem, groupDisplayStatus, isExpired } from "../logic/status.js";
import ResultCard from "./ResultCard";
import CopyButton from "./CopyButton";

const fmtAed = (v) => { const n = toAmount(v); return n === null ? "–" : aed(n); };
const latest = (rows, key) => rows.map((r) => r[key]).filter(Boolean).sort().at(-1);
const deptOf = (l) => l.knowledge_categories?.name || "General";

// One group of price lines. The copy covers the Shareable lines of the group only.
export function PriceGroupCard({ title, lines, today, isAdmin, onEdit }) {
  const item = groupCopyItem(lines);
  return (
    <ResultCard
      title={title}
      department={lines[0] ? deptOf(lines[0]) : undefined}
      updatedAt={latest(lines, "updated_at")}
      status={groupDisplayStatus(lines)}
      visibility={item.visibility}
      stale={lines.some((l) => isExpired(l.valid_until, today))}
      footer={<CopyButton item={item} text={priceLinesToText(lines, title)} />}
    >
      <div className="bk-table-wrap">
        <table className="bk-table">
          <thead><tr><th>Item</th><th className="bk-right">Amount</th><th>Notes</th>{isAdmin && <th />}</tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td data-label="Item">{l.item}</td>
                <td data-label="Amount" className="bk-right">{fmtAed(l.amount_aed)}</td>
                <td data-label="Notes">
                  <span className="kn-badges">
                    {l.status === "Draft" && <Badge tone="warn">Draft</Badge>}
                    {l.visibility === "Internal" && <Badge tone="bad">Internal</Badge>}
                    {isExpired(l.valid_until, today) && <Badge tone="warn">Out of date</Badge>}
                    {l.valid_until && !isExpired(l.valid_until, today) && <small className="bk-note">Valid to {fmtDate(l.valid_until)}</small>}
                  </span>
                </td>
                {isAdmin && <td data-label=""><Button onClick={() => onEdit("price", l)}>Edit</Button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ResultCard>
  );
}

// Banking rows have no status or visibility column; the screen counts them as Approved and Shareable.
export function BankingCard({ row, today }) {
  const item = { ...row, visibility: "Shareable", status: "Approved" };
  const title = row.scheme_name ? `${row.bank_name} - ${row.scheme_name}` : row.bank_name;
  const fields = [["Account opening fee", row.account_opening_fee], ["Initial deposit", row.initial_deposit], ["Minimum balance", row.minimum_balance], ["Other bank charges", row.other_bank_charges], ["Service fee", row.service_fee]];
  return (
    <ResultCard title={title} department="Banking" updatedAt={row.effective_date} status={item.status} visibility={item.visibility}
      stale={isExpired(row.expiry_date, today)} footer={<CopyButton item={item} text={bankingPriceToText(row)} />}>
      <dl className="bk-kv">{fields.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{fmtAed(v)}</dd></div>)}</dl>
    </ResultCard>
  );
}

// lines and banking are useLoad states. They load separately, so a banking failure leaves Business Setup prices in place.
export default function PricingView({ lines, banking, today, isAdmin, onEdit }) {
  const [dept, setDept] = useState("");
  const [sub, setSub] = useState("");
  const rows = lines.data || [];
  const bankRows = banking.data || [];
  const inBanking = dept === "Banking";

  const depts = useMemo(() => [...new Set([...rows.map(deptOf), "Banking"])].sort(), [rows]);
  const subs = useMemo(() => {
    if (!dept) return [];
    if (inBanking) return [...new Set(bankRows.map((b) => b.bank_name))].sort();
    return [...new Set(rows.filter((l) => deptOf(l) === dept).map((l) => l.template))];
  }, [dept, inBanking, rows, bankRows]);

  const shownLines = rows.filter((l) => (!dept || deptOf(l) === dept) && (!sub || inBanking || l.template === sub));
  const shownBanking = bankRows.filter((b) => (!dept || inBanking) && (!sub || b.bank_name === sub));
  const templates = groupPriceLines(shownLines);

  return (
    <div className="kn-stack">
      <div className="bk-note-line">
        <label>Department
          <select value={dept} onChange={(e) => { setDept(e.target.value); setSub(""); }}>
            <option value="">All</option>
            {depts.map((d) => <option key={d}>{d}</option>)}
          </select>
        </label>
        {dept && (
          <label>{inBanking ? "Bank" : "Zone or template"}
            <select value={sub} onChange={(e) => setSub(e.target.value)}>
              <option value="">All</option>
              {subs.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
        )}
        {isAdmin && <Button variant="primary" onClick={() => onEdit("price", null)}>Add price line</Button>}
      </div>

      {lines.loading && !lines.data ? <Spinner label="Loading prices" /> : lines.error ? (
        <><ErrorNote message={lines.error} /><p className="kn-error" role="alert">{lines.error}</p></>
      ) : templates.length ? templates.map((t) => (
        <Panel key={t.template} title={t.template}>
          <div className="kn-stack">
            {t.groups.map((g) => <PriceGroupCard key={g.line_group} title={`${t.template} - ${g.line_group}`} lines={g.lines} today={today} isAdmin={isAdmin} onEdit={onEdit} />)}
          </div>
        </Panel>
      )) : inBanking ? null : (
        <Empty>{rows.length ? "No Business Setup prices match this filter." : "No Business Setup prices are in the Knowledge Base yet. They may not have been imported, or may be awaiting admin review."}</Empty>
      )}

      {(!dept || inBanking) && (
        <Panel title="Banking">
          {banking.loading && !banking.data ? <Spinner label="Loading banking prices" /> : banking.error ? (
            <><ErrorNote message="Banking prices could not load" /><p className="kn-error" role="alert">Banking prices could not load <small>({banking.error})</small></p></>
          ) : shownBanking.length ? (
            <div className="kn-stack">{shownBanking.map((b) => <BankingCard key={b.price_id} row={b} today={today} />)}</div>
          ) : (
            <Empty>{bankRows.length ? "No banking prices match this filter." : "No current banking prices were returned. They may not have been entered yet."}</Empty>
          )}
        </Panel>
      )}
    </div>
  );
}
