import { useMemo } from "react";
import DOMPurify from "dompurify";

// Every imported or edited HTML body goes through DOMPurify before it reaches the page.
export default function SafeHtml({ html }) {
  const clean = useMemo(() => DOMPurify.sanitize(String(html ?? "")), [html]);
  return <div className="kn-html" dangerouslySetInnerHTML={{ __html: clean }} />;
}
