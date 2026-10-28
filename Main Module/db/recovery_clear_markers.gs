// One-off recovery (Google Apps Script) — paste into the same script project
// as processNewLeads and run once.
//
// During the duplicate-folder incident, tasks created on/after the cutoff got
// NO custom-field values (they were created under throwaway lists with no
// field definitions). This clears the "Task Created" marker for those rows so
// processNewLeads re-creates them correctly — WITH field values — now that the
// Edge Function is fixed and the lists are consolidated.
//
// ORDER OF OPERATIONS (important):
//   1. Deploy the FIXED Edge Function first (no created_at order; never
//      auto-creates on a lookup error). Otherwise re-sync re-creates dupes.
//   2. Soft-delete the 635 field-less tasks in the CRM (created_at >= cutoff).
//   3. Run this function to clear the markers.
//   4. Let processNewLeads run (or run it manually) — tasks re-create with fields.
function clearMarkersSince() {
  const CUTOFF = new Date('2026-07-27T16:00:00Z');
  const ss = SpreadsheetApp.getActive();
  let cleared = 0;
  SHEETS.forEach((cfg) => {
    const s = ss.getSheetByName(cfg.sheetName);
    if (!s) return;
    const lastRow = s.getLastRow(); if (lastRow < 2) return;
    const h = _headers(s);
    const mc = _col(h, MARKER_HEADER);
    if (mc === -1) return;
    const rng = s.getRange(2, mc + 1, lastRow - 1, 1);
    const vals = rng.getValues();
    let dirty = false;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i][0];
      if (v instanceof Date && v >= CUTOFF) { vals[i][0] = ''; cleared++; dirty = true; }
    }
    if (dirty) rng.setValues(vals);
  });
  Logger.log('Cleared ' + cleared + ' markers (>= ' + CUTOFF.toISOString() + ').');
}
