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
  const dialect =
    formData.dialect === "Other" ? formData.dialectOther.trim() : formData.dialect.trim();

  if (!dialect) {
    throw new Error("Please select your Somali dialect before continuing.");
  }

  return {
    userId,
    fullName: formData.fullName.trim(),
    email: formData.email.trim().toLowerCase(),
    age: Number(formData.age),
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
  age: user.age,
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
