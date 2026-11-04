// Set as the JSX runtime in vite.config.js, so dropdowns across every module use SmartSelect
// and tab bars across every module can be rearranged.
import { Fragment, jsx as baseJsx, jsxs as baseJsxs } from "react/jsx-runtime";
import { SmartDatalist, SmartSelect, recordList } from "./SmartSelect";
import { DragTabs, isTabBar } from "./DragTabs";

export const swap = (type, props) => {
  if (type === "select") return [SmartSelect, props];
  if (type === "datalist") return [SmartDatalist, props];
  if (type === "input" && props?.list) return [type, recordList(props)];
  if (isTabBar(type, props)) return [DragTabs, { ...props, as: type }];
  return [type, props];
};

export function jsx(type, props, key) { const [t, p] = swap(type, props); return baseJsx(t, p, key); }
export function jsxs(type, props, key) { const [t, p] = swap(type, props); return baseJsxs(t, p, key); }
export { Fragment };
