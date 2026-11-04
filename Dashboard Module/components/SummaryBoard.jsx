import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  SUMMARY_CARDS, visibleCards, readLayout, saveLayout, clearLayout, canSaveLayout, mergeLayout, moveCard, stepCard, toggleCollapsed, setGroupCollapsed, nextDragMove,
} from "../logic/summaryLayout.js";
import SummaryCard from "./SummaryCard";
import { BdBody, BankingBody, SetupBody, AccountingBody, HrBody, TaxBody, NotificationsBody } from "./summaryCards/DepartmentBodies";
import "./summary.css";

const DEPARTMENT_BODIES = {
  bd: BdBody, banking: BankingBody, setup: SetupBody, accounting: AccountingBody, hr: HrBody, tax: TaxBody, notifications: NotificationsBody,
};
const SLIDE_MS = 220;
const DRAG_TYPE = "application/x-crm-summary-card";
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
// Wait for the last slide to finish, or cards passing under the pointer swap straight back.
const stillSliding = (d) => performance.now() < d.waitUntil;
const waitForSlide = (d) => {
  d.waitUntil = performance.now() + SLIDE_MS;
};

// The cards below the Dashboard, in groups. `zoho` is null, or { header, bodies: { [cardId]: Component }, load, epoch }.
// A new epoch starts the Zoho cards again, so a card stuck in error recovers after a successful refresh.
export default function SummaryBoard({ profile, tabs, onNavigate, api, zoho }) {
  const userId = profile?.id;
  const visible = useMemo(() => visibleCards(SUMMARY_CARDS, { isAdmin: profile?.role === "admin", tabs }), [profile?.role, tabs]);
  const [layout, setLayout] = useState(() => readLayout(userId, visible));

  // Tabs arrive after the first paint, and can change: pick up the saved layout for the new card list.
  const [seen, setSeen] = useState(visible);
  if (seen !== visible) {
    setSeen(visible);
    setLayout(readLayout(userId, visible));
  }

  const slots = useRef(new Map());
  const before = useRef(null);
  const refocus = useRef(null);
  const drag = useRef(null);
  const [draggingId, setDraggingId] = useState(null);
  const zohoRequest = useRef(null);

  // Other cards slide into place: measure before the reorder, then play the difference back.
  useLayoutEffect(() => {
    const first = before.current;
    before.current = null;
    if (!first || reducedMotion()) return;
    for (const [id, el] of slots.current) {
      const was = first.get(id);
      if (!was) continue;
      const now = el.getBoundingClientRect();
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      if (dx || dy) {
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: SLIDE_MS, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
    }
  }, [layout]);

  // Reordering detaches the focused button, and the end of the list disables it: put focus back.
  useLayoutEffect(() => {
    const step = refocus.current;
    refocus.current = null;
    const slot = step && slots.current.get(step.id);
    if (!slot) return;
    const button = (dir) => slot.querySelector(`[aria-label$=" ${dir}"]`);
    const same = button(step.delta < 0 ? "up" : "down");
    (same.disabled ? button(step.delta < 0 ? "down" : "up") : same).focus();
  }, [layout]);

  const show = (next) => {
    if (next.order !== layout.order) {
      before.current = new Map([...slots.current].map(([id, el]) => [id, el.getBoundingClientRect()]));
    }
    setLayout(next);
  };
  // Until a member's tabs load, only some cards show, so nothing is stored yet.
  const saveAllowed = canSaveLayout({ isAdmin: profile?.role === "admin", tabs });
  const change = (next) => {
    if (next === layout) return;
    show(next);
    if (saveAllowed) saveLayout(userId, next);
  };

  const step = (id, group, delta) => {
    const next = stepCard(layout, group, id, delta);
    if (next !== layout) refocus.current = { id, delta };
    change(next);
  };

  const reset = () => {
    show(mergeLayout(null, visible));
    if (saveAllowed) clearLayout(userId);
  };

  // All Zoho cards share one request. A failure clears it so Retry asks again.
  const loadZoho = () => {
    if (!zohoRequest.current) {
      zohoRequest.current = Promise.resolve().then(zoho.load).catch((error) => {
        zohoRequest.current = null;
        throw error;
      });
    }
    return zohoRequest.current;
  };

  const startDrag = (e, group, card) => {
    const slot = slots.current.get(card.id);
    const box = slot.getBoundingClientRect();
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(DRAG_TYPE, card.id);
    e.dataTransfer.setDragImage(slot, e.clientX - box.left, e.clientY - box.top);
    drag.current = { id: card.id, group, start: layout, dropped: false, waitUntil: 0, lastTarget: null };
    // Changing the page inside dragstart can cancel the drag in Chrome.
    requestAnimationFrame(() => setDraggingId(card.id));
  };
  const endDrag = () => {
    // Dropped outside the group: put the cards back as they were.
    if (drag.current && !drag.current.dropped) show(drag.current.start);
    drag.current = null;
    requestAnimationFrame(() => setDraggingId(null));
  };

  const onDragOver = (e, group) => {
    const d = drag.current;
    if (!d || d.group !== group) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (stillSliding(d)) return;
    const over = e.target.closest?.("[data-card-id]")?.dataset.cardId;
    const { move, lastTarget } = nextDragMove(d.lastTarget, over, d.id);
    d.lastTarget = lastTarget;
    if (!move) return;
    waitForSlide(d);
    show(moveCard(layout, group, d.id, move));
  };

  const onDrop = (e, group) => {
    const d = drag.current;
    if (!d || d.group !== group) return;
    e.preventDefault();
    d.dropped = true;
    if (saveAllowed) saveLayout(userId, layout);
  };

  const groups = [
    { id: "departments", title: "Departments", bodies: DEPARTMENT_BODIES },
    zoho && { id: "zoho", title: "Zoho Financials", header: zoho.header, bodies: zoho.bodies },
  ].filter(Boolean);
  const byId = new Map(visible.map((c) => [c.id, c]));

  return (
    <section className="sum-board" aria-label="Summary cards">
      {groups.map((group) => {
        const cards = (layout.order[group.id] || []).map((id) => byId.get(id)).filter(Boolean);
        if (!cards.length) return null;
        const ids = cards.map((c) => c.id);
        return (
          <div className="sum-group" key={group.id}>
            <div className="sum-group-head">
              <h3>{group.title}</h3>
              <button type="button" className="sum-link" onClick={() => change(setGroupCollapsed(layout, ids, false))}>Expand all</button>
              <button type="button" className="sum-link" onClick={() => change(setGroupCollapsed(layout, ids, true))}>Collapse all</button>
              {group.id === "departments" && <button type="button" className="sum-link sum-reset" onClick={reset}>Reset layout</button>}
            </div>
            {group.header}
            <div className="sum-grid" onDragOver={(e) => onDragOver(e, group.id)} onDrop={(e) => onDrop(e, group.id)}>
              {cards.map((card, i) => {
                const Body = group.bodies?.[card.id];
                return (
                  <div
                    key={card.id}
                    data-card-id={card.id}
                    className={`sum-slot${draggingId === card.id ? " is-dragging" : ""}`}
                    style={{ "--i": i }}
                    ref={(el) => {
                      if (el) slots.current.set(card.id, el);
                      else slots.current.delete(card.id);
                    }}
                  >
                    <SummaryCard
                      key={group.id === "zoho" ? zoho.epoch ?? 0 : undefined}
                      card={card}
                      collapsed={layout.collapsed.includes(card.id)}
                      onToggle={() => change(toggleCollapsed(layout, card.id))}
                      onMove={(delta) => step(card.id, group.id, delta)}
                      first={i === 0}
                      last={i === cards.length - 1}
                      dragHandlers={{ draggable: true, onDragStart: (e) => startDrag(e, group.id, card), onDragEnd: endDrag }}
                      load={group.id === "zoho" ? loadZoho : api?.[card.id]}
                      onOpen={card.view ? () => onNavigate?.(card.view) : undefined}
                    >
                      {(data) => (Body ? <Body data={data} /> : null)}
                    </SummaryCard>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}
