import { getSupabase } from "./supabase";
import type {
  AgeRange,
  PromptPack,
  RecordingHistoryItem,
  RecordingMetadata,
  RegisteredUser,
  VoicePrompt,
} from "../types";

type DonorRow = {
  id: string;
  auth_user_id?: string | null;
  full_name: string;
  email: string;
  age: number | null;
  age_range: AgeRange | null;
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

type PromptPackRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  language: string;
  dialect: string | null;
  unlock_order: number;
  required_previous_pack_id: string | null;
  is_active: boolean;
  completed_at?: string | null;
  prompts?: { count: number }[] | null;
};

type PromptRow = {
  id: string;
  pack_id: string;
  text: string;
  category: string | null;
  difficulty: string | null;
  order_number: number;
  prompt_packs?: {
    title: string;
    unlock_order: number;
  } | null;
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
    authUserId: row.auth_user_id ?? "",
    fullName: row.full_name,
    email: row.email,
    ageRange: row.age_range ?? legacyAgeToRange(row.age),
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
  "id, auth_user_id, full_name, email, age, age_range, gender, country, city, dialect, consent, voice_profile_id";

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
            authUserId: authenticatedUser.id,
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
        authUserId,
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

export type PromptWorkspace = {
  packs: PromptPack[];
  prompts: VoicePrompt[];
  progressMessage: string;
};

const mapPromptPackRow = (row: PromptPackRow): PromptPack => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  description: row.description,
  language: row.language,
  dialect: row.dialect ?? "Maxaa Tiri",
  unlockOrder: row.unlock_order,
  requiredPreviousPackId: row.required_previous_pack_id,
  isActive: row.is_active,
  completedAt: row.completed_at ?? null,
  promptCount: row.prompts?.[0]?.count ?? 0,
  completedPromptCount: 0,
});

const mapPromptRow = (row: PromptRow): VoicePrompt => ({
  sentenceId: row.id,
  sentenceText: row.text,
  packId: row.pack_id,
  packTitle: row.prompt_packs?.title ?? "Somali prompts",
  orderNumber: row.order_number,
  category: row.category,
  difficulty: row.difficulty,
});

export async function fetchPromptWorkspace(
  authUserId: string,
  donorId: string,
  userDialect: string,
): Promise<PromptWorkspace> {
  const sb = getSupabase();
  await ensureInitialPromptPackUnlocked(authUserId, userDialect);

  const { data: progressRows, error: progressError } = await sb
    .from("user_prompt_progress")
    .select(`
      completed_at,
      prompt_packs (
        id,
        slug,
        title,
        description,
        language,
        dialect,
        unlock_order,
        required_previous_pack_id,
        is_active,
        prompts ( count )
      )
    `)
    .eq("user_id", authUserId)
    .order("created_at", { ascending: true });

  if (progressError) throw new Error(`Could not load prompt packs: ${progressError.message}`);

  const packs = (progressRows ?? [])
    .map((row) => {
      const pack = Array.isArray(row.prompt_packs) ? row.prompt_packs[0] : row.prompt_packs;
      return pack ? mapPromptPackRow({ ...pack, completed_at: row.completed_at } as PromptPackRow) : null;
    })
    .filter((pack): pack is PromptPack => Boolean(pack?.isActive && pack.dialect === userDialect))
    .sort((a, b) => a.unlockOrder - b.unlockOrder);

  if (packs.length === 0) return { packs: [], prompts: [], progressMessage: "" };

  const packIds = packs.map((pack) => pack.id);
  const { data: promptRows, error: promptError } = await sb
    .from("prompts")
    .select("id, pack_id, text, category, difficulty, order_number, prompt_packs ( title, unlock_order )")
    .in("pack_id", packIds)
    .eq("is_active", true)
    .order("order_number", { ascending: true });

  if (promptError) throw new Error(`Could not load prompts: ${promptError.message}`);

  const promptList = ((promptRows ?? []) as unknown as PromptRow[]).map(mapPromptRow);
  const promptsByPack = new Map<string, VoicePrompt[]>();
  const packIdByPromptId = new Map<string, string>();
  for (const prompt of promptList) {
    promptsByPack.set(prompt.packId, [...(promptsByPack.get(prompt.packId) ?? []), prompt]);
    packIdByPromptId.set(prompt.sentenceId, prompt.packId);
  }

  const completedPromptIdsByPack = await fetchCompletedPromptIdsByPack(
    donorId,
    Array.from(packIdByPromptId.keys()),
    packIdByPromptId,
  );

  const packsWithCompletion = packs.map((pack) => {
    const packPrompts = promptsByPack.get(pack.id) ?? [];
    const completedPromptCount = completedPromptIdsByPack.get(pack.id)?.size ?? 0;
    return {
      ...pack,
      promptCount: packPrompts.length,
      completedPromptCount: Math.min(completedPromptCount, packPrompts.length),
    };
  });

  const currentPack =
    packsWithCompletion.find((pack) => pack.promptCount === 0 || pack.completedPromptCount < pack.promptCount) ??
    packsWithCompletion[packsWithCompletion.length - 1];
  const currentPackPrompts = currentPack ? promptsByPack.get(currentPack.id) ?? [] : [];
  const currentCompletedSet = completedPromptIdsByPack.get(currentPack?.id ?? "") ?? new Set<string>();
  const currentPackComplete =
    currentPackPrompts.length > 0 &&
    currentPackPrompts.every((prompt) => currentCompletedSet.has(prompt.sentenceId));

  if (currentPack && currentPackComplete && !currentPack.completedAt) {
    const unlock = await completePromptPackIfReady(authUserId, donorId, currentPack.id, userDialect);
    if (unlock?.unlocked) {
      const workspace = await fetchPromptWorkspace(authUserId, donorId, userDialect);
      return { ...workspace, progressMessage: "New prompts unlocked" };
    }
    if (unlock?.allCompleted) {
      const workspace = await fetchPromptWorkspace(authUserId, donorId, userDialect);
      return { ...workspace, progressMessage: "All prompt sets completed" };
    }
  }

  const activePrompts = currentPackComplete
    ? currentPackPrompts
    : currentPackPrompts.filter((prompt) => !currentCompletedSet.has(prompt.sentenceId));
  const allPromptSetsCompleted =
    packsWithCompletion.length > 0 &&
    packsWithCompletion.every((pack) => pack.promptCount > 0 && pack.completedPromptCount >= pack.promptCount);

  return {
    packs: packsWithCompletion,
    prompts: activePrompts,
    progressMessage: allPromptSetsCompleted ? "All prompt sets completed" : "",
  };
}

async function fetchCompletedPromptIdsByPack(
  donorId: string,
  promptIds: string[],
  packIdByPromptId: Map<string, string>,
): Promise<Map<string, Set<string>>> {
  const completedPromptIdsByPack = new Map<string, Set<string>>();
  if (promptIds.length === 0) return completedPromptIdsByPack;

  const { data, error } = await getSupabase()
    .from("voice_recordings")
    .select("sentence_id")
    .eq("donor_id", donorId)
    .in("sentence_id", promptIds);

  if (error) throw new Error(`Could not count completed prompt pack progress: ${error.message}`);

  for (const row of data ?? []) {
    const sentenceId = row.sentence_id as string;
    const packId = packIdByPromptId.get(sentenceId);
    if (!packId) continue;

    const completedSet = completedPromptIdsByPack.get(packId) ?? new Set<string>();
    completedSet.add(sentenceId);
    completedPromptIdsByPack.set(packId, completedSet);
  }

  return completedPromptIdsByPack;
}

async function ensureInitialPromptPackUnlocked(authUserId: string, userDialect: string): Promise<void> {
  if (!authUserId) return;

  const sb = getSupabase();
  const { data: existing, error: existingError } = await sb
    .from("user_prompt_progress")
    .select("id, prompt_packs ( dialect )")
    .eq("user_id", authUserId)
    .limit(25);

  if (existingError) throw new Error(`Could not load prompt progress: ${existingError.message}`);
  const hasDialectProgress = (existing ?? []).some((row) => {
    const pack = Array.isArray(row.prompt_packs) ? row.prompt_packs[0] : row.prompt_packs;
    return pack?.dialect === userDialect;
  });
  if (hasDialectProgress) return;

  const { data: firstPack, error: packError } = await sb
    .from("prompt_packs")
    .select("id")
    .eq("is_active", true)
    .eq("dialect", userDialect)
    .order("unlock_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (packError) throw new Error(`Could not load starter prompts: ${packError.message}`);
  if (!firstPack?.id) return;

  const { error: insertError } = await sb.from("user_prompt_progress").insert({
    user_id: authUserId,
    pack_id: firstPack.id,
  });

  if (insertError && insertError.code !== "23505") {
    throw new Error(`Could not unlock starter prompts: ${insertError.message}`);
  }
}

export type PromptUnlockResult = {
  unlocked: boolean;
  allCompleted: boolean;
  packTitle: string | null;
  completedPackTitle: string;
};

export async function completePromptPackIfReady(
  authUserId: string,
  donorId: string,
  packId: string,
  userDialect: string,
): Promise<PromptUnlockResult | null> {
  const sb = getSupabase();

  const { data: pack, error: packError } = await sb
    .from("prompt_packs")
    .select("id, title, unlock_order, dialect")
    .eq("id", packId)
    .eq("is_active", true)
    .eq("dialect", userDialect)
    .maybeSingle();

  if (packError) throw new Error(`Could not check prompt pack: ${packError.message}`);
  if (!pack) return null;

  const { data: packPrompts, error: promptsError } = await sb
    .from("prompts")
    .select("id")
    .eq("pack_id", packId)
    .eq("is_active", true);

  if (promptsError) throw new Error(`Could not check prompt completion: ${promptsError.message}`);

  const promptIds = (packPrompts ?? []).map((prompt) => prompt.id as string);
  if (promptIds.length === 0) return null;

  const { data: completedRows, error: recordingsError } = await sb
    .from("voice_recordings")
    .select("sentence_id")
    .eq("donor_id", donorId)
    .in("sentence_id", promptIds);

  if (recordingsError) throw new Error(`Could not check recordings: ${recordingsError.message}`);

  const completedIds = new Set((completedRows ?? []).map((row) => row.sentence_id as string));
  if (!promptIds.every((id) => completedIds.has(id))) return null;

  const completedAt = new Date().toISOString();
  const { error: updateError } = await sb
    .from("user_prompt_progress")
    .update({ completed_at: completedAt })
    .eq("user_id", authUserId)
    .eq("pack_id", packId)
    .is("completed_at", null);

  if (updateError) throw new Error(`Could not mark prompt pack complete: ${updateError.message}`);

  const { data: nextPack, error: nextError } = await sb
    .from("prompt_packs")
    .select("id, title")
    .eq("is_active", true)
    .eq("dialect", userDialect)
    .gt("unlock_order", pack.unlock_order)
    .order("unlock_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (nextError) throw new Error(`Could not check next prompt pack: ${nextError.message}`);
  if (!nextPack?.id) {
    return {
      unlocked: false,
      allCompleted: true,
      packTitle: null,
      completedPackTitle: pack.title as string,
    };
  }

  const { error: unlockError } = await sb.from("user_prompt_progress").insert({
    user_id: authUserId,
    pack_id: nextPack.id,
  });

  if (unlockError && unlockError.code !== "23505") {
    throw new Error(`Could not unlock new prompts: ${unlockError.message}`);
  }

  return {
    unlocked: true,
    allCompleted: false,
    packTitle: nextPack.title as string,
    completedPackTitle: pack.title as string,
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
      age_range: user.ageRange,
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

function legacyAgeToRange(age: number | null): AgeRange {
  if (age === null || Number.isNaN(age)) return "Prefer not to say";
  if (age < 18) return "Under 18";
  if (age <= 25) return "18–25";
  if (age <= 35) return "26–35";
  if (age <= 45) return "36–45";
  if (age <= 60) return "46–60";
  return "60+";
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
