// Every <select> and <datalist> in the CRM renders through here (see jsx-runtime.js), so each one
// puts its recent and most used choices first without any change to the form that uses it.
import { Children, Fragment, isValidElement, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { recordUse, topValues, usageFor } from "./selectUsage";

const TOP_LABEL = "Recent and most used";

const flatten = (children) => Children.toArray(children).flatMap((c) => (isValidElement(c) && c.type === Fragment ? flatten(c.props.children) : [c]));
const textOf = (node) => Children.toArray(node).map((c) => (typeof c === "string" || typeof c === "number" ? c : "")).join("");
const valueOf = (o) => String(o.props.value ?? textOf(o.props.children));
const isOption = (c) => isValidElement(c) && c.type === "option";
const isGroup = (c) => isValidElement(c) && c.type === "optgroup";

// Rows repeat a field, so their numbers are dropped from its name.
const fieldKey = (props, items) => {
  const name = props.id || props.name || props["aria-label"];
  if (name) return String(name).replace(/-\d+-/g, "--");
  return `opts:${items.filter(isOption).slice(0, 4).map(valueOf).join("|")}`;
};

function reorder(items, key) {
  const options = items.flatMap((c) => (isGroup(c) ? flatten(c.props.children).filter(isOption) : isOption(c) ? [c] : []));
  const real = options.filter((o) => valueOf(o) !== "");
  if (real.length < 2) return null;
  const top = topValues(usageFor(key), real.map(valueOf));
  if (!top.length) return null;
  const moved = new Set(top);
  const keep = (o) => !isOption(o) || !moved.has(valueOf(o));
  const placeholders = items.filter((c) => isOption(c) && valueOf(c) === "");
  const rest = items.filter((c) => !(isOption(c) && valueOf(c) === "")).flatMap((c) => {
    if (!isGroup(c)) return keep(c) ? [c] : [];
    const left = flatten(c.props.children).filter(keep);
    return left.length ? [{ ...c, props: { ...c.props, children: left } }] : [];
  });
  return { top: top.map((v) => real.find((o) => valueOf(o) === v)), placeholders, rest };
}

export function SmartSelect(props) {
  const { children, multiple, onChange } = props;
  const items = flatten(children);
  const key = fieldKey(props, items);
  const [, bump] = useState(0);
  if (multiple) return jsx("select", { ...props });
  const order = reorder(items, key);
  const change = (e) => {
    recordUse(key, e.target.value);
    onChange?.(e);
  };
  // The order changes when the field is next left, so a choice does not jump under the pointer.
  const blur = (e) => { bump((n) => n + 1); props.onBlur?.(e); };
  const body = order
    ? [...order.placeholders, jsx("optgroup", { label: TOP_LABEL, children: order.top }, "crm-top"), ...order.rest]
    : items;
  return jsxs("select", { ...props, onChange: change, onBlur: blur, children: body });
}

// Suggestion lists: same order, for the values people type or pick.
export function SmartDatalist(props) {
  const items = flatten(props.children);
  const order = props.id ? reorder(items, `list:${props.id}`) : null;
  if (!order) return jsx("datalist", { ...props });
  return jsxs("datalist", { ...props, children: [...order.top, ...order.rest] });
}

export function recordList(props) {
  const { list, onBlur } = props;
  return { ...props, onBlur: (e) => { recordUse(`list:${list}`, e.target.value.trim()); onBlur?.(e); } };
}
