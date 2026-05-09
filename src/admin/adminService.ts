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
      .select("id, full_name, email, age, gender, country, city, dialect, consent, voice_profile_id, status, created_at")
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
