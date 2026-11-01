// Supabase Edge Function "crm-connections": backs Settings > Email Accounts and
// Settings > Integrations. CRM admins only. Values are written once and never returned.
//
// Actions (POST JSON { action, ... }):
//   overview          { names? } -> mailboxes, saved credential labels, and for each name where its value lives
//   mailbox_save      { id?, address, username?, password?, display_name?, imap_host, imap_port, smtp_host?, smtp_port?, owner_user_id? }
//                     Logs in to IMAP (and SMTP when set) first; nothing is saved if a login fails.
//   mailbox_test      { id }  -> tries the saved login
//   mailbox_enable    { id, enabled }  -> pause or resume syncing (mail already stored is kept)
//   credential_set    { name, value, integration_id?, integration_name?, field_label? }
//   credential_delete { name }
//
// Deploy with ceo-mail-sync and ceo-mail-reply as sibling folders under supabase/functions,
// because it reuses their IMAP and SMTP clients:
//   supabase functions deploy crm-connections --project-ref pnnakrhfzyxudjaghoxx --use-api

import { createClient } from "npm:@supabase/supabase-js@2";
import { ImapClient } from "../ceo-mail-sync/imap.ts";
import { SmtpClient } from "../ceo-mail-reply/smtp.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

class InputError extends Error {}

const passwordSecretName = (address: string) => `MAIL_PASSWORD_${address.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
const HOST = /^(?!localhost$)(?!\d+\.\d+\.\d+\.\d+$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function host(value: unknown, label: string) {
  const h = String(value || "").trim().toLowerCase();
  if (!HOST.test(h)) throw new InputError(`Enter a valid ${label} server name, e.g. imap.hostinger.com.`);
  return h;
}
function port(value: unknown, fallback: number) {
  const p = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new InputError("Enter a valid port number.");
  return p;
}

// Plain-language login failures. Server replies never contain the password.
function loginHint(what: string, message: string) {
  if (/could not reach|connection|timed out|dns|lookup/i.test(message)) return `${what}: could not reach the server. Check the server name and port (SSL/TLS ports only, usually 993 and 465).`;
  if (/auth|login|credential|invalid|password|535|534/i.test(message)) return `${what}: the server refused this username or password. Gmail and Yahoo need an App Password, not your normal password.`;
  return `${what}: ${message.slice(0, 200)}`;
}

async function testLogin(m: { imap_host: string; imap_port: number; smtp_host?: string | null; smtp_port?: number | null }, user: string, pass: string) {
  const imap = new ImapClient(m.imap_host, m.imap_port, 20_000);
  try {
    await imap.connect(user, pass);
    await imap.logout().catch(() => {});
  } catch (e) {
    imap.close();
    throw new InputError(loginHint("Incoming mail (IMAP)", (e as Error).message));
  }
  if (m.smtp_host) {
    try {
      await new SmtpClient(m.smtp_host, m.smtp_port || 465, 20_000).verify(user, pass, m.imap_host);
    } catch (e) {
      throw new InputError(loginHint("Outgoing mail (SMTP)", (e as Error).message));
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const userDb = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    auth: { persistSession: false },
  });
  const { data: auth } = await userDb.auth.getUser();
  if (!auth?.user) return json({ error: "Sign in first." }, 401);
  const { data: me } = await userDb.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (me?.role !== "admin") return json({ error: "Only a CRM admin can manage connections." }, 403);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const mailboxes = admin.schema("email_base").from("mailboxes");

  const inVault = async (name: string) => {
    const { data } = await admin.rpc("credential_get", { p_name: name });
    return typeof data === "string" && data ? data : null;
  };

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid request body." }, 400); }

  try {
    if (body.action === "overview") {
      const [{ data: boxes, error }, { data: saved }, { data: people }] = await Promise.all([
        mailboxes.select("id, address, login_user, display_name, owner_user_id, imap_host, imap_port, smtp_host, smtp_port, enabled, status, last_synced_at, last_error").order("address"),
        admin.from("integration_credentials").select("name, integration_id, integration_name, field_label, updated_at"),
        admin.from("profiles").select("id, full_name, email").order("full_name"),
      ]);
      if (error) throw new Error(error.message);
      const savedNames = new Set((saved || []).map((c) => c.name));
      const where = (name: string) => savedNames.has(name) ? "settings" : Deno.env.get(name) ? "supabase" : null;
      const names: string[] = Array.isArray(body.names) ? body.names.filter((n: unknown) => typeof n === "string" && /^[A-Z][A-Z0-9_]{1,99}$/.test(n)) : [];
      return json({
        mailboxes: (boxes || []).map((m) => ({ ...m, password_in: where(passwordSecretName(m.address)) })),
        credentials: saved || [],
        stored: Object.fromEntries(names.map((n) => [n, where(n)])),
        people: people || [],
      });
    }

    if (body.action === "mailbox_save") {
      const existing = body.id ? (await mailboxes.select("*").eq("id", body.id).maybeSingle()).data : null;
      if (body.id && !existing) throw new InputError("Mailbox not found.");
      const address = existing ? existing.address : String(body.address || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new InputError("Enter a valid email address.");
      const username = String(body.username || "").trim() || address;
      const smtpHost = String(body.smtp_host || "").trim() ? host(body.smtp_host, "outgoing (SMTP)") : null;
      const fields = {
        address,
        login_user: username.toLowerCase() === address ? null : username,
        display_name: String(body.display_name || "").trim().slice(0, 120) || null,
        imap_host: host(body.imap_host, "incoming (IMAP)"),
        imap_port: port(body.imap_port, 993),
        smtp_host: smtpHost,
        smtp_port: port(body.smtp_port, 465),
        owner_user_id: typeof body.owner_user_id === "string" && body.owner_user_id ? body.owner_user_id : existing?.owner_user_id || auth.user.id,
      };

      const secretName = passwordSecretName(address);
      const newPassword = typeof body.password === "string" && body.password ? body.password : null;
      const password = newPassword || await inVault(secretName) || Deno.env.get(secretName) || null;
      if (!password) throw new InputError("Enter the mailbox password.");
      if (!existing) {
        const { data: dup } = await mailboxes.select("id").eq("address", address).maybeSingle();
        if (dup) throw new InputError(`${address} is already added.`);
      }

      await testLogin(fields, username, password);

      if (newPassword) {
        const { error } = await userDb.rpc("admin_credential_set", {
          p_name: secretName, p_value: newPassword, p_integration_id: "email", p_integration_name: "Email", p_field_label: address,
        });
        if (error) throw new Error(error.message);
      }
      const { error: saveError } = existing
        ? await mailboxes.update({ ...fields, last_error: null, updated_at: new Date().toISOString() }).eq("id", existing.id)
        : await mailboxes.insert({ ...fields, tags: ["org"], enabled: true });
      if (saveError) throw new Error(saveError.message);
      await admin.from("admin_audit").insert({ actor: auth.user.id, action: existing ? "mailbox.update" : "mailbox.add", target: address });
      return json({ ok: true });
    }

    if (body.action === "mailbox_test") {
      const { data: m } = await mailboxes.select("*").eq("id", body.id).maybeSingle();
      if (!m) throw new InputError("Mailbox not found.");
      const secretName = passwordSecretName(m.address);
      const password = await inVault(secretName) || Deno.env.get(secretName);
      if (!password) throw new InputError("No password is saved for this mailbox.");
      await testLogin(m, m.login_user || m.address, password);
      return json({ ok: true });
    }

    if (body.action === "mailbox_enable") {
      const { error } = await mailboxes.update({ enabled: !!body.enabled }).eq("id", body.id);
      if (error) throw new Error(error.message);
      await admin.from("admin_audit").insert({ actor: auth.user.id, action: body.enabled ? "mailbox.enable" : "mailbox.disable", target: String(body.id) });
      return json({ ok: true });
    }

    if (body.action === "credential_set") {
      const { error } = await userDb.rpc("admin_credential_set", {
        p_name: body.name, p_value: body.value, p_integration_id: body.integration_id ?? null,
        p_integration_name: body.integration_name ?? null, p_field_label: body.field_label ?? null,
      });
      if (error) throw new InputError(error.message);
      return json({ ok: true });
    }

    if (body.action === "credential_delete") {
      const { error } = await userDb.rpc("admin_credential_delete", { p_name: body.name });
      if (error) throw new InputError(error.message);
      return json({ ok: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, e instanceof InputError ? 400 : 500);
  }
});
