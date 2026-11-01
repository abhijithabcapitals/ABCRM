// Set as the JSX runtime in vite.config.js, so dropdowns across every module use SmartSelect.
import { Fragment, jsx as baseJsx, jsxs as baseJsxs } from "react/jsx-runtime";
import { SmartDatalist, SmartSelect, recordList } from "./SmartSelect";

export const swap = (type, props) => {
  if (type === "select") return [SmartSelect, props];
  if (type === "datalist") return [SmartDatalist, props];
  if (type === "input" && props?.list) return [type, recordList(props)];
  return [type, props];
};

export function jsx(type, props, key) { const [t, p] = swap(type, props); return baseJsx(t, p, key); }
export function jsxs(type, props, key) { const [t, p] = swap(type, props); return baseJsxs(t, p, key); }
export { Fragment };
