// Loads what the CRM knows about clients, for forms that fill themselves when a client is chosen.
import { useEffect, useState } from "react";
import { rpc } from "../services/bankingApi";
import { LOOKUP_KEYS, suggestionsFor } from "../logic/clientLookup";

export function useClientLookup(on = true) {
  const [clients, setClients] = useState([]);
  useEffect(() => {
    if (!on) return undefined;
    let live = true;
    rpc("client_lookup").then((r) => { if (live) setClients(r || []); }).catch(() => {}); // forms still work by hand
    return () => { live = false; };
  }, [on]);
  return clients;
}

export const listIdFor = (key) => (LOOKUP_KEYS.includes(key) ? `client-${key}-list` : undefined);

export function ClientLists({ clients, keys = LOOKUP_KEYS }) {
  return keys.filter((k) => LOOKUP_KEYS.includes(k)).map((k) => <datalist key={k} id={listIdFor(k)}>{suggestionsFor(clients, k).map((v) => <option key={v} value={v} />)}</datalist>);
}
