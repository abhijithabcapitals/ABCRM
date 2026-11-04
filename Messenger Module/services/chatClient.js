// The chat service bound to the app's Supabase client. The factory lives in chatApi.js so node tests can load it.
import { supabase } from "@app/supabase";
import { createChatApi } from "./chatApi.js";

export const chatApi = createChatApi(supabase);
export default chatApi;
