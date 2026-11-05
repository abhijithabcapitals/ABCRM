import { useEffect, useRef, useState } from "react";
import AlertList from "./AlertList";
import Tiles from "./Tiles";
import { Note, FilterBar, btn } from "./ui";
import { ALERT_PAGE, appendAlertRows, readAlertRows } from "../logic/alertLogic";
import { alertList, alertTiles } from "../services/alertsApi";

// One scope (My, Department or Management) as tiles, filters and a list.
// tileItems(tiles) returns the tile row; an empty row shows no tiles (Management draws its own from the summary).
// Load more appends a page. Another filter, scope or department starts again at the first page; a refresh keeps the rows loaded so far.
export default function ScopeView({ supabase, scope, department, today, onOpen, refreshKey, empty, tileItems, filters }) {
  const [filter, setFilter] = useState("All");
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [tiles, setTiles] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const listKey = `${scope}|${department ?? ""}|${filter}`;
  const shownKey = useRef(null);
  const shownCount = useRef(0);
  const latest = useRef(0);   // only the newest read may write to the list
  shownCount.current = rows.length;

  useEffect(() => {
    const mine = ++latest.current;
    const sameList = shownKey.current === listKey;
    const want = sameList ? Math.max(shownCount.current, ALERT_PAGE) : ALERT_PAGE;
    shownKey.current = listKey;
    if (!sameList) { setRows([]); setTotal(0); }
    setLoading(true);
    setLoadingMore(false);
    setError("");
    (async () => {
      try {
        const [l, t] = await Promise.all([
          readAlertRows((limit, offset) => alertList(supabase, scope, filter, department, limit, offset), want),
          alertTiles(supabase, scope, department),
        ]);
        if (latest.current !== mine) return;
        setRows(l.rows);
        setTotal(l.total);
        setTiles(t);
      } catch (e) {
        if (latest.current === mine) setError(e.message);
      }
      if (latest.current === mine) setLoading(false);
    })();
    return () => { latest.current += 1; };
  }, [supabase, listKey, refreshKey]);

  async function loadMore() {
    const mine = ++latest.current;
    setLoadingMore(true);
    setError("");
    try {
      const l = await alertList(supabase, scope, filter, department, ALERT_PAGE, rows.length);
      if (latest.current !== mine) return;
      setRows((r) => appendAlertRows(r, l?.rows || []));
      setTotal(l?.total || 0);
    } catch (e) {
      if (latest.current === mine) setError(e.message);
    }
    if (latest.current === mine) setLoadingMore(false);
  }

  const items = tiles ? tileItems(tiles) : [];
  return (
    <div>
      {error && <Note tone="bad">{error}</Note>}
      {items.length > 0 && <Tiles items={items} />}
      <FilterBar value={filter} onChange={setFilter} filters={filters} />
      {loading && !rows.length ? (
        <div style={{ color: "#888", fontSize: 13 }}>Loading...</div>
      ) : (
        <>
          <AlertList rows={rows} today={today} onOpen={onOpen} showRead={scope === "My"} showAssignee={scope !== "My"} empty={empty(filter)} />
          {total > rows.length && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "#888", marginTop: 8 }}>
              <span>Showing {rows.length} of {total}.</span>
              <button type="button" style={btn} disabled={loading || loadingMore} onClick={loadMore}>{loadingMore ? "Loading..." : "Load more"}</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
