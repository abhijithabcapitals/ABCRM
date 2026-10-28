// The module's single Supabase client. When integrating into a CRM that
// already has a client, replace this file with a re-export of it, e.g.:
//   export { supabase } from "../../src/supabase";
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);
