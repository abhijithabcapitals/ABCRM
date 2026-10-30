export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Table<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Profile = {
  user_id: string;
  display_name: string | null;
  role: "owner" | "admin" | "member";
  timezone: string;
  require_mfa: boolean;
  created_at: string;
  updated_at: string;
};

export type Capture = {
  id: string;
  user_id: string;
  idempotency_key: string;
  input_text: string | null;
  transcript: string | null;
  audio_path: string | null;
  status:
    | "accepted"
    | "transcription_pending"
    | "extraction_pending"
    | "awaiting_review"
    | "database_write_pending"
    | "saved"
    | "external_action_pending"
    | "completed"
    | "failed";
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type CaptureInsert = Pick<Capture, "user_id" | "idempotency_key"> &
  Partial<Pick<Capture, "input_text">>;

export type CeoRecord = {
  id: string;
  user_id: string;
  record_type: string;
  title: string;
  summary: string | null;
  attributes: Json;
  source_capture_id: string | null;
  created_at: string;
  updated_at: string;
};

type RecordInsert = Pick<CeoRecord, "user_id" | "record_type" | "title"> &
  Partial<Pick<CeoRecord, "summary" | "attributes" | "source_capture_id">>;

export type Database = {
  ceo: {
    Tables: {
      profiles: Table<
        Profile,
        Pick<Profile, "user_id"> & Partial<Pick<Profile, "display_name" | "timezone">>,
        Partial<Pick<Profile, "display_name" | "timezone">>
      >;
      captures: Table<
        Capture,
        CaptureInsert,
        Record<never, never>
      >;
      records: Table<
        CeoRecord,
        RecordInsert,
        Partial<Pick<CeoRecord, "title" | "summary" | "attributes">>
      >;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
