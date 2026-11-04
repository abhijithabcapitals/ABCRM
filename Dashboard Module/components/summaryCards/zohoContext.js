import { createContext, useContext } from "react";

// The snapshot row, kept live by ZohoSection. Bodies fall back to what their card loaded.
export const SnapshotContext = createContext(null);
export const useSnapshot = () => useContext(SnapshotContext);
