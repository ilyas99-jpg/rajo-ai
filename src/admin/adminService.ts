import { getSupabase } from "../lib/supabase";
import type { AdminDashboardData, AdminDonor, AdminRecording, ReviewStatus } from "./adminTypes";

type DonorRelation = NonNullable<AdminRecording["donor"]>;
type RecordingRow = Omit<AdminRecording, "donor" | "signed_audio_url" | "audio_error"> & {
  voice_donors: DonorRelation | DonorRelation[] | null;
};

// Signed URLs expire after 1 hour. The admin can click "Refresh Data" to renew them.
const SIGNED_URL_EXPIRY_SECONDS = 3600;

// Strip any leading slash or bucket prefix that may appear in legacy rows.
function normalizePath(rawPath: string): string {
  return rawPath.replace(/^\/+/, "").replace(/^voice-recordings\//, "");
}

export async function fetchAdminDashboardData(): Promise<AdminDashboardData> {
  const sb = getSupabase();

  const [donorsResult, recordingsResult] = await Promise.all([
    sb
      .from("voice_donors")
      .select("id, full_name, email, age_range, gender, country, city, dialect, consent, voice_profile_id, status, created_at")
      .order("created_at", { ascending: false }),
    sb
      .from("voice_recordings")
      .select(`
        id,
        donor_id,
        sentence_id,
        sentence_text,
        audio_url,
        audio_path,
        duration_seconds,
        dialect,
        gender,
        age_range,
        country,
        city,
        device_type,
        background_noise,
        quality_score,
        speaking_speed,
        consent,
        status,
        review_notes,
        reviewed_at,
        created_at,
        voice_donors (
          id,
          full_name,
          email,
          age_range,
          gender,
          dialect,
          country,
          city
        )
      `)
      .order("created_at", { ascending: false }),
  ]);

  if (donorsResult.error) {
    throw new Error(`Could not load donors: ${donorsResult.error.message}`);
  }

  if (recordingsResult.error) {
    throw new Error(`Could not load recordings: ${recordingsResult.error.message}`);
  }

  const rawRecordings = (recordingsResult.data ?? []) as unknown as RecordingRow[];

  // Collect every unique, non-empty audio path to sign in one batch request.
  const paths = rawRecordings
    .map((r) => (r.audio_path ? normalizePath(r.audio_path) : ""))
    .filter(Boolean);

  // One round-trip to Supabase Storage → signed URLs for all recordings.
  const signedUrlMap = new Map<string, string>();

  if (paths.length > 0) {
    const { data: signedUrls } = await sb.storage
      .from("voice-recordings")
      .createSignedUrls(paths, SIGNED_URL_EXPIRY_SECONDS);

    if (signedUrls) {
      for (const item of signedUrls) {
        if (item.signedUrl && item.path) {
          signedUrlMap.set(item.path, item.signedUrl);
        }
      }
    }
  }

  const recordings: AdminRecording[] = rawRecordings.map((recording) => {
    const cleanPath = recording.audio_path ? normalizePath(recording.audio_path) : "";
    const signedUrl = signedUrlMap.get(cleanPath) ?? "";
    const audioError = !recording.audio_path
      ? "Recording file missing"
      : !signedUrl
        ? "Could not generate audio URL"
        : "";

    return {
      ...recording,
      audio_url: signedUrl,
      audio_error: audioError,
      donor: Array.isArray(recording.voice_donors)
        ? recording.voice_donors[0] ?? null
        : recording.voice_donors,
      signed_audio_url: signedUrl,
    };
  });

  return {
    donors: (donorsResult.data ?? []) as AdminDonor[],
    recordings,
  };
}

export async function updateRecordingStatus(
  recordingId: string,
  status: ReviewStatus,
): Promise<void> {
  const sb = getSupabase();

  const { error } = await sb
    .from("voice_recordings")
    .update({
      status,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", recordingId);

  if (error) throw new Error(`Could not update recording: ${error.message}`);
}

export async function updateRecordingQualityScore(
  recordingId: string,
  qualityScore: number,
): Promise<void> {
  const { error } = await getSupabase()
    .from("voice_recordings")
    .update({ quality_score: qualityScore })
    .eq("id", recordingId);

  if (error) throw new Error(`Could not update quality score: ${error.message}`);
}

export async function deleteRecording(recording: AdminRecording): Promise<void> {
  const sb = getSupabase();

  if (recording.audio_path) {
    const cleanPath = normalizePath(recording.audio_path);
    const { error: storageError } = await sb.storage
      .from("voice-recordings")
      .remove([cleanPath]);

    if (storageError) {
      throw new Error(`Could not delete audio file: ${storageError.message}`);
    }
  }

  const { error } = await sb.from("voice_recordings").delete().eq("id", recording.id);

  if (error) throw new Error(`Could not delete recording row: ${error.message}`);
}

// ── Dataset CSV export ────────────────────────────────────────

export type ExportOptions = {
  includeSignedUrls: boolean;
};

// Standard CSV quoting: wrap in double-quotes if the value contains
// a comma, double-quote, or newline; escape inner double-quotes as "".
function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

type ExportRow = {
  id: string;
  donor_id: string;
  audio_path: string | null;
  sentence_id: string;
  sentence_text: string;
  dialect: string | null;
  gender: string | null;
  age_range: string | null;
  country: string | null;
  city: string | null;
  duration_seconds: number | null;
  quality_score: number | null;
  status: string;
  created_at: string;
  voice_donors:
    | { age_range: string | null; gender: string | null; dialect: string | null; country: string | null; city: string | null }
    | Array<{ age_range: string | null; gender: string | null; dialect: string | null; country: string | null; city: string | null }>
    | null;
};

export async function exportDatasetCsv(options: ExportOptions): Promise<void> {
  const sb = getSupabase();

  const { data, error } = await sb
    .from("voice_recordings")
    .select(`
      id,
      donor_id,
      audio_path,
      sentence_id,
      sentence_text,
      dialect,
      gender,
      age_range,
      country,
      city,
      duration_seconds,
      quality_score,
      status,
      created_at,
      voice_donors ( age_range, gender, dialect, country, city )
    `)
    .eq("status", "approved")
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Export failed: ${error.message}`);

  const rows = (data ?? []) as ExportRow[];

  // Batch-generate signed download URLs (500 paths per request).
  const signedUrlMap = new Map<string, string>();

  if (options.includeSignedUrls && rows.length > 0) {
    const paths = rows
      .map((r) => (r.audio_path ? normalizePath(r.audio_path) : ""))
      .filter(Boolean);

    const BATCH = 500;
    for (let i = 0; i < paths.length; i += BATCH) {
      const { data: signed } = await sb.storage
        .from("voice-recordings")
        .createSignedUrls(paths.slice(i, i + BATCH), 3600);

      if (signed) {
        for (const item of signed) {
          if (item.signedUrl && item.path) signedUrlMap.set(item.path, item.signedUrl);
        }
      }
    }
  }

  const headers = [
    "recording_id",
    "donor_id",
    "audio_path",
    "sentence_id",
    "sentence_text",
    "language",
    "dialect",
    "gender",
    "age_range",
    "country",
    "city",
    "duration_seconds",
    "quality_score",
    "status",
    "created_at",
    ...(options.includeSignedUrls ? ["signed_download_url_1hr"] : []),
  ];

  const csvLines = rows.map((r) => {
    const donor = Array.isArray(r.voice_donors) ? (r.voice_donors[0] ?? null) : r.voice_donors;
    const cleanPath = r.audio_path ? normalizePath(r.audio_path) : "";
    const fields: (string | number | null | undefined)[] = [
      r.id,
      r.donor_id,
      r.audio_path ?? "",
      r.sentence_id,
      r.sentence_text,
      "Somali",
      r.dialect   || donor?.dialect   || "",
      r.gender    || donor?.gender    || "",
      r.age_range || donor?.age_range || "",
      r.country   || donor?.country   || "",
      r.city      || donor?.city      || "",
      r.duration_seconds ?? "",
      r.quality_score    ?? "",
      r.status,
      r.created_at,
      ...(options.includeSignedUrls ? [signedUrlMap.get(cleanPath) ?? ""] : []),
    ];
    return fields.map(escapeCsvField).join(",");
  });

  // UTF-8 BOM (﻿) ensures Excel opens Somali text correctly.
  const csv = "﻿" + [headers.join(","), ...csvLines].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rajo-ai-dataset-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
