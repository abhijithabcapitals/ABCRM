import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readSnapshot, refreshSnapshot } from "../services/summaryApi";
import { snapshotState } from "../logic/summaryFigures.js";
import ZohoHeader from "./summaryCards/ZohoHeader";
import { HealthBody, ArBody, ApBody, RatiosBody, RevenueBody, CostBody, CashBody } from "./summaryCards/ZohoBodies";

const ZOHO_BODIES = { health: HealthBody, ar: ArBody, ap: ApBody, ratios: RatiosBody, revenue: RevenueBody, cost: CostBody, cash: CashBody };

// Owns the one snapshot read for the Zoho cards, and the refresh. For anyone but an admin it asks for nothing.
// Returns { zoho, row }: the zoho prop for SummaryBoard (null for non-admins), and the live row for SnapshotContext.
export function useZohoFinance(isAdmin) {
  const [row, setRow] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [notConnected, setNotConnected] = useState(false);
  const read = useRef(null);
  const opened = useRef(false);

  // One read, shared by every card. A failure clears it so Retry reads again.
  const load = useCallback(() => {
    if (!read.current) {
      read.current = readSnapshot().then((r) => {
        setRow(r);
        setNow(Date.now());
        if (r.error === "not_connected") setNotConnected(true);
        return r;
      }).catch((e) => {
        read.current = null;
        throw e;
      });
    }
    return read.current;
  }, []);

  const run = useCallback(async (force) => {
    setRefreshing(true);
    setNotice("");
    try {
      const result = await refreshSnapshot(force);
      const failedLogin = result?.error === "not_connected";
      setNotConnected(failedLogin);
      if (result?.status === "busy") setNotice("Another refresh is already running. Try again in a minute.");
      // A failure that is skipped later comes back as "fresh": the row holds the error, so read it again.
      const next = await readSnapshot();
      setRow(next);
      if (next.error === "not_connected") setNotConnected(true);
      if (result?.status === "failed" && !failedLogin && next.status !== "failed") setNotice(result.error || "The refresh failed.");
    } catch (e) {
      setNotice(e?.message || "Could not refresh.");
    } finally {
      setNow(Date.now());
      setRefreshing(false);
    }
  }, []);

  // Once per open: read, and refresh in the background when the figures are not fresh. The function sets its own limits.
  useEffect(() => {
    if (!isAdmin || opened.current) return;
    opened.current = true;
    load().then((r) => {
      if (snapshotState(r, Date.now()) !== "fresh") return run(false);
      return null;
    }).catch(() => {});
  }, [isAdmin, load, run]);

  // Keeps the Refresh button's wait honest.
  useEffect(() => {
    if (!isAdmin) return undefined;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [isAdmin]);

  const zoho = useMemo(() => (isAdmin ? {
    header: <ZohoHeader row={row} now={now} refreshing={refreshing} notice={notice} notConnected={notConnected} onRefresh={() => run(true)} />,
    bodies: ZOHO_BODIES,
    load,
  } : null), [isAdmin, row, now, refreshing, notice, notConnected, run, load]);

  return { zoho, row };
}
