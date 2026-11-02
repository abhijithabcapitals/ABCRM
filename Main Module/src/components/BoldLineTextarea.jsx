import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import "./BoldLineTextarea.css";

// A textarea that shows whole lines wrapped in asterisks (signature lines such as *Regards,*) in bold,
// without the asterisks, as they appear in the sent email. A browser textarea cannot style part of its
// text, so its own text is transparent and a mirror behind it draws the visible text. The stored value
// keeps the asterisks. On a bold line the caret sits slightly off the visible letters.
const BOLD_LINE = /^([ \t]*)\*([^*\n]+)\*[ \t]*$/;
const COPIED = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "color", "boxSizing",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"];

function mirrorLines(text) {
  return text.split("\n").map((line, index) => {
    const bold = line.match(BOLD_LINE);
    return (
      <span key={index}>
        {index > 0 && "\n"}
        {bold ? <>{bold[1]}<b>{bold[2]}</b></> : line}
      </span>
    );
  });
}

const BoldLineTextarea = forwardRef(function BoldLineTextarea({ wrapperClassName = "", className = "", value = "", onScroll, ...props }, ref) {
  const input = useRef(null);
  const mirror = useRef(null);
  useImperativeHandle(ref, () => input.current);

  function syncScroll() {
    if (mirror.current && input.current) mirror.current.scrollTop = input.current.scrollTop;
  }

  // Runs on every render: font size and padding change with the composer's size (for example when maximized).
  useLayoutEffect(() => {
    const style = window.getComputedStyle(input.current);
    for (const key of COPIED) mirror.current.style[key] = style[key];
    syncScroll();
  });

  return (
    <div className={`bold-draft ${wrapperClassName}`.trim()}>
      <div ref={mirror} className="bold-draft-mirror" aria-hidden="true">
        {mirrorLines(value)}
        {"\n"}
      </div>
      <textarea
        {...props}
        ref={input}
        className={`bold-draft-input ${className}`.trim()}
        value={value}
        onScroll={(event) => { syncScroll(); onScroll?.(event); }}
      />
    </div>
  );
});

export default BoldLineTextarea;
