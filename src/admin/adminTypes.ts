export type ReviewStatus = "pending" | "pending_review" | "approved" | "rejected";

export type AdminDonor = {
  id: string;
  full_name: string;
  email: string;
  age_range: string | null;
  gender: string;
  country: string;
  city: string;
  dialect: string;
  consent: boolean;
  voice_profile_id: string | null;
  status: string;
  created_at: string;
};

export type AdminRecording = {
  id: string;
  donor_id: string;
  sentence_id: string;
  sentence_text: string;
  audio_url: string;
  audio_error: string;
  signed_audio_url: string;
  audio_path: string;
  file_path?: string | null;
  duration_seconds: number | null;
  dialect: string | null;
  gender: string | null;
  age_range: string | null;
  country: string | null;
  city: string | null;
  device_type: string | null;
  background_noise: string | null;
  quality_score: number | null;
  speaking_speed: string | null;
  consent: boolean | null;
  status: ReviewStatus;
  approved: boolean | null;
  dataset_ready: boolean | null;
  review_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  donor: Pick<AdminDonor, "id" | "full_name" | "email" | "age_range" | "gender" | "dialect" | "country" | "city"> | null;
};

export type DonorSummary = AdminDonor & {
  recordingCount: number;
  totalDurationSeconds: number;
};

export type AdminDashboardData = {
  donors: AdminDonor[];
  recordings: AdminRecording[];
};

export type AdminPrompt = {
  id: string;
  pack_id: string;
  text: string;
  category: string | null;
  difficulty: string | null;
  order_number: number;
  is_active: boolean;
  created_at: string;
};

export type AdminPromptPack = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  language: string;
  dialect: string;
  unlock_order: number;
  required_previous_pack_id: string | null;
  is_active: boolean;
  created_at: string;
  prompts: AdminPrompt[];
};
