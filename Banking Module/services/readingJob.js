// One document read in the background, so staff can leave the page and come back when it is finished.
// It lives in memory: it survives moving around the CRM, but not closing or reloading the browser tab.
import { useSyncExternalStore } from "react";

let job = null;
let nextId = 1;
let openWanted = false;
const listeners = new Set();

const set = (next) => {
  job = next;
  listeners.forEach((l) => l());
};
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const warnBeforeLeaving = (e) => { e.preventDefault(); e.returnValue = ""; };
const stopWarning = () => window.removeEventListener("beforeunload", warnBeforeLeaving);

export const useReadingJob = () => useSyncExternalStore(subscribe, () => job);

// run(onProgress, onPercent) does the reading and resolves to the documents read. Starting replaces any earlier job.
export function startReading({ kind, label, owner, view, total }, run) {
  const id = nextId++;
  const isCurrent = () => job?.id === id;
  set({ id, kind, label, owner, view, total, done: 0, percent: 0, status: "reading" });
  window.addEventListener("beforeunload", warnBeforeLeaving);
  run(
    (done) => { if (isCurrent()) set({ ...job, done }); },
    (percent) => { if (isCurrent()) set({ ...job, percent: Math.max(job.percent, Math.min(99, Math.floor(percent))) }); },
  ).then(
    (docs) => { if (isCurrent()) { stopWarning(); set({ ...job, done: job.total, percent: 100, status: "done", docs }); } },
    (e) => { if (isCurrent()) { stopWarning(); set({ ...job, status: "failed", error: e.message }); } },
  );
}

// Hands a finished job to the page that asked for it, once.
export function takeResult(kind) {
  if (job?.kind !== kind || job.status === "reading") return null;
  const finished = job;
  set(null);
  return finished;
}

// Forgets the job. A read already in progress finishes unseen.
export function discardReading() {
  stopWarning();
  set(null);
}

export function requestOpen() {
  openWanted = true;
  set(job && { ...job });
}

export function takeOpenRequest() {
  const wanted = openWanted;
  openWanted = false;
  return wanted;
}
