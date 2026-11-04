// The Inbox service bound to the app's Supabase client. The factory lives in inboxApi.js so node tests can load it.
import { supabase } from "@app/supabase";
import { createInboxApi } from "./inboxApi.js";

export const inboxApi = createInboxApi(supabase);
// The shape the CEO module's reply window expects.
inboxApi.composerClient = {
  auth: supabase.auth,
  functions: supabase.functions,
  storage: supabase.storage,
  from: (table) => supabase.schema("ceo").from(table),
  schema: (schema) => supabase.schema(schema),
};
export default inboxApi;
