import { getSupabase } from "../lib/supabase";
import type { AdminDashboardData, AdminDonor, AdminRecording, ReviewStatus } from "./adminTypes";

type DonorRelation = NonNullable<AdminRecording["donor"]>;
type RecordingRow = Omit<AdminRecording, "donor" | "signed_audio_url" | "audio_error"> & {
  voice_donors: DonorRelation | DonorRelation[] | null;
};

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

  const recordings = await Promise.all(
    ((recordingsResult.data ?? []) as unknown as RecordingRow[]).map(async (recording) => {
      const playback = await getPlaybackUrl(recording.audio_path, recording.audio_url);

      return {
        ...recording,
        audio_url: playback.url,
        audio_error: playback.error,
        donor: Array.isArray(recording.voice_donors)
          ? recording.voice_donors[0] ?? null
          : recording.voice_donors,
        signed_audio_url: playback.url,
      };
    }),
  );

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
    const { error: storageError } = await sb.storage
      .from("voice-recordings")
      .remove([recording.audio_path]);

    if (storageError) {
      throw new Error(`Could not delete audio file: ${storageError.message}`);
    }
  }

  const { error } = await sb.from("voice_recordings").delete().eq("id", recording.id);

  if (error) throw new Error(`Could not delete recording row: ${error.message}`);
}
async function getPlaybackUrl(
  audioPath: string,
  savedAudioUrl: string,
): Promise<{ url: string; error: string }> {
  if (!audioPath) {
    return { url: "", error: "Recording file missing" };
  }

  const sb = getSupabase();

  const path = audioPath.replace(/^\/+/, "").replace(/^voice-recordings\//, "");

  const { data } = sb.storage
    .from("voice-recordings")
    .getPublicUrl(path);

  return {
    url: data.publicUrl,
    error: "",
  };
}
