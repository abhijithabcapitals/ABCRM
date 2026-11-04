// The only file that talks to the Windows app's native side. In a browser, isDesktop() is false and the rest does nothing.
const native = () => window.__TAURI__;
export const isDesktop = () => !!native()?.core;

const invoke = (name, args) => (isDesktop() ? native().core.invoke(name, args) : Promise.resolve(null));

export const setUnread = (count) => invoke("set_unread", { count }).catch(() => {});
export const notify = (title, body) => invoke("notify", { title, body }).catch(() => {});
export const openExternal = (url) => invoke("open_url", { url });
export const showWindow = () => invoke("show_window").catch(() => {});
export const autostartEnabled = () => invoke("autostart_get");
export const setAutostart = (on) => invoke("autostart_set", { on });
export const appVersion = () => invoke("app_version");
export const takeStartLinks = () => invoke("start_links").then((list) => list || [], () => []);

export function onAppLink(handler) {
  if (!isDesktop()) return () => {};
  const off = native().event.listen("app-link", (e) => handler(e.payload));
  return () => { off.then((stop) => stop()).catch(() => {}); };
}

// Opens a link that takes a moment to fetch. A browser needs its tab opened before the wait, or it blocks it. The Windows app hands the link to the default browser.
export async function openLink(getUrl) {
  if (isDesktop()) {
    await openExternal(await getUrl());
    return;
  }
  const tab = window.open("", "_blank");
  try {
    const url = await getUrl();
    if (tab) { tab.opener = null; tab.location = url; } else window.location.assign(url);
  } catch (e) {
    tab?.close();
    throw e;
  }
}
