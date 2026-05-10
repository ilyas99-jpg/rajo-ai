import { getSupabase } from "../lib/supabase";
import type { AdminDashboardData, AdminDonor, AdminPromptPack, AdminRecording, ReviewStatus } from "./adminTypes";

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

export type PromptPackInput = {
  slug: string;
  title: string;
  description: string;
  language: string;
  unlockOrder: number;
  requiredPreviousPackId: string;
};

export type PromptInput = {
  packId: string;
  text: string;
  category: string;
  difficulty: string;
  orderNumber: number;
};

export async function fetchAdminPromptPacks(): Promise<AdminPromptPack[]> {
  const { data, error } = await getSupabase()
    .from("prompt_packs")
    .select(`
      id,
      slug,
      title,
      description,
      language,
      unlock_order,
      required_previous_pack_id,
      is_active,
      created_at,
      prompts (
        id,
        pack_id,
        text,
        category,
        difficulty,
        order_number,
        is_active,
        created_at
      )
    `)
    .order("unlock_order", { ascending: true })
    .order("order_number", { referencedTable: "prompts", ascending: true });

  if (error) throw new Error(`Could not load prompt packs: ${error.message}`);
  return (data ?? []) as unknown as AdminPromptPack[];
}

export async function createPromptPack(input: PromptPackInput): Promise<void> {
  const { error } = await getSupabase().from("prompt_packs").insert({
    slug: input.slug.trim(),
    title: input.title.trim(),
    description: input.description.trim(),
    language: input.language.trim() || "so",
    unlock_order: input.unlockOrder,
    required_previous_pack_id: input.requiredPreviousPackId || null,
  });

  if (error) throw new Error(`Could not create prompt pack: ${error.message}`);
}

export async function updatePromptPack(
  packId: string,
  changes: Partial<PromptPackInput> & { isActive?: boolean },
): Promise<void> {
  const payload: Record<string, string | number | boolean | null> = {};
  if (changes.slug !== undefined) payload.slug = changes.slug.trim();
  if (changes.title !== undefined) payload.title = changes.title.trim();
  if (changes.description !== undefined) payload.description = changes.description.trim();
  if (changes.language !== undefined) payload.language = changes.language.trim() || "so";
  if (changes.unlockOrder !== undefined) payload.unlock_order = changes.unlockOrder;
  if (changes.requiredPreviousPackId !== undefined) {
    payload.required_previous_pack_id = changes.requiredPreviousPackId || null;
  }
  if (changes.isActive !== undefined) payload.is_active = changes.isActive;

  const { error } = await getSupabase().from("prompt_packs").update(payload).eq("id", packId);
  if (error) throw new Error(`Could not update prompt pack: ${error.message}`);
}

export async function createPrompt(input: PromptInput): Promise<void> {
  const { error } = await getSupabase().from("prompts").insert({
    pack_id: input.packId,
    text: input.text.trim(),
    category: input.category.trim() || null,
    difficulty: input.difficulty.trim() || null,
    order_number: input.orderNumber,
  });

  if (error) throw new Error(`Could not add prompt: ${error.message}`);
}

export async function updatePrompt(
  promptId: string,
  changes: Partial<PromptInput> & { isActive?: boolean },
): Promise<void> {
  const payload: Record<string, string | number | boolean | null> = {};
  if (changes.packId !== undefined) payload.pack_id = changes.packId;
  if (changes.text !== undefined) payload.text = changes.text.trim();
  if (changes.category !== undefined) payload.category = changes.category.trim() || null;
  if (changes.difficulty !== undefined) payload.difficulty = changes.difficulty.trim() || null;
  if (changes.orderNumber !== undefined) payload.order_number = changes.orderNumber;
  if (changes.isActive !== undefined) payload.is_active = changes.isActive;

  const { error } = await getSupabase().from("prompts").update(payload).eq("id", promptId);
  if (error) throw new Error(`Could not update prompt: ${error.message}`);
}

export async function deletePrompt(promptId: string): Promise<void> {
  const { error } = await getSupabase().from("prompts").delete().eq("id", promptId);
  if (error) throw new Error(`Could not delete prompt: ${error.message}`);
}

export async function uploadPromptsCsv(packId: string, csvText: string): Promise<number> {
  const rows = parsePromptCsv(csvText);
  if (rows.length === 0) return 0;

  const { data: existing, error: existingError } = await getSupabase()
    .from("prompts")
    .select("order_number")
    .eq("pack_id", packId)
    .order("order_number", { ascending: false })
    .limit(1);

  if (existingError) throw new Error(`Could not inspect prompt pack: ${existingError.message}`);
  const start = Number(existing?.[0]?.order_number ?? 0);

  const { error } = await getSupabase().from("prompts").insert(
    rows.map((row, index) => ({
      pack_id: packId,
      text: row.text,
      category: row.category || null,
      difficulty: row.difficulty || null,
      order_number: row.orderNumber ?? start + index + 1,
    })),
  );

  if (error) throw new Error(`CSV upload failed: ${error.message}`);
  return rows.length;
}

function parsePromptCsv(csvText: string): Array<{
  text: string;
  category: string;
  difficulty: string;
  orderNumber: number | null;
}> {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const firstCells = splitCsvLine(lines[0]).map((cell) => cell.toLowerCase());
  const hasHeader = firstCells.includes("text") || firstCells.includes("prompt");
  const header = hasHeader ? firstCells : ["text", "category", "difficulty", "order_number"];
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const textIndex = Math.max(header.indexOf("text"), header.indexOf("prompt"));
  const categoryIndex = header.indexOf("category");
  const difficultyIndex = header.indexOf("difficulty");
  const orderIndex = header.indexOf("order_number");

  return dataLines
    .map((line, index) => {
      const cells = splitCsvLine(line);
      const text = cells[textIndex >= 0 ? textIndex : 0]?.trim() ?? "";
      if (!text) return null;
      const orderValue = orderIndex >= 0 ? Number(cells[orderIndex]) : NaN;
      return {
        text,
        category: categoryIndex >= 0 ? cells[categoryIndex]?.trim() ?? "" : "",
        difficulty: difficultyIndex >= 0 ? cells[difficultyIndex]?.trim() ?? "" : "",
        orderNumber: Number.isFinite(orderValue) ? orderValue : index + 1,
      };
    })
    .filter((row): row is { text: string; category: string; difficulty: string; orderNumber: number } => Boolean(row));
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}
