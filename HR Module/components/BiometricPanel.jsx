import { useState } from "react";
import { Button, ErrorNote, FormModal, Panel, Spinner, fmtDateTime, useAction, useLoad } from "@banking/components/shared";
import { biometricLink, biometricStatus, biometricSync, payrollEmployees } from "../services/hrApi";
import { syncSummary } from "../logic/attendance";

// HR only: e-timeoffice sync status, Sync now, catch-up of a date range, and codes on the device with no matching employee.
// Syncing runs on Supabase every 15 minutes, with no PC needed. Times are shown here; the grid above shows the result.
export default function BiometricPanel({ onChanged }) {
  const status = useLoad(() => biometricStatus(), []);
  const people = useLoad(() => payrollEmployees(), []);
  const reload = async () => { await status.reload(); await onChanged?.(); };
  const { error, busy, act } = useAction(reload);
  const [notice, setNotice] = useState(null);
  const [catchUp, setCatchUp] = useState(false);
  const [linking, setLinking] = useState(null);
  const s = status.data;

  const sync = async (range) => {
    setNotice(null);
    const r = await act(() => biometricSync(range));
    if (r) setNotice(syncSummary(r));
  };
  const employees = (people.data || []).map((e) => ({ value: e.id, label: `${e.employee_code} · ${e.full_name}` }));
  const linkFields = [
    { name: "code", label: "Device code", help: "Empcode on the biometric system. Leave blank to unlink." },
    { name: "employee", label: "Employee", type: "select", required: true, options: employees },
  ];
  const link = async (v) => {
    const r = await biometricLink(v.employee, v.code);
    setNotice(`Linked. ${r.days} day(s) updated, ${r.removed} day(s) removed.`);
    await reload();
  };

  return (
    <Panel title="Biometric sync" sub="e-timeoffice, every 15 minutes. A day with punches becomes Present. A day HR edited by hand is never overwritten, and no day is marked Absent by the sync."
      actions={<>
        <Button onClick={() => setLinking({})}>Link a code</Button>
        <Button onClick={() => setCatchUp(true)}>Catch up dates</Button>
        <Button variant="primary" busy={busy} onClick={() => sync()}>Sync now</Button>
      </>}>
      <ErrorNote message={status.error || error} />
      {notice && <div className="hr-warning" role="status">{notice}</div>}
      {status.loading && !s ? <Spinner label="Loading sync status" /> : s && (
        <>
          <p className="bk-note">
            Last success: {s.last_success_at ? fmtDateTime(s.last_success_at) : "never"}.
            {s.last_stats ? ` ${syncSummary(s.last_stats)}` : ""}
          </p>
          {s.last_error && <ErrorNote message={`Last attempt ${fmtDateTime(s.last_attempt_at)} failed: ${s.last_error}`} />}
          {s.unmatched.length > 0 && (
            <>
              <p className="bk-note"><strong>{s.unmatched.length} device code(s) match no employee.</strong> Their punches are kept but reach no attendance until linked.</p>
              <div className="hr-grid-wrap">
                <table className="hr-grid">
                  <thead><tr><th>Code</th><th>Name on device</th><th>Punches</th><th>Last punch</th><th /></tr></thead>
                  <tbody>
                    {s.unmatched.map((u) => (
                      <tr key={u.emp_code}>
                        <td>{u.emp_code}</td><td>{u.device_name || "–"}</td><td>{u.punches}</td><td>{String(u.last_punch).replace("T", " ").slice(0, 16)}</td>
                        <td><Button onClick={() => setLinking({ code: u.emp_code })}>Link</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {s.linked.length > 0 && (
            <p className="bk-note">Linked codes: {s.linked.map((l) => `${l.biometric_code} = ${l.full_name}`).join(", ")}.</p>
          )}
        </>
      )}
      {catchUp && (
        <FormModal title="Catch up dates" submitLabel="Sync these dates" onClose={() => setCatchUp(false)} onSubmit={(v) => sync({ from: v.from, to: v.to })}
          fields={[{ name: "from", label: "From", type: "date", required: true }, { name: "to", label: "To", type: "date", required: true }]}
          initial={{ from: "", to: "" }} note="Up to 92 days at a time. Days already in an approved payroll month are updated and listed as changes after approval; the approved pay does not change." />
      )}
      {linking && (
        <FormModal title="Link a device code" onClose={() => setLinking(null)} onSubmit={link} fields={linkFields} initial={{ code: linking.code || "", employee: "" }}
          note="Changing a link removes that employee's biometric days that have no punch under the new code. Days edited by hand stay." />
      )}
    </Panel>
  );
}
