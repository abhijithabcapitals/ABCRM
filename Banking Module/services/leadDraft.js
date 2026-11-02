// Keeps an unfinished New Lead, with its files, in this browser (IndexedDB) so a refresh or closed tab loses nothing.
// One draft per signed-in person. It is removed when the lead is saved or cancelled, or after MAX_AGE_DAYS.
import { useSyncExternalStore } from "react";

const DB_NAME = "crm-new-lead";
const STORE = "drafts";
const MAX_AGE_DAYS = 30;
const WRITE_DELAY = 300;

let memory = null; // the current draft, without waiting on the database
let summaries = {}; // owner -> { files, name }
let leadOpen = false;
let timer = null;
let writtenFiles = "";
const listeners = new Set();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };

const openDb = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

// Browser storage can be blocked (private windows). The draft then lasts only until a refresh.
async function withStore(mode, work) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = work(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(req?.result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    });
  } catch (e) {
    console.error("Could not use browser storage for the unfinished lead:", e);
    return undefined;
  }
}

const metaKey = (owner) => `${owner}:meta`;
const filesKey = (owner) => `${owner}:files`;
const fileKeyOf = (files) => files.map((f) => `${f.name}/${f.file.size}`).join("|");
const worthKeeping = (d) => d.files.length > 0 || !!(d.lead.company_name || d.lead.contact_person || d.lead.mobile) || Object.keys(d.kyc).length > 0;
const summaryOf = (d) => ({ files: d.files.length, name: d.lead.company_name || "" });

function setSummary(owner, value) {
  summaries = { ...summaries, [owner]: value };
  notify();
}

function writeMeta(draft) {
  const { files, ...rest } = draft;
  withStore("readwrite", (s) => s.put({ ...rest, savedAt: Date.now(), files: files.map(({ file: _f, ...f }) => f) }, metaKey(draft.owner)));
}

function flush() {
  if (!timer) return;
  clearTimeout(timer);
  timer = null;
  if (memory) writeMeta(memory);
}

if (typeof window !== "undefined") window.addEventListener("pagehide", flush);

export async function loadDraft(owner) {
  if (memory?.owner === owner) return memory;
  const [meta, stored] = await Promise.all([withStore("readonly", (s) => s.get(metaKey(owner))), withStore("readonly", (s) => s.get(filesKey(owner)))]);
  if (!meta) { setSummary(owner, null); return null; }
  if (Date.now() - meta.savedAt > MAX_AGE_DAYS * 86400000) { clearDraft(owner); return null; }
  const files = meta.files.filter((f) => stored?.[f.name]).map((f) => ({ ...f, file: stored[f.name] }));
  const draft = { ...meta, files };
  memory = draft;
  writtenFiles = fileKeyOf(files);
  setSummary(owner, summaryOf(draft));
  return draft;
}

// Called after every change. Files go in at once, because they are what staff cannot retype; the rest is batched.
export function saveDraft(draft) {
  if (!worthKeeping(draft)) {
    if (memory) clearDraft(draft.owner);
    return;
  }
  const readingChanged = draft.reading !== memory?.reading;
  memory = draft;
  const key = fileKeyOf(draft.files);
  if (key !== writtenFiles) {
    writtenFiles = key;
    const map = Object.fromEntries(draft.files.map((f) => [f.name, f.file]));
    withStore("readwrite", (s) => s.put(map, filesKey(draft.owner)));
  }
  clearTimeout(timer);
  timer = setTimeout(() => { timer = null; if (memory) writeMeta(memory); }, readingChanged ? 0 : WRITE_DELAY);
  const now = summaries[draft.owner];
  const next = summaryOf(draft);
  if (now?.files !== next.files || now?.name !== next.name) setSummary(draft.owner, next);
}

export function clearDraft(owner) {
  clearTimeout(timer);
  timer = null;
  memory = null;
  writtenFiles = "";
  withStore("readwrite", (s) => { s.delete(filesKey(owner)); return s.delete(metaKey(owner)); });
  setSummary(owner, null);
}

// Reading was stopped by hand, so opening the lead must not start it again.
export function noteReadingStopped() {
  if (!memory?.reading) return;
  memory = { ...memory, reading: false };
  writeMeta(memory);
}

export function setLeadOpen(open) {
  leadOpen = open;
  notify();
}

// { files, name } while this person has an unfinished lead and is not looking at it.
export const useUnfinishedLead = (owner) => useSyncExternalStore(subscribe, () => (leadOpen ? null : summaries[owner] ?? null));
