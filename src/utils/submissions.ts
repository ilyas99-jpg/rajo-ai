import type {
  RegisteredUser,
  RegistrationFormData,
  VoicePrompt,
  VoiceSubmission,
} from "../types";

export const createRegisteredUser = (
  formData: RegistrationFormData,
): RegisteredUser => {
  const userId = crypto.randomUUID();
  const dialect = formData.dialect.trim();

  if (!dialect) {
    throw new Error("Please select your Somali dialect before continuing.");
  }

  if (!formData.ageRange) {
    throw new Error("Please select your age range before continuing.");
  }

  return {
    userId,
    authUserId: "",
    fullName: formData.fullName.trim(),
    email: formData.email.trim().toLowerCase(),
    ageRange: formData.ageRange,
    gender: formData.gender,
    country: formData.country.trim(),
    city: formData.city.trim(),
    dialect,
    consent: formData.consent,
    voiceProfileId: `voice-profile-${userId}`,
  };
};

export const createVoiceSubmission = (
  user: RegisteredUser,
  prompt: VoicePrompt,
  audioBlob: Blob,
  audioUrl: string,
): VoiceSubmission => ({
  userId: user.userId,
  fullName: user.fullName,
  email: user.email,
  ageRange: user.ageRange,
  gender: user.gender,
  country: user.country,
  city: user.city,
  dialect: user.dialect,
  consent: user.consent,
  sentenceId: prompt.sentenceId,
  sentenceText: prompt.sentenceText,
  audioBlob,
  audioUrl,
  timestamp: new Date().toISOString(),
  voiceProfileId: user.voiceProfileId,
});
