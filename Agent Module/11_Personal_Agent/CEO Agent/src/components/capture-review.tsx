"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import type { Json } from "@/lib/supabase/database.types";

type Suggestion = {
  record_type: string;
  title: string;
  summary?: string | null;
  attributes: Record<string, string | number | boolean | null>;
  evidence?: string | null;
};
type Item = Suggestion & { state: "pending" | "saving" | "saved" | "dismissed" };
type Props = { captureId: string; userId: string };

export default function CaptureReview({ captureId, userId }: Props) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function requestSuggestions() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/captures/${captureId}/extract`, { method: "POST" });
      const body = (await response.json()) as { suggestions?: Suggestion[]; error?: string };
      if (!response.ok || !body.suggestions) throw new Error(body.error || "Extraction failed.");
      setItems(body.suggestions.map((suggestion) => ({ ...suggestion, state: "pending" })));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Extraction failed.");
    } finally {
      setBusy(false);
    }
  }

  function setState(index: number, state: Item["state"]) {
    setItems((current) =>
      current?.map((item, i) => (i === index ? { ...item, state } : item)) ?? null,
    );
  }

  async function approve(index: number) {
    const item = items?.[index];
    if (!item) return;
    setState(index, "saving");
    setError("");
    const { error: insertError } = await createClient()
      .from("records")
      .insert({
        user_id: userId,
        record_type: item.record_type,
        title: item.title,
        summary: item.summary || null,
        attributes: { ...item.attributes, evidence: item.evidence ?? null, source: "ai_suggestion" } as Json,
        source_capture_id: captureId,
      });
    if (insertError) {
      setState(index, "pending");
      setError(`Could not save: ${insertError.message}`);
      return;
    }
    setState(index, "saved");
  }

  if (!items) {
    return (
      <div className="review-actions">
        <button className="text-button" disabled={busy} onClick={requestSuggestions} type="button">
          {busy ? "Asking DeepSeek…" : "Suggest records"}
        </button>
        {error && <small className="error-text">{error}</small>}
      </div>
    );
  }

  return (
    <div className="review-panel">
      {!items.length && <small className="muted">Nothing to record in this note.</small>}
      <ul className="suggestion-list">
        {items.map((item, index) => (
          <li className={`suggestion suggestion-${item.state}`} key={index}>
            <div>
              <span className="status-pill">{item.record_type}</span> <strong>{item.title}</strong>
              {item.summary && <p className="muted">{item.summary}</p>}
              {Object.keys(item.attributes).length > 0 && (
                <small className="muted">
                  {Object.entries(item.attributes)
                    .map(([key, value]) => `${key}: ${String(value)}`)
                    .join(" · ")}
                </small>
              )}
            </div>
            {item.state === "pending" || item.state === "saving" ? (
              <div className="suggestion-buttons">
                <button
                  className="primary-button"
                  disabled={item.state === "saving"}
                  onClick={() => approve(index)}
                  type="button"
                >
                  {item.state === "saving" ? "Saving…" : "Approve"}
                </button>
                <button
                  className="text-button"
                  disabled={item.state === "saving"}
                  onClick={() => setState(index, "dismissed")}
                  type="button"
                >
                  Dismiss
                </button>
              </div>
            ) : (
              <small className="muted">{item.state === "saved" ? "Saved" : "Dismissed"}</small>
            )}
          </li>
        ))}
      </ul>
      {error && <small className="error-text">{error}</small>}
    </div>
  );
}
