export type ReviewStatus = "pending" | "pending_review" | "approved" | "rejected";

export type AdminDonor = {
  id: string;
  full_name: string;
  email: string;
  age: number;
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
  review_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  donor: Pick<AdminDonor, "id" | "full_name" | "email" | "gender" | "dialect" | "country" | "city"> | null;
};

export type DonorSummary = AdminDonor & {
  recordingCount: number;
  totalDurationSeconds: number;
};

export type AdminDashboardData = {
  donors: AdminDonor[];
  recordings: AdminRecording[];
};
