// Every tab bar in the CRM renders through here (see jsx-runtime.js), so each person can drag its
// tabs into their own order without any change to the page that uses it. Kept per user in this browser.
import { Children, cloneElement, isValidElement, useState } from "react";
import { jsx } from "react/jsx-runtime";
import { moveTab, orderTabs, readTabOrder, saveTabOrder } from "../tabs.js";
import { usageUser } from "./selectUsage.js";

const BAR = /(?:^|\s)(?:tabs|bk-nav|bk-tabs|bd-nav|bd-detail-tabs|bd-leadgen-tabs|ea-tabs|ceo-switch|hr-switch|crm-tabs)(?:\s|$)/;
// Onboarding stages run in a fixed sequence, so their order means something.
const FIXED = /(?:^|\s)bk-cm-stages(?:\s|$)/;

export const isTabBar = (type, props) =>
  (type === "nav" || type === "div") && typeof props?.className === "string" && BAR.test(props.className) && !FIXED.test(props.className);

// The same bar keeps its order when a person gains or loses a tab, so a named bar uses only its name
// and its first tab. A bar with no name is known by all its tabs.
export function barId(label, keys) {
  const sorted = [...keys].sort();
  return label ? `${label}|${sorted[0]}` : sorted.join(",");
}

export function DragTabs({ as, children, ...rest }) {
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const [, redraw] = useState(0);
  const user = usageUser();
  const items = Children.toArray(children);
  if (!user || items.length < 2 || !items.every((c) => isValidElement(c) && (c.type === "button" || c.type === "div"))) return jsx(as, { ...rest, children });

  const store = `${user}:bar:${barId(rest["aria-label"], items.map((c) => c.key))}`;
  const saved = readTabOrder(store);
  const ordered = orderTabs(items, saved);
  const keys = ordered.map((c) => c.key);
  const finish = () => { setDrag(null); setOver(null); };
  const tabs = ordered.map((tab) => cloneElement(tab, {
    draggable: true,
    className: [tab.props.className, over === tab.key ? "crm-tab-over" : ""].filter(Boolean).join(" ") || undefined,
    onDragStart: (e) => { e.stopPropagation(); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", tab.key); setDrag(tab.key); },
    onDragOver: (e) => { if (!drag) return; e.preventDefault(); e.stopPropagation(); if (over !== tab.key) setOver(tab.key); },
    onDrop: (e) => {
      if (!drag) return;
      e.preventDefault();
      e.stopPropagation();
      // Tabs this person cannot see right now keep their saved place at the end.
      saveTabOrder(store, [...moveTab(keys, drag, tab.key), ...saved.filter((k) => !keys.includes(k))]);
      finish();
      redraw((n) => n + 1);
    },
    onDragEnd: finish,
  }));
  return jsx(as, { ...rest, children: tabs });
}
