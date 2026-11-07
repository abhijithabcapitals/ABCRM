import { createPortal } from "react-dom";
import { useDockSlot } from "../logic/dockSlot.js";

// Shows a page's own content at the top of the open Bruno dock. Renders nothing while the dock is closed.
export default function BrunoExtra({ children }) {
  const slot = useDockSlot();
  return slot ? createPortal(children, slot) : null;
}
