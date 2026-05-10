export type Gender = "Female" | "Male" | "Prefer not to say" | "Other";
export type AgeRange =
  | "Under 18"
  | "18–25"
  | "26–35"
  | "36–45"
  | "46–60"
  | "60+"
  | "Prefer not to say";

export type RegistrationFormData = {
  fullName: string;
  email: string;
  password: string;
  ageRange: AgeRange | "";
  gender: Gender | "";
  country: string;
  city: string;
  dialect: string;
  dialectOther: string;
  consent: boolean;
};

export type RegisteredUser = {
  userId: string;
  fullName: string;
  email: string;
  ageRange: AgeRange;
  gender: Gender | "";
  country: string;
  city: string;
  dialect: string;
  consent: boolean;
  voiceProfileId: string;
};

export type VoicePrompt = {
  sentenceId: string;
  sentenceText: string;
};

export type RecordingMetadata = {
  ageRange: string;
  country: string;
  city: string;
  deviceType: string;
  backgroundNoise: string;
  speakingSpeed: string;
  consent: boolean;
};

export type RecordingHistoryItem = {
  id: string;
  sentenceId: string;
  sentenceText: string;
  audioUrl: string;
  durationSeconds: number | null;
  status: string;
  createdAt: string;
};

export type VoiceSubmission = {
  userId: string;
  fullName: string;
  email: string;
  ageRange: AgeRange;
  gender: Gender | "";
  country: string;
  city: string;
  dialect: string;
  consent: boolean;
  sentenceId: string;
  sentenceText: string;
  audioBlob: Blob;
  audioUrl: string;
  timestamp: string;
  voiceProfileId: string;
};
