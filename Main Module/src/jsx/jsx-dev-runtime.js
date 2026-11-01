// The development build's half of jsx-runtime.js.
import { Fragment, jsxDEV as baseJsxDEV } from "react/jsx-dev-runtime";
import { swap } from "./jsx-runtime";

export function jsxDEV(type, props, key, isStatic, source, self) { const [t, p] = swap(type, props); return baseJsxDEV(t, p, key, isStatic, source, self); }
export { Fragment };
