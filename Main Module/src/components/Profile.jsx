import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";

const LOGO_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const EMPTY = { id: null, name: "", body_text: "", logo_url: "", is_default: false };

// Profile page. The Mail section holds the user's own email signatures, which they
// edit here, and lists colleagues' signatures read-only. Signatures are shared:
// every reply composer (Business Development, CEO Inbox) offers all of them.
export default function Profile({ profile }) {
  const [signatures, setSignatures] = useState([]);
  const [shared, setShared] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [logoFile, setLogoFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: sessionData }, { data, error: loadError }] = await Promise.all([
      supabase.auth.getSession(),
      supabase.from("email_signatures")
        .select("id, user_id, name, body_text, logo_url, is_default, created_at, owner:profiles(full_name, email)")
        .order("created_at"),
    ]);
    setLoading(false);
    if (loadError) { setError(`Could not load your signatures: ${loadError.message}`); return; }
    const me = sessionData?.session?.user?.id;
    setSignatures((data || []).filter((s) => s.user_id === me));
    setShared((data || []).filter((s) => s.user_id !== me));
  }, []);

  useEffect(() => { load(); }, [load]);

  function edit(signature) {
    setError("");
    setLogoFile(null);
    setForm(signature ? { ...signature, logo_url: signature.logo_url || "" } : { ...EMPTY, is_default: signatures.length === 0 });
  }

  async function uploadLogo(file) {
    const { data: userData } = await supabase.auth.getUser();
    const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${userData.user.id}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from("email-signatures").upload(path, file, { contentType: file.type });
    if (uploadError) throw uploadError;
    return supabase.storage.from("email-signatures").getPublicUrl(path).data.publicUrl;
  }

  async function save(event) {
    event.preventDefault();
    if (!form.name.trim() || !form.body_text.trim()) { setError("Give the signature a name and some text."); return; }
    if (logoFile && !LOGO_TYPES.includes(logoFile.type)) { setError("The logo must be a PNG, JPG, GIF or WebP image."); return; }
    if (logoFile && logoFile.size > 1024 * 1024) { setError("The logo must be 1 MB or smaller."); return; }
    setBusy(true);
    setError("");
    try {
      const logo_url = logoFile ? await uploadLogo(logoFile) : form.logo_url || null;
      if (form.is_default) {
        const { data: userData } = await supabase.auth.getUser();
        const { error: clearError } = await supabase.from("email_signatures").update({ is_default: false })
          .eq("is_default", true).eq("user_id", userData.user.id);
        if (clearError) throw clearError;
      }
      const row = { name: form.name.trim(), body_text: form.body_text.trim(), logo_url, is_default: form.is_default, updated_at: new Date().toISOString() };
      const { error: saveError } = form.id
        ? await supabase.from("email_signatures").update(row).eq("id", form.id)
        : await supabase.from("email_signatures").insert(row);
      if (saveError) throw saveError;
      setForm(null);
      setLogoFile(null);
      await load();
    } catch (saveError) {
      setError(saveError.message || "Could not save the signature.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(signature) {
    if (!window.confirm(`Delete the signature "${signature.name}"?`)) return;
    const { error: deleteError } = await supabase.from("email_signatures").delete().eq("id", signature.id);
    if (deleteError) { setError(deleteError.message); return; }
    if (form?.id === signature.id) setForm(null);
    load();
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Profile</div>
          <div className="page-subtitle">{profile?.full_name || "Your account"} · {profile?.role || "member"}</div>
        </div>
      </div>

      <div className="content-area" style={{ maxWidth: 820 }}>
        <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 16 }}>Mail</h2>
              <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#6b7280" }}>
                Email signatures, shared with everyone in the CRM. Pick one in any reply composer; it is added to the end of
                every reply before you can send. You can edit only the signatures you created.
              </p>
            </div>
            {!form && <button type="button" className="btn btn-primary btn-sm" onClick={() => edit(null)}>＋ Add signature</button>}
          </div>

          {error && <p style={{ color: "#b91c1c", fontSize: 12.5, margin: "0 0 12px" }} role="alert">{error}</p>}

          {form && (
            <form onSubmit={save} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 16, marginBottom: 16, background: "#fafbfb" }}>
              <div className="form-group">
                <label className="form-label" htmlFor="sig-name">Name</label>
                <input id="sig-name" value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. AB Capital – Bharat" />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="sig-text">Signature text</label>
                <textarea id="sig-text" value={form.body_text} maxLength={2000} rows={5} onChange={(e) => setForm({ ...form, body_text: e.target.value })}
                  placeholder={"Regards\nBharat Bajaj\nAB Capital Services\n+971-585619500"} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="sig-logo">Logo (PNG, JPG, GIF or WebP, up to 1 MB)</label>
                <input id="sig-logo" type="file" accept={LOGO_TYPES.join(",")} onChange={(e) => setLogoFile(e.target.files?.[0] || null)} />
                {(logoFile || form.logo_url) && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                    <img src={logoFile ? URL.createObjectURL(logoFile) : form.logo_url} alt="Signature logo" style={{ maxHeight: 48, maxWidth: 180 }} />
                    <button type="button" className="btn btn-sm" onClick={() => { setLogoFile(null); setForm({ ...form, logo_url: "" }); }}>Remove logo</button>
                  </div>
                )}
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 14 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
                Select this signature automatically in new replies
              </label>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn btn-sm" onClick={() => setForm(null)} disabled={busy}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? "Saving…" : "Save signature"}</button>
              </div>
            </form>
          )}

          {loading ? <p style={{ fontSize: 12.5, color: "#6b7280" }}>Loading signatures…</p>
            : signatures.length === 0 && !form ? <p style={{ fontSize: 12.5, color: "#6b7280" }}>No signatures yet.</p>
              : (
                <div style={{ display: "grid", gap: 10 }}>
                  {signatures.map((s) => (
                    <div key={s.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 14, display: "flex", gap: 14, justifyContent: "space-between" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>
                          {s.name}{s.is_default && <span style={{ marginLeft: 8, fontSize: 11, color: "var(--accent)" }}>Default</span>}
                        </div>
                        <pre style={{ margin: "6px 0 0", fontFamily: "inherit", fontSize: 12.5, color: "#374151", whiteSpace: "pre-wrap" }}>{s.body_text}</pre>
                        {s.logo_url && <img src={s.logo_url} alt="" style={{ marginTop: 8, maxHeight: 40, maxWidth: 160 }} />}
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "flex-start", flexShrink: 0 }}>
                        <button type="button" className="btn btn-sm" onClick={() => edit(s)}>Edit</button>
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(s)}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

          {!loading && shared.length > 0 && (
            <>
              <h3 style={{ margin: "20px 0 8px", fontSize: 13.5 }}>Shared by colleagues</h3>
              <div style={{ display: "grid", gap: 10 }}>
                {shared.map((s) => (
                  <div key={s.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 14, background: "#fafbfb" }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {s.name}
                      <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: "#6b7280" }}>by {s.owner?.full_name || s.owner?.email || "a colleague"}</span>
                    </div>
                    <pre style={{ margin: "6px 0 0", fontFamily: "inherit", fontSize: 12.5, color: "#374151", whiteSpace: "pre-wrap" }}>{s.body_text}</pre>
                    {s.logo_url && <img src={s.logo_url} alt="" style={{ marginTop: 8, maxHeight: 40, maxWidth: 160 }} />}
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
