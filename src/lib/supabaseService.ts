import { getSupabase } from "./supabase";
import type { RecordingHistoryItem, RecordingMetadata, RegisteredUser } from "../types";

type DonorRow = {
  id: string;
  auth_user_id?: string | null;
  full_name: string;
  email: string;
  age: number;
  gender: RegisteredUser["gender"];
  country: string;
  city: string;
  dialect: string;
  consent: boolean;
  voice_profile_id: string | null;
};

type RecordingRow = {
  id: string;
  sentence_id: string;
  sentence_text: string;
  audio_url: string;
  duration_seconds: number | null;
  status: string;
  created_at: string;
};

export type AuthProfile = {
  donorId: string;
  user: RegisteredUser;
};

export type ProgressSnapshot = {
  totalRecordings: number;
  completedSentenceIds: string[];
  history: RecordingHistoryItem[];
};

const mapDonorRow = (row: DonorRow): AuthProfile => ({
  donorId: row.id,
  user: {
    userId: row.id,
    fullName: row.full_name,
    email: row.email,
    age: row.age,
    gender: row.gender,
    country: row.country,
    city: row.city,
    dialect: row.dialect,
    consent: row.consent,
    voiceProfileId: row.voice_profile_id ?? `voice-profile-${row.id}`,
  },
});

const mapRecordingRow = (row: RecordingRow): RecordingHistoryItem => ({
  id: row.id,
  sentenceId: row.sentence_id,
  sentenceText: row.sentence_text,
  audioUrl: row.audio_url,
  durationSeconds: row.duration_seconds,
  status: row.status,
  createdAt: row.created_at,
});

const donorProfileSelect =
  "id, auth_user_id, full_name, email, age, gender, country, city, dialect, consent, voice_profile_id";

async function getProfileByAuthUserId(authUserId: string): Promise<AuthProfile | null> {
  const { data, error } = await getSupabase()
    .from("voice_donors")
    .select(donorProfileSelect)
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (error) throw new Error(`Could not load your profile: ${error.message}`);
  return data ? mapDonorRow(data as DonorRow) : null;
}

export async function getCurrentSessionProfile(): Promise<AuthProfile | null> {
  const sb = getSupabase();
  const {
    data: { session },
    error: sessionError,
  } = await sb.auth.getSession();

  if (sessionError) throw new Error(`Session restore failed: ${sessionError.message}`);
  if (!session?.user) return null;

  const { data, error } = await sb
    .from("voice_donors")
    .select(donorProfileSelect)
    .eq("auth_user_id", session.user.id)
    .maybeSingle();

  if (error) throw new Error(`Could not load your profile: ${error.message}`);
  return data ? mapDonorRow(data as DonorRow) : null;
}

export async function registerAndCreateProfile(
  user: RegisteredUser,
  password: string,
): Promise<AuthProfile> {
  const sb = getSupabase();
  const { data: signUpData, error: signUpError } = await sb.auth.signUp({
    email: user.email,
    password,
    options: {
      data: {
        full_name: user.fullName,
      },
    },
  });

  if (signUpError) throw new Error(`Registration failed: ${signUpError.message}`);
  const authUser = signUpData.user;
  const authUserId = authUser?.id;
  if (!authUserId || !authUser) {
    throw new Error("Registration failed. Please try again.");
  }

  const isExistingAuthAccount =
    Array.isArray(authUser.identities) && authUser.identities.length === 0;

  if (isExistingAuthAccount) {
    const { error: loginError } = await sb.auth.signInWithPassword({
      email: user.email,
      password,
    });

    if (loginError) {
      throw new Error(
        "An account already exists for this email. Please log in to continue recording.",
      );
    }

    const existingProfile = await getCurrentSessionProfile();
    if (existingProfile) return existingProfile;

    const {
      data: { user: authenticatedUser },
      error: userError,
    } = await sb.auth.getUser();

    if (userError || !authenticatedUser?.id) {
      throw new Error("Registration failed. Could not verify the signed-in user.");
    }

    const donorId = await insertDonor(user, authenticatedUser.id);
    return getProfileByAuthUserId(authenticatedUser.id).then(
      (profile) =>
        profile ?? {
          donorId,
          user: {
            ...user,
            userId: donorId,
            voiceProfileId: user.voiceProfileId || `voice-profile-${donorId}`,
          },
        },
    );
  }

  const existingProfile = await getProfileByAuthUserId(authUserId);
  if (existingProfile) return existingProfile;

  const donorId = await insertDonor(user, authUserId);
  return (
    (await getProfileByAuthUserId(authUserId)) ?? {
      donorId,
      user: {
        ...user,
        userId: donorId,
        voiceProfileId: user.voiceProfileId || `voice-profile-${donorId}`,
      },
    }
  );
}

export async function loginWithPassword(
  email: string,
  password: string,
): Promise<AuthProfile> {
  const sb = getSupabase();
  const { error } = await sb.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });

  if (error) throw new Error(`Login failed: ${error.message}`);

  const profile = await getCurrentSessionProfile();
  if (!profile) {
    throw new Error("Login succeeded, but no RAJO AI voice profile was found for this account.");
  }
  return profile;
}

export async function logoutUser(): Promise<void> {
  const { error } = await getSupabase().auth.signOut();
  if (error) throw new Error(`Logout failed: ${error.message}`);
}

export async function fetchDonorProgress(donorId: string): Promise<ProgressSnapshot> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("voice_recordings")
    .select("id, sentence_id, sentence_text, audio_url, duration_seconds, status, created_at")
    .eq("donor_id", donorId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Could not load recording progress: ${error.message}`);

  const history = ((data ?? []) as RecordingRow[]).map(mapRecordingRow);
  return {
    totalRecordings: history.length,
    completedSentenceIds: Array.from(new Set(history.map((item) => item.sentenceId))),
    history,
  };
}

/**
 * Insert a new donor row and return the Supabase-generated donor UUID.
 */
export async function insertDonor(user: RegisteredUser, authUserId: string): Promise<string> {
  const sb = getSupabase();

  if (!authUserId) {
    throw new Error("Registration failed. Supabase Auth did not return a valid user id.");
  }

  const { data, error } = await sb
    .from("voice_donors")
    .insert({
      auth_user_id: authUserId,
      full_name: user.fullName,
      email: user.email,
      age: user.age,
      gender: user.gender,
      country: user.country,
      city: user.city,
      dialect: user.dialect,
      consent: user.consent,
      voice_profile_id: user.voiceProfileId,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Registration failed: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * Upload an audio blob to Supabase Storage, then insert a metadata row into
 * voice_recordings. Returns the public audio URL.
 */
export async function uploadAndSaveRecording(
  donorId: string,
  sentenceId: string,
  sentenceText: string,
  dialect: string,
  gender: string,
  metadata: RecordingMetadata,
  audioBlob: Blob,
): Promise<RecordingHistoryItem> {
  const sb = getSupabase();

  const contentType = audioBlob.type || "audio/webm";
  const extension = getAudioExtension(contentType);
  const path = `${donorId}/${sentenceId}-${Date.now()}.${extension}`;
  const durationSeconds = await getAudioDurationSeconds(audioBlob);

  const { data: uploadData, error: uploadError } = await sb.storage
    .from("voice-recordings")
    .upload(path, audioBlob, { contentType, upsert: false });

  if (uploadError) {
    throw new Error(`Audio upload failed: ${uploadError.message}`);
  }

  if (!uploadData?.path) {
    throw new Error("Audio upload failed: Supabase did not return a storage path.");
  }

  // Bucket is private — store the storage path, not a public URL.
  // Signed URLs are generated on demand by adminService.ts for playback.
  const storagePath = uploadData.path;

  const { data: recordingData, error: dbError } = await sb
    .from("voice_recordings")
    .insert({
      donor_id: donorId,
      sentence_id: sentenceId,
      sentence_text: sentenceText,
      audio_url: storagePath,
      audio_path: storagePath,
      duration_seconds: durationSeconds,
      dialect,
      gender,
      age_range: metadata.ageRange,
      country: metadata.country,
      city: metadata.city,
      device_type: metadata.deviceType,
      background_noise: metadata.backgroundNoise,
      speaking_speed: metadata.speakingSpeed,
      consent: metadata.consent,
      status: "pending",
    })
    .select("id, sentence_id, sentence_text, audio_url, duration_seconds, status, created_at")
    .single();

  if (dbError) {
    throw new Error(`Failed to save recording metadata: ${dbError.message}`);
  }

  return mapRecordingRow(recordingData as RecordingRow);
}

function getAudioExtension(contentType: string): string {
  if (contentType.includes("mp4")) return "m4a";
  if (contentType.includes("aac")) return "aac";
  if (contentType.includes("mpeg")) return "mp3";
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("wav")) return "wav";
  return "webm";
}

function getAudioDurationSeconds(audioBlob: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(audioBlob);

    const cleanup = () => {
      URL.revokeObjectURL(url);
      audio.removeAttribute("src");
      audio.load();
    };

    const finish = (duration: number | null) => {
      cleanup();
      resolve(duration);
    };

    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : null;
      finish(duration);
    };
    audio.onerror = () => finish(null);
    audio.src = url;
  });
}

// ── Public dataset statistics ─────────────────────────────────
// Calls the get_public_stats() Supabase RPC function which returns
// aggregated counts only. No personal data is ever exposed.

export type PublicStats = {
  total_recordings: number;
  approved_recordings: number;
  approved_duration_seconds: number;
  total_contributors: number;
  dialects_covered: number;
  countries_covered: number;
};

export async function fetchPublicStats(): Promise<PublicStats> {
  const { data, error } = await getSupabase().rpc("get_public_stats");

  if (error) throw new Error(`Could not load dataset stats: ${error.message}`);

  const raw = data as Record<string, unknown>;
  return {
    total_recordings:          Number(raw?.total_recordings          ?? 0),
    approved_recordings:       Number(raw?.approved_recordings       ?? 0),
    approved_duration_seconds: Number(raw?.approved_duration_seconds ?? 0),
    total_contributors:        Number(raw?.total_contributors        ?? 0),
    dialects_covered:          Number(raw?.dialects_covered          ?? 0),
    countries_covered:         Number(raw?.countries_covered         ?? 0),
  };
}
