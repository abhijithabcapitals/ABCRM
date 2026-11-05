import { useEffect, useState } from "react";
import AlertList from "./AlertList";
import Tiles from "./Tiles";
import { Note, FilterBar } from "./ui";
import { alertList, alertTiles } from "../services/alertsApi";

// One scope (My, Department or Management) as tiles, filters and a list.
// tileItems(tiles) returns the tile row; an empty row shows no tiles (Management draws its own from the summary).
export default function ScopeView({ supabase, scope, department, today, onOpen, refreshKey, empty, tileItems, filters }) {
  const [filter, setFilter] = useState("All");
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [tiles, setTiles] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const [l, t] = await Promise.all([alertList(supabase, scope, filter, department), alertTiles(supabase, scope, department)]);
        if (!live) return;
        setRows(l?.rows || []);
        setTotal(l?.total || 0);
        setTiles(t);
      } catch (e) {
        if (live) setError(e.message);
      }
      if (live) setLoading(false);
    })();
    return () => { live = false; };
  }, [supabase, scope, department, filter, refreshKey]);

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
          {total > rows.length && <div style={{ fontSize: 12, color: "#888", marginTop: 6 }}>Showing {rows.length} of {total}.</div>}
        </>
      )}
    </div>
  );
}
