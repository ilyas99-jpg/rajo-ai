import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Award, BarChart2, Bell, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock, Flame, Globe, Lock, LogOut, Mic, RotateCcw, Shield, Star, Trophy, Upload, User, XCircle } from "lucide-react";
import { Navbar } from "./components/Navbar";
import { BottomNav } from "./components/BottomNav";
import { PWAInstallPrompt } from "./components/PWAInstallPrompt";
import { AdminDashboard } from "./admin/AdminDashboard";
import { BrandWaveform } from "./components/Brand";
import {
  completePromptPackIfReady,
  fetchDonorProgress,
  fetchPromptWorkspace,
  fetchPublicStats,
  getCurrentSessionProfile,
  loginWithPassword,
  logoutUser,
  registerAndCreateProfile,
  updateUserProfile,
  updateUserLanguagePreference,
  uploadAndSaveRecording,
  uploadAvatarPhoto,
} from "./lib/supabaseService";
import { useLanguage } from "./i18n";
import type { ProfileUpdates, PublicStats } from "./lib/supabaseService";
import type { AgeRange, PromptPack, RecordingHistoryItem, RecordingMetadata, RegisteredUser, RegistrationFormData, VoicePrompt } from "./types";
import { createRegisteredUser } from "./utils/submissions";
import {
  deletePendingRecording,
  getPendingCount,
  getPendingRecordings,
  incrementRetryCount,
  markFailedPermanently,
  saveOfflineRecording,
} from "./lib/offlineQueue";

type View = "home" | "about" | "auth" | "dashboard" | "record" | "profile" | "contributions" | "settings";
type AuthMode = "register" | "login";
type RecorderState = "idle" | "starting" | "recording" | "recorded";

const MAX_OFFLINE_RETRIES = 5;

const DIALECT_OPTIONS = [
  "Maxaa Tiri",
  "May May",
];

const AGE_RANGE_OPTIONS: AgeRange[] = [
  "Under 18",
  "18–25",
  "26–35",
  "36–45",
  "46–60",
  "60+",
  "Prefer not to say",
];

const PRIORITY_COUNTRIES = ["Somalia", "Kenya", "Ethiopia", "Djibouti", "Uganda", "USA", "UK", "Canada"];
const OTHER_COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "Angola", "Argentina", "Armenia", "Australia", "Austria",
  "Azerbaijan", "Bahrain", "Bangladesh", "Belarus", "Belgium", "Benin", "Bolivia", "Brazil",
  "Burkina Faso", "Burundi", "Cambodia", "Cameroon", "Chad", "Chile", "China", "Colombia",
  "Comoros", "Congo", "Costa Rica", "Côte d'Ivoire", "Croatia", "Cuba", "Cyprus",
  "Czech Republic", "Denmark", "Dominican Republic", "DR Congo", "Ecuador", "Egypt",
  "El Salvador", "Eritrea", "Estonia", "Finland", "France", "Gambia", "Georgia", "Germany",
  "Ghana", "Greece", "Guatemala", "Guinea", "Guinea-Bissau", "Haiti", "Honduras", "Hungary",
  "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy", "Jamaica", "Japan",
  "Jordan", "Kazakhstan", "Kosovo", "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon",
  "Lesotho", "Liberia", "Libya", "Lithuania", "Luxembourg", "Madagascar", "Malawi", "Malaysia",
  "Maldives", "Mali", "Mauritania", "Mexico", "Moldova", "Mongolia", "Morocco", "Mozambique",
  "Myanmar", "Namibia", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria",
  "North Korea", "Norway", "Oman", "Pakistan", "Palestine", "Panama", "Paraguay", "Peru",
  "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia", "Rwanda", "Saudi Arabia",
  "Senegal", "Serbia", "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "South Africa",
  "South Korea", "South Sudan", "Spain", "Sri Lanka", "Sudan", "Sweden", "Switzerland",
  "Syria", "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Togo", "Tunisia", "Turkey",
  "Turkmenistan", "Ukraine", "United Arab Emirates", "Uruguay", "Uzbekistan", "Venezuela",
  "Vietnam", "Yemen", "Zambia", "Zimbabwe",
];

const initialFormData: RegistrationFormData = {
  fullName: "",
  email: "",
  password: "",
  ageRange: "",
  gender: "Prefer not to say",
  country: "",
  city: "",
  dialect: "",
  dialectOther: "",
  consent: true,
};

function App() {
  if (window.location.pathname === "/admin") return <AdminDashboard />;
  return <VoiceCollectionApp />;
}

function VoiceCollectionApp() {
  const { language, t } = useLanguage();
  const [view, setView] = useState<View>(() => getInitialView());
  const [authMode, setAuthMode] = useState<AuthMode>("register");
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<RegisteredUser | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [donorId, setDonorId] = useState<string | null>(null);
  const [history, setHistory] = useState<RecordingHistoryItem[]>([]);
  const [completedPromptIds, setCompletedPromptIds] = useState<string[]>([]);
  const [promptPacks, setPromptPacks] = useState<PromptPack[]>([]);
  const [prompts, setPrompts] = useState<VoicePrompt[]>([]);
  const [promptLoading, setPromptLoading] = useState(false);
  const [unlockNotice, setUnlockNotice] = useState("");
  const [promptProgressMessage, setPromptProgressMessage] = useState("");
  const [formData, setFormData] = useState(initialFormData);
  const postAuthRef = useRef<View>("dashboard");
  const isSyncingRef = useRef(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0);

  const stats = useMemo(() => {
    const totalSeconds = history.reduce((sum, item) => sum + (item.durationSeconds ?? 0), 0);
    const approved = history.filter((item) => item.status === "approved").length;
    const pending = history.filter((item) => item.status === "pending" || item.status === "pending_review").length;

    return {
      total: history.length,
      minutes: totalSeconds / 60,
      approved,
      pending,
    };
  }, [history]);

  useEffect(() => {
    let mounted = true;
    const startingPath = window.location.pathname;

    async function restoreSession() {
      try {
        const profile = await getCurrentSessionProfile();
        if (!mounted) return;

        if (profile) {
          setUser(profile.user);
          setAvatarUrl(profile.user.avatarUrl);
          setDonorId(profile.donorId);
          setLoginEmail(profile.user.email);
          await loadProgress(profile.donorId, profile.user.authUserId, profile.user.dialect);
          // Pass credentials directly — React state hasn't flushed yet at this point.
          if (navigator.onLine) {
            void syncOfflineRecordings({ donorId: profile.donorId, user: profile.user });
          }
          if (startingPath === "/record") setView("record");
          else if (startingPath === "/profile") setView("profile");
          else if (startingPath === "/contributions") setView("contributions");
          else if (startingPath === "/settings") setView("settings");
          else if (startingPath !== "/about") setView("dashboard");
        }
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Could not restore your session.");
      } finally {
        if (mounted) setAuthLoading(false);
      }
    }

    void restoreSession();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const onPopState = () => setView(getInitialView());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!user || !donorId) return;
    updateUserLanguagePreference(donorId, language).catch(() => {});
  }, [donorId, language, user]);

  // Load initial offline pending count from IndexedDB
  useEffect(() => {
    getPendingCount().then(setPendingOfflineCount).catch(() => {});
  }, []);

  const syncOfflineRecordings = useCallback(async (
    credentials?: { donorId: string; user: RegisteredUser },
  ) => {
    const effectiveDonorId = credentials?.donorId ?? donorId;
    const effectiveUser = credentials?.user ?? user;
    if (!effectiveUser || !effectiveDonorId) return;
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;

    let pending;
    try {
      pending = await getPendingRecordings();
    } catch {
      isSyncingRef.current = false;
      return;
    }

    if (pending.length === 0) {
      isSyncingRef.current = false;
      return;
    }

    console.log(`[RajoOffline] Sync started — ${pending.length} pending recording(s)`);

    for (const item of pending) {
      try {
        const recording = await uploadAndSaveRecording(
          item.donorId,
          item.promptId,
          item.promptText,
          item.dialect,
          item.gender,
          {
            ageRange: item.ageRange,
            country: item.country,
            city: item.city,
            deviceType: item.deviceType,
            backgroundNoise: item.backgroundNoise,
            speakingSpeed: item.speakingSpeed,
            consent: true,
          },
          item.audioBlob,
        );
        await deletePendingRecording(item.id);
        setPendingOfflineCount((c) => Math.max(0, c - 1));
        setHistory((items) => [recording, ...items]);
        setCompletedPromptIds((ids) =>
          ids.includes(item.promptId) ? ids : [...ids, item.promptId],
        );
        console.log(`[RajoOffline] Sync success — promptId: ${item.promptId}`);
      } catch (err) {
        const newCount = await incrementRetryCount(item.id).catch(() => item.retryCount + 1);
        console.warn(
          `[RajoOffline] Sync failed (attempt ${newCount}/${MAX_OFFLINE_RETRIES}) — promptId: ${item.promptId}`,
          err,
        );
        if (newCount >= MAX_OFFLINE_RETRIES) {
          await markFailedPermanently(item.id).catch(() => {});
          setPendingOfflineCount((c) => Math.max(0, c - 1));
          console.error(
            `[RajoOffline] Permanently failed after ${MAX_OFFLINE_RETRIES} attempts — promptId: ${item.promptId}`,
          );
        }
      }
    }

    isSyncingRef.current = false;
  }, [donorId, user]);

  // Auto-sync when network comes back
  useEffect(() => {
    const onOnline = () => void syncOfflineRecordings();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [syncOfflineRecordings]);

  // Auto-sync when app returns to foreground (critical for iOS PWA background suspend)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        void syncOfflineRecordings();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [syncOfflineRecordings]);

  // 30-second heartbeat: retry while online and pending items exist
  useEffect(() => {
    const id = setInterval(() => {
      if (navigator.onLine) void syncOfflineRecordings();
    }, 30_000);
    return () => clearInterval(id);
  }, [syncOfflineRecordings]);

  function navigate(nextView: View, path: string) {
    window.history.pushState({}, "", path);
    setView(nextView);
  }

  async function loadProgress(id: string, authUserId?: string, dialect?: string) {
    setPromptLoading(true);
    try {
      const progress = await fetchDonorProgress(id);
      setHistory(progress.history);
      setCompletedPromptIds(progress.completedSentenceIds);

      const promptAuthId = authUserId ?? user?.authUserId;
      const promptDialect = dialect ?? user?.dialect;
      if (promptAuthId && promptDialect) {
        const workspace = await fetchPromptWorkspace(promptAuthId, id, promptDialect);
        setPromptPacks(workspace.packs);
        setPrompts(workspace.prompts);
        setPromptProgressMessage(workspace.progressMessage);
      }
    } finally {
      setPromptLoading(false);
    }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      const created = createRegisteredUser(formData);
      const profile = await registerAndCreateProfile(created, formData.password);
      setUser(profile.user);
      setAvatarUrl(profile.user.avatarUrl);
      setDonorId(profile.donorId);
      setFormData(initialFormData);
      setLoginEmail(profile.user.email);
      setLoginPassword("");
      await loadProgress(profile.donorId, profile.user.authUserId, profile.user.dialect);
      const dest = postAuthRef.current;
      postAuthRef.current = "dashboard";
      navigate(dest, dest === "record" ? "/record" : "/");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Registration failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      const profile = await loginWithPassword(loginEmail, loginPassword);
      setUser(profile.user);
      setAvatarUrl(profile.user.avatarUrl);
      setDonorId(profile.donorId);
      setLoginPassword("");
      await loadProgress(profile.donorId, profile.user.authUserId, profile.user.dialect);
      const dest = postAuthRef.current;
      postAuthRef.current = "dashboard";
      navigate(dest, dest === "record" ? "/record" : "/");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    await logoutUser();
    setUser(null);
    setAvatarUrl(undefined);
    setDonorId(null);
    setHistory([]);
    setCompletedPromptIds([]);
    setPromptPacks([]);
    setPrompts([]);
    setUnlockNotice("");
    setPromptProgressMessage("");
    navigate("home", "/");
  }

  async function handleProfileSave(updates: ProfileUpdates, avatarFile?: File) {
    if (!user || !donorId) return;
    await updateUserProfile(donorId, updates);
    if (avatarFile) {
      const url = await uploadAvatarPhoto(user.authUserId, donorId, avatarFile);
      setAvatarUrl(url);
      setUser((prev) => prev ? { ...prev, avatarUrl: url } : prev);
    }
    if (updates.fullName || updates.country || updates.dialect) {
      setUser((prev) =>
        prev
          ? {
              ...prev,
              fullName: updates.fullName ?? prev.fullName,
              country:  updates.country  ?? prev.country,
              dialect:  updates.dialect  ?? prev.dialect,
            }
          : prev,
      );
    }
  }

  async function handleSubmitRecording(prompt: VoicePrompt, blob: Blob, metadata: RecordingMetadata): Promise<{ offlineSaved: boolean }> {
    if (!user || !donorId) throw new Error("Please sign in before submitting a recording.");

    if (!navigator.onLine) {
      await saveOfflineRecording({
        audioBlob: blob,
        promptId: prompt.sentenceId,
        promptText: prompt.sentenceText,
        packId: prompt.packId,
        donorId,
        authUserId: user.authUserId,
        dialect: user.dialect,
        gender: user.gender,
        ageRange: metadata.ageRange,
        country: metadata.country,
        city: metadata.city,
        deviceType: metadata.deviceType,
        backgroundNoise: metadata.backgroundNoise,
        speakingSpeed: metadata.speakingSpeed,
        createdAt: new Date().toISOString(),
      });
      setPendingOfflineCount((c) => c + 1);
      console.log(`[RajoOffline] Saved offline — promptId: ${prompt.sentenceId}`);
      return { offlineSaved: true };
    }

    const recording = await uploadAndSaveRecording(
      donorId,
      prompt.sentenceId,
      prompt.sentenceText,
      user.dialect,
      user.gender,
      metadata,
      blob,
    );

    setHistory((items) => [recording, ...items]);
    const nextCompleted = completedPromptIds.includes(prompt.sentenceId)
      ? completedPromptIds
      : [...completedPromptIds, prompt.sentenceId];
    setCompletedPromptIds(nextCompleted);

    const unlock = await completePromptPackIfReady(user.authUserId, donorId, prompt.packId, user.dialect);
    if (unlock?.unlocked) {
      setPromptProgressMessage("New prompts unlocked");
      setUnlockNotice(
        `New prompts unlocked|You completed your first contribution set. ${unlock.packTitle} is now available.`,
      );
    } else if (unlock?.allCompleted) {
      setPromptProgressMessage("All prompt sets completed");
      setUnlockNotice("All prompt sets completed|You completed every active prompt set. Thank you for building the Somali voice dataset.");
    }

    const workspace = await fetchPromptWorkspace(user.authUserId, donorId, user.dialect);
    setPromptPacks(workspace.packs);
    setPrompts(workspace.prompts);
    setPromptProgressMessage(workspace.progressMessage);

    return { offlineSaved: false };
  }

  function startFromHome(mode: AuthMode, afterAuth: View = "dashboard") {
    if (user) {
      navigate("record", "/record");
      return;
    }

    postAuthRef.current = afterAuth;
    setAuthMode(mode);
    navigate("auth", "/signin");
  }

  const appViewActive = (["dashboard", "record", "profile", "contributions", "settings"] as View[]).includes(view);

  return (
    <div key={language} className="min-h-screen bg-white text-slate-950">
      <Navbar
        activeView={view}
        user={user}
        avatarUrl={avatarUrl}
        onHome={() => navigate("home", "/")}
        onAbout={() => {
          navigate("about", "/about");
          window.scrollTo({ top: 0 });
        }}
        onHowItWorks={() => {
          navigate("home", "/");
          requestAnimationFrame(() => {
            document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" });
          });
        }}
        onDataset={() => {
          navigate("home", "/");
          requestAnimationFrame(() => {
            document.getElementById("dataset")?.scrollIntoView({ behavior: "smooth" });
          });
        }}
        onFaq={() => {
          navigate("home", "/");
          requestAnimationFrame(() => {
            document.getElementById("faq")?.scrollIntoView({ behavior: "smooth" });
          });
        }}
        onSignIn={() => startFromHome("login")}
        onSignOut={handleLogout}
        onProfile={() => user ? navigate("profile", "/profile") : startFromHome("login")}
        onContributions={() => user ? navigate("contributions", "/contributions") : startFromHome("login")}
        onSettings={() => user ? navigate("settings", "/settings") : startFromHome("login")}
      />

      <PWAInstallPrompt />

      <main className={user && appViewActive ? "pb-[calc(68px+env(safe-area-inset-bottom))] md:pb-0" : ""}>
        {authLoading ? (
          <LoadingScreen />
        ) : view === "home" ? (
          <HomePage onAbout={() => navigate("about", "/about")} onStart={() => startFromHome("register", "record")} />
        ) : view === "about" ? (
          <AboutPage onStart={() => startFromHome("register", "record")} />
        ) : view === "auth" ? (
          <AuthPage
            authMode={authMode}
            busy={busy}
            formData={formData}
            loginEmail={loginEmail}
            loginPassword={loginPassword}
            message={message}
            onBack={() => navigate("home", "/")}
            onFormChange={setFormData}
            onLogin={handleLogin}
            onLoginEmailChange={setLoginEmail}
            onLoginPasswordChange={setLoginPassword}
            onRegister={handleRegister}
            onSwitchMode={setAuthMode}
          />
        ) : view === "dashboard" && user ? (
          <Dashboard
            completedPromptIds={completedPromptIds}
            history={history}
            promptLoading={promptLoading}
            promptPacks={promptPacks}
            promptProgressMessage={promptProgressMessage}
            prompts={prompts}
            stats={stats}
            user={user}
            onRecord={() => navigate("record", "/record")}
          />
        ) : view === "record" && user ? (
          <RecordingPage
            completedPromptIds={completedPromptIds}
            history={history}
            unlockNotice={unlockNotice}
            onDismissUnlock={() => setUnlockNotice("")}
            pendingOfflineCount={pendingOfflineCount}
            prompts={prompts}
            user={user}
            onBack={() => navigate("dashboard", "/")}
            onSubmitRecording={handleSubmitRecording}
          />
        ) : view === "profile" && user ? (
          <ProfilePage
            user={user}
            donorId={donorId!}
            onSave={handleProfileSave}
            onBack={() => navigate("home", "/")}
          />
        ) : view === "contributions" && user ? (
          <ContributionsPage
            history={history}
            promptPacks={promptPacks}
            stats={stats}
            user={user}
            onRecord={() => navigate("record", "/record")}
            onBack={() => navigate("home", "/")}
          />
        ) : view === "settings" && user ? (
          <SettingsPage
            user={user}
            onSignOut={handleLogout}
            onBack={() => navigate("home", "/")}
            onProfile={() => navigate("profile", "/profile")}
          />
        ) : (
          <HomePage onAbout={() => navigate("about", "/about")} onStart={() => startFromHome("register", "record")} />
        )}
      </main>

      <BottomNav
        activeView={view}
        user={user}
        onDashboard={() => navigate("dashboard", "/")}
        onRecord={() => navigate("record", "/record")}
        onContributions={() => navigate("contributions", "/contributions")}
        onSettings={() => navigate("settings", "/settings")}
      />
    </div>
  );
}


function AboutPage({ onStart }: { onStart: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="bg-white">

      {/* SECTION 1: HERO */}
      <section className="border-b border-slate-100 bg-white px-5 py-20 sm:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[11px] font-black uppercase tracking-widest text-[#467ED3]">{t("about.eyebrow")}</p>
          <h1 className="mt-5 text-4xl font-black leading-tight text-slate-950 sm:text-6xl">
            {t("about.title")}
          </h1>
          <p className="mt-6 text-lg leading-8 text-slate-500">
            {t("about.subtitle")}
          </p>
        </div>
      </section>

      {/* SECTION 2: SOMALI EXPLANATION */}
      <section className="bg-[#F7FAFF] px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-2xl space-y-7">
          <p className="text-[11px] font-black uppercase tracking-widest text-[#467ED3]">Af-Soomaali</p>
          <p className="text-lg leading-9 text-slate-700">
            Rajo AI waa mashruuc lagu uruurinayo codadka Af-Soomaaliga si loo dhiso AI iyo technology si fiican u fahmi kara uguna hadli kara Af-Soomaaliga si dabiici ah.
          </p>
          <p className="text-lg leading-9 text-slate-700">
            Maanta dunidu waxay si degdeg ah ugu wareegaysaa AI iyo cod-fahanka, laakiin Af-Soomaaligu wali xog badan kuma laha teknoolojiyadan. Haddii aynaan maanta dhisin xogtayada codka, waxaa dhici karta in luuqaddeenna laga tago mustaqbalka technology-ga.
          </p>
          <p className="text-lg leading-9 text-slate-700">
            Mashruucan wuxuu qof kasta siinayaa fursad uu codkiisa ugu deeqo si loo abuuro AI si fiican ugu hadli kara Af-Soomaaliga, una fahmi kara lahjadaha, dhawaaqa, iyo hadalka Soomaalida.
          </p>
          <p className="text-lg font-semibold leading-9 text-slate-800">
            Cod kasta oo la duubo wuxuu qayb ka yahay ilaalinta iyo hormarinta luuqaddeenna dhinaca technology-ga iyo AI-ga mustaqbalka.
          </p>
        </div>
      </section>

      {/* SECTION 3: OUR MISSION */}
      <section className="bg-white px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-2xl">
          <p className="text-[11px] font-black uppercase tracking-widest text-[#467ED3]">{t("about.mission.label")}</p>
          <h2 className="mt-4 text-3xl font-black text-slate-950 sm:text-4xl">
            {t("about.mission.title")}
          </h2>
          <p className="mt-6 text-lg leading-9 text-slate-600">
            {t("about.mission.text")}
          </p>
        </div>
      </section>

      {/* SECTION 4: WHY IT MATTERS */}
      <section className="bg-[#F7FAFF] px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <p className="text-[11px] font-black uppercase tracking-widest text-[#467ED3]">{t("about.why.label")}</p>
          <h2 className="mt-4 text-3xl font-black text-slate-950 sm:text-4xl">{t("about.why.title")}</h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-3">
            <article className="rounded-2xl border border-slate-100 bg-white p-7">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#467ED3]/10">
                <svg aria-hidden="true" className="h-5 w-5 text-[#467ED3]" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a9 9 0 0 1 18 0M3 9v5a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2V9m10 0v5a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2V9" />
                </svg>
              </div>
              <h3 className="mt-5 font-black text-slate-950">{t("about.why.card1.title")}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">{t("about.why.card1.text")}</p>
            </article>
            <article className="rounded-2xl border border-slate-100 bg-white p-7">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#467ED3]/10">
                <svg aria-hidden="true" className="h-5 w-5 text-[#467ED3]" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.5a4 4 0 0 0 4-4v-7a4 4 0 1 0-8 0v7a4 4 0 0 0 4 4Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 11.5v3a7 7 0 0 0 14 0v-3M12 21v-2.5" />
                </svg>
              </div>
              <h3 className="mt-5 font-black text-slate-950">{t("about.why.card2.title")}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">{t("about.why.card2.text")}</p>
            </article>
            <article className="rounded-2xl border border-slate-100 bg-white p-7">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#467ED3]/10">
                <svg aria-hidden="true" className="h-5 w-5 text-[#467ED3]" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
                </svg>
              </div>
              <h3 className="mt-5 font-black text-slate-950">{t("about.why.card3.title")}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">{t("about.why.card3.text")}</p>
            </article>
          </div>
        </div>
      </section>

      {/* SECTION 5: PRIVACY & ETHICS */}
      <section className="bg-white px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <p className="text-[11px] font-black uppercase tracking-widest text-[#467ED3]">{t("about.privacy.label")}</p>
          <h2 className="mt-4 text-3xl font-black text-slate-950 sm:text-4xl">{t("about.privacy.title")}</h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-3">
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-[#F7FAFF] p-7">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#467ED3]/10">
                <svg aria-hidden="true" className="h-5 w-5 text-[#467ED3]" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                </svg>
              </div>
              <div>
                <h3 className="font-black text-slate-950">{t("about.privacy.card1.title")}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">{t("about.privacy.card1.text")}</p>
              </div>
            </div>
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-[#F7FAFF] p-7">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#467ED3]/10">
                <svg aria-hidden="true" className="h-5 w-5 text-[#467ED3]" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
              </div>
              <div>
                <h3 className="font-black text-slate-950">{t("about.privacy.card2.title")}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">{t("about.privacy.card2.text")}</p>
              </div>
            </div>
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-[#F7FAFF] p-7">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#467ED3]/10">
                <svg aria-hidden="true" className="h-5 w-5 text-[#467ED3]" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                </svg>
              </div>
              <div>
                <h3 className="font-black text-slate-950">{t("about.privacy.card3.title")}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">{t("about.privacy.card3.text")}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />

    </div>
  );
}

function AboutSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="px-5 py-12 sm:py-16">
      <div className="mx-auto max-w-6xl">
        <h2 className="mb-6 text-3xl font-black text-slate-950 sm:text-4xl">{title}</h2>
        {children}
      </div>
    </section>
  );
}

function HomePage({ onAbout, onStart }: { onAbout: () => void; onStart: () => void }) {
  return (
    <div className="overflow-hidden bg-white">
      <HeroSection onAbout={onAbout} onStart={onStart} />
      <DatasetStatsSection />
      <HowItWorksSection />
      <TrustSection />
      <FaqSection />
      <SiteFooter />
    </div>
  );
}

function HeroSection({ onAbout, onStart }: { onAbout: () => void; onStart: () => void }) {
  const { t } = useLanguage();
  return (
    <section className="bg-white px-5 py-16 sm:py-20 lg:py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2 lg:gap-16">

        {/* Left — text */}
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#467ED3]">
            {t("home.hero.eyebrow")}
          </p>
          <h1 className="mt-5 text-[2.4rem] font-black leading-[1.06] tracking-tight text-slate-950 sm:text-5xl">
            {t("home.hero.title")}
          </h1>
          <p className="mt-5 max-w-md text-lg leading-8 text-slate-500">
            {t("home.hero.body")}
          </p>
           <p  className="mt-10  text-sm italic text-slate-400">{t("home.hero.note")}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button className="btn-primary px-7 py-3 text-base" onClick={onStart}>
              Start Recording
            </button>
            <button className="btn-secondary px-7 py-3 text-base" onClick={onAbout}>
              Learn More
            </button>
          </div>
          <p className="mt-7 text-sm text-slate-400">
            3 minutes · consent-based · private by design
          </p>
        </div>

        {/* Right — editorial image */}
        <figure className="m-0">
          <div className="overflow-hidden rounded-[2rem] shadow-[0_8px_48px_-8px_rgba(0,0,0,0.18)]">
            <img
              alt="Aerial view of a Somali coastal town — colourful buildings, white sand beach, and turquoise sea"
              className="h-64 w-full object-cover sm:h-80 lg:h-[460px]"
              src="/somalia-coast.png"
              style={{ filter: "saturate(0.82) brightness(0.97)", objectPosition: "center 42%" }}
            />
          </div>
          <figcaption className="mt-2.5 text-right text-xs text-slate-400">
            
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  return (
    <section id="how-it-works" className="scroll-mt-24 bg-white px-5 py-16 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 text-center">
          <p className="text-[11px] font-black uppercase tracking-widest text-[#467ED3]">How it works</p>
          <h2 className="mt-2 text-3xl font-black text-slate-950 sm:text-4xl">Three simple steps</h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          {[
            { num: "1", title: "Create your profile", text: "Register once with your name, dialect, and region." },
            { num: "2", title: "Read a sentence", text: "Short everyday Somali prompts displayed one at a time." },
            { num: "3", title: "Submit your voice", text: "Recordings are securely stored and manually reviewed." },
          ].map((step) => (
            <div key={step.num} className="rounded-2xl border border-slate-100 bg-[#FAFBFD] p-7">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#467ED3] text-sm font-black text-white">
                {step.num}
              </span>
              <h3 className="mt-5 text-lg font-black text-slate-950">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">{step.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TrustSection() {
  return (
    <section className="bg-[#F7FAFF] px-5 py-16">
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 text-center">
          <p className="text-[11px] font-black uppercase tracking-widest text-[#467ED3]">Privacy & trust</p>
          <h2 className="mt-2 text-3xl font-black text-slate-950 sm:text-4xl">Built with care</h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          <div className="flex flex-col gap-4 rounded-2xl border border-white bg-white p-6 shadow-sm">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
              <svg aria-hidden="true" className="h-5 w-5 text-[#467ED3]" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
              </svg>
            </div>
            <div>
              <h3 className="font-black text-slate-950">Consent-based collection</h3>
              <p className="mt-1.5 text-sm leading-6 text-slate-500">Every recording is submitted with clear, explicit consent</p>
            </div>
          </div>

          <div className="flex flex-col gap-4 rounded-2xl border border-white bg-white p-6 shadow-sm">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
              <svg aria-hidden="true" className="h-5 w-5 text-[#467ED3]" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
            </div>
            <div>
              <h3 className="font-black text-slate-950">Private audio storage</h3>
              <p className="mt-1.5 text-sm leading-6 text-slate-500">All audio is stored in a private, secure bucket. Never publicly accessible.</p>
            </div>
          </div>

          <div className="flex flex-col gap-4 rounded-2xl border border-white bg-white p-6 shadow-sm">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
              <svg aria-hidden="true" className="h-5 w-5 text-[#467ED3]" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
              </svg>
            </div>
            <div>
              <h3 className="font-black text-slate-950">Admin-reviewed submissions</h3>
              <p className="mt-1.5 text-sm leading-6 text-slate-500">Our team manually reviews every recording before it enters the dataset.</p>
            </div>
          </div>
        </div>
        <p className="mt-10 text-center text-sm italic text-slate-400">
          "Codadka si ammaan iyo masuuliyad leh ayaa loo kaydinayaa."
        </p>
      </div>
    </section>
  );
}

function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const { t } = useLanguage();

  const items = [
    { q: t("faq.q1"), a: t("faq.a1") },
    { q: t("faq.q2"), a: t("faq.a2") },
    { q: t("faq.q3"), a: t("faq.a3") },
    { q: t("faq.q4"), a: t("faq.a4") },
    { q: t("faq.q5"), a: t("faq.a5") },
    { q: t("faq.q6"), a: t("faq.a6") },
    { q: t("faq.q7"), a: t("faq.a7") },
  ];

  return (
    <section id="faq" className="scroll-mt-24 bg-white px-5 py-16 sm:py-20">
      <div className="mx-auto max-w-2xl">
        <div className="mb-10 text-center">
          <p className="text-[11px] font-black uppercase tracking-widest text-[#467ED3]">{t("faq.eyebrow")}</p>
          <h2 className="mt-2 text-3xl font-black text-slate-950 sm:text-4xl">{t("faq.title")}</h2>
        </div>

        <div className="divide-y divide-slate-100 rounded-2xl border border-slate-100 bg-[#FAFBFD]">
          {items.map((item, i) => {
            const isOpen = openIndex === i;
            return (
              <div key={i}>
                <button
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left focus:outline-none"
                >
                  <span className="text-[15px] font-black text-slate-950">{item.q}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {isOpen && (
                  <p className="px-6 pb-5 text-sm leading-7 text-slate-500">{item.a}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function CtaSection({ onStart }: { onStart: () => void }) {
  return (
    <section className="bg-[#467ED3] px-5 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-4xl font-black leading-tight text-white sm:text-5xl">
          Add your voice to the Somali AI future.
        </h2>
        <p className="mt-4 text-base italic text-blue-100">
          "Codkaaga maanta wuxuu qayb ka noqon karaa AI-ga Soomaalida ee berri."
        </p>
        <button
          className="mt-9 rounded-xl bg-white px-8 py-3.5 text-base font-black text-[#467ED3] shadow-lg transition hover:bg-blue-50"
          onClick={onStart}
        >
          Contribute Voice
        </button>
      </div>
    </section>
  );
}

function SiteFooter() {
  const { t } = useLanguage();

  return (
    <footer className="bg-slate-950 px-5 py-12 text-center">
      <img
        alt="Rajo AI"
        className="mx-auto h-10 w-auto object-contain opacity-90"
        src="/logo%20rajo%20ai.png"
      />
      <p className="mt-5 text-sm font-semibold text-slate-400">{t("footer.questions")}</p>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">{t("footer.partnershipText")}</p>
      <a
        className="mt-1 block text-sm font-black text-blue-400 hover:text-blue-300"
        href="mailto:hello@rajoai.com"
      >
        hello@rajoai.com
      </a>
      <p className="mt-8 text-xs text-slate-600">{t("footer.note")}</p>
      <p className="mt-1 text-xs text-slate-700">© {new Date().getFullYear()} Rajo AI</p>
    </footer>
  );
}

function DatasetStatsSection() {
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPublicStats()
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, []);

  if (!loading && !stats) return null;

  const items = stats
    ? [
        { label: "Recordings", value: stats.total_recordings.toLocaleString() },
        { label: "Approved", value: stats.approved_recordings.toLocaleString() },
        { label: "Contributors", value: stats.total_contributors.toLocaleString() },
        { label: "Dialects", value: stats.dialects_covered.toLocaleString() },
      ]
    : (Array.from({ length: 4 }, () => null) as null[]);

  return (
    <section id="dataset" className="scroll-mt-24 border-y border-slate-100 bg-[#F7FAFF] px-5 py-12">
      <div className="mx-auto max-w-4xl">
        <div className="grid grid-cols-2 gap-y-8 sm:grid-cols-4">
          {items.map((item, i) =>
            item === null ? (
              <div key={i} className="animate-pulse text-center">
                <div className="mx-auto h-10 w-16 rounded-lg bg-slate-200" />
                <div className="mx-auto mt-2.5 h-3 w-20 rounded bg-slate-100" />
              </div>
            ) : (
              <div key={item.label} className="text-center">
                <p className="text-4xl font-black tabular-nums text-slate-950 sm:text-5xl">
                  {item.value}
                </p>
                <p className="mt-1.5 text-[11px] font-black uppercase tracking-widest text-slate-400">
                  {item.label}
                </p>
              </div>
            ),
          )}
        </div>
        <p className="mt-10 text-center text-sm italic text-[#467ED3]">
          "Waxaan wada dhisaynaa mustaqbalka codka Soomaalida."
        </p>
      </div>
    </section>
  );
}

function AuthPage({
  authMode,
  busy,
  formData,
  loginEmail,
  loginPassword,
  message,
  onBack,
  onFormChange,
  onLogin,
  onLoginEmailChange,
  onLoginPasswordChange,
  onRegister,
  onSwitchMode,
}: {
  authMode: AuthMode;
  busy: boolean;
  formData: RegistrationFormData;
  loginEmail: string;
  loginPassword: string;
  message: string;
  onBack: () => void;
  onFormChange: (data: RegistrationFormData) => void;
  onLogin: (event: FormEvent<HTMLFormElement>) => void;
  onLoginEmailChange: (value: string) => void;
  onLoginPasswordChange: (value: string) => void;
  onRegister: (event: FormEvent<HTMLFormElement>) => void;
  onSwitchMode: (mode: AuthMode) => void;
}) {
  return (
    <section className="mx-auto max-w-xl px-5 py-10">
      <button className="btn-ghost mb-5" onClick={onBack}>Back</button>
      <div className="app-card p-5 sm:p-7">
        <h1 className="text-3xl font-black text-slate-950">
          {authMode === "register" ? "Create your voice account" : "Sign in to keep recording"}
        </h1>
        <p className="mt-2 text-slate-600">
          {authMode === "register"
            ? "Register once. Your browser will remember your logged-in session."
            : "Welcome back. Log in and continue from your next prompt."}
        </p>

        <div className="mt-5 grid grid-cols-2 rounded-2xl bg-slate-100 p-1">
          <button className={`tab-button ${authMode === "register" ? "active" : ""}`} onClick={() => onSwitchMode("register")}>
            Register
          </button>
          <button className={`tab-button ${authMode === "login" ? "active" : ""}`} onClick={() => onSwitchMode("login")}>
            Login
          </button>
        </div>

        {authMode === "register" ? (
          <form className="mt-6 space-y-4" onSubmit={onRegister}>
            <TextField label="Name" required value={formData.fullName} onChange={(value) => onFormChange({ ...formData, fullName: value })} />
            <TextField label="Email" required type="email" value={formData.email} onChange={(value) => onFormChange({ ...formData, email: value })} />
            <TextField label="Password" required type="password" value={formData.password} onChange={(value) => onFormChange({ ...formData, password: value })} />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Age range"
                placeholder="Select your age range"
                required
                value={formData.ageRange}
                onChange={(value) => onFormChange({ ...formData, ageRange: value as RegistrationFormData["ageRange"] })}
                options={AGE_RANGE_OPTIONS}
              />
              <label className="block">
                <span className="field-label">Gender</span>
                <select className="field" value={formData.gender} onChange={(event) => onFormChange({ ...formData, gender: event.target.value as RegistrationFormData["gender"] })}>
                  <option>Prefer not to say</option>
                  <option>Female</option>
                  <option>Male</option>
                </select>
              </label>
            </div>
            <label className="block">
              <span className="field-label">Country</span>
              <select
                className="field"
                value={formData.country}
                onChange={(event) => onFormChange({ ...formData, country: event.target.value })}
              >
                <option value="">Select your country</option>
                <optgroup label="Common">
                  {PRIORITY_COUNTRIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </optgroup>
                <optgroup label="All Countries">
                  {OTHER_COUNTRIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </optgroup>
              </select>
            </label>
            <TextField label="City" placeholder="e.g. Mogadishu" value={formData.city} onChange={(value) => onFormChange({ ...formData, city: value })} />
            <label className="block">
              <span className="field-label">Dialect</span>
              <select
                className="field"
                required
                value={formData.dialect}
                onChange={(event) =>
                  onFormChange({
                    ...formData,
                    dialect: event.target.value,
                    dialectOther: "",
                  })
                }
              >
                <option value="">Select your dialect</option>
                {DIALECT_OPTIONS.map((dialect) => (
                  <option key={dialect} value={dialect}>
                    {dialect}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm font-semibold text-slate-700">
              <input checked={formData.consent} className="mt-1 h-4 w-4" required type="checkbox" onChange={(event) => onFormChange({ ...formData, consent: event.target.checked })} />
              I consent to Rajo AI collecting my submitted voice recordings for ethical Somali voice AI.
            </label>
            <button className="btn-primary w-full" disabled={busy} type="submit">
              {busy ? "Creating account..." : "Create Account"}
            </button>
          </form>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={onLogin}>
            <TextField label="Email" required type="email" value={loginEmail} onChange={onLoginEmailChange} />
            <TextField label="Password" required type="password" value={loginPassword} onChange={onLoginPasswordChange} />
            <button className="btn-primary w-full" disabled={busy} type="submit">
              {busy ? "Signing in..." : "Sign In"}
            </button>
          </form>
        )}

        {message && <p className="mt-4 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-700">{message}</p>}
      </div>
    </section>
  );
}

function Dashboard({
  completedPromptIds,
  history,
  promptLoading,
  promptPacks,
  promptProgressMessage,
  prompts,
  stats,
  user,
  onRecord,
}: {
  completedPromptIds: string[];
  history: RecordingHistoryItem[];
  promptLoading: boolean;
  promptPacks: PromptPack[];
  promptProgressMessage: string;
  prompts: VoicePrompt[];
  stats: { total: number; minutes: number; approved: number; pending: number };
  user: RegisteredUser;
  onRecord: () => void;
}) {
  const { t } = useLanguage();
  const [publicStats, setPublicStats] = useState<PublicStats | null>(null);

  useEffect(() => {
    fetchPublicStats().then(setPublicStats).catch(() => {});
  }, []);

  const streak = useMemo(() => calculateStreak(history), [history]);
  const todayCount = useMemo(() => countTodayRecordings(history), [history]);
  const currentPack =
    promptPacks.find((pack) => pack.promptCount === 0 || pack.completedPromptCount < pack.promptCount) ??
    promptPacks[promptPacks.length - 1];
  const totalPrompts = currentPack?.promptCount ?? 0;
  const completedCount = Math.min(currentPack?.completedPromptCount ?? 0, totalPrompts);
  const remainingPrompts = Math.max(totalPrompts - completedCount, 0);
  const unlockedCount = promptPacks.length;
  const progressPct = totalPrompts > 0 ? Math.min(Math.round((completedCount / totalPrompts) * 100), 100) : 0;
  const rank = getContributorRank(stats.total, t);
  const DAILY_GOAL = 5;

  const milestones = [
    { icon: <Mic className="h-3.5 w-3.5" />, label: t("dashboard.firstRecording"), unlocked: stats.total >= 1 },
    { icon: <Flame className="h-3.5 w-3.5" />, label: t("dashboard.threeDayStreak"), unlocked: streak >= 3 },
    { icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: t("dashboard.firstApproval"), unlocked: stats.approved >= 1 },
    { icon: <Star className="h-3.5 w-3.5" />, label: t("dashboard.tenRecordings"), unlocked: stats.total >= 10 },
    { icon: <Trophy className="h-3.5 w-3.5" />, label: t("dashboard.twentyFiveRecordings"), unlocked: stats.total >= 25 },
  ];

  const DATASET_GOAL = 10_000;
  const communityTotal = publicStats?.total_recordings ?? 0;
  const communityPct = Math.min(Math.round((communityTotal / DATASET_GOAL) * 100), 100);

  return (
    <div className="min-h-screen bg-[#F7FAFF] pb-16">
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-6 sm:px-6">

        {/* Hero */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#467ED3] to-[#2D5DB0] p-7 text-white shadow-lg sm:p-10">
          {/* Audio waveform texture — decorative */}
          <div aria-hidden="true" className="pointer-events-none absolute bottom-0 right-0 flex items-end gap-[3px] pb-7 pr-7 opacity-[0.13]">
            {[14, 26, 42, 20, 54, 32, 64, 24, 48, 36, 70, 22, 52, 38, 60, 18, 44, 30, 56, 16, 46, 28, 62, 20, 40].map((h, i) => (
              <div key={i} className="w-[3px] rounded-full bg-white" style={{ height: `${h}px` }} />
            ))}
          </div>

          <div className="relative z-10 max-w-lg">
            <p className="text-[11px] font-black uppercase tracking-widest opacity-60">{t("dashboard.label")}</p>
            <h1 className="mt-3 text-2xl font-black leading-snug sm:text-[1.75rem]">
              {firstName(user.fullName)}, {t("dashboard.titleSuffix")}
            </h1>
            <p className="mt-3 text-sm leading-[1.75] opacity-75">
              {t("dashboard.body")}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm font-semibold opacity-70">
              {streak > 0 && (
                <span className="flex items-center gap-1.5">
                  <Flame className="h-3.5 w-3.5" /> {t("dashboard.streakDays", { count: streak })}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <Award className="h-3.5 w-3.5" /> {rank}
              </span>
            </div>
            <button
              className="mt-7 rounded-xl bg-white px-6 py-2.5 text-sm font-black text-[#467ED3] shadow-sm transition hover:bg-blue-50"
              onClick={onRecord}
            >
              {t("dashboard.continue")}
            </button>
          </div>
        </div>

        {/* Progress */}
        <div className="rounded-3xl bg-white p-6 shadow-sm">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest text-[#467ED3]">{t("dashboard.packProgress")}</p>
              <p className="mt-1.5 text-xl font-black text-slate-950">
                {promptLoading ? t("dashboard.loadingPrompts") : t("dashboard.promptsCompleted", { completed: completedCount, total: totalPrompts })}
              </p>
              {currentPack && (
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  {t("dashboard.currentSet", { title: translatePackTitle(currentPack.title, t), count: unlockedCount })}
                </p>
              )}
            </div>
            <p className="shrink-0 text-2xl font-black text-slate-200">{progressPct}%</p>
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-[#467ED3] transition-all duration-700"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            {promptProgressMessage || (completedCount === 0
              ? t("dashboard.firstPrompt")
              : completedCount < totalPrompts
                ? t("dashboard.remaining", { count: remainingPrompts })
                : t("dashboard.packComplete"))}
          </p>
        </div>

        {/* Total Contributions */}
        <div className="space-y-3">
          <p className="px-1 text-[11px] font-black uppercase tracking-widest text-[#467ED3]">{t("dashboard.totalContributions")}</p>
          {/* Primary — what matters most */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="text-4xl font-black tracking-tight text-slate-950">{stats.total}</p>
              <p className="mt-1.5 text-sm text-slate-500">{t("dashboard.recordingsSubmitted")}</p>
            </div>
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="text-4xl font-black tracking-tight text-slate-950">{stats.minutes.toFixed(1)}</p>
              <p className="mt-1.5 text-sm text-slate-500">{t("dashboard.minutesDonated")}</p>
            </div>
          </div>
          {/* Secondary — supporting context */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white px-5 py-4 shadow-sm">
              <p className="text-lg font-black text-slate-700">{stats.approved}</p>
              <p className="mt-0.5 text-xs text-slate-400">{t("dashboard.recordingsApproved")}</p>
            </div>
            <div className="rounded-2xl bg-white px-5 py-4 shadow-sm">
              <p className="text-lg font-black text-slate-700">{streak > 0 ? t("dashboard.streakDayShort", { count: streak }) : "—"}</p>
              <p className="mt-0.5 text-xs text-slate-400">{t("dashboard.currentStreak")}</p>
            </div>
          </div>
        </div>

        {/* Today + Recent activity */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-3xl bg-white p-6 shadow-sm">
            <p className="text-[11px] font-black uppercase tracking-widest text-[#467ED3]">{t("dashboard.today")}</p>
            <p className="mt-2 text-xl font-black text-slate-950">
              {todayCount === 0
                ? t("dashboard.noToday")
                : todayCount >= DAILY_GOAL
                  ? t("dashboard.goalReached")
                  : t("dashboard.recordedOfGoal", { count: todayCount, goal: DAILY_GOAL })}
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-[#467ED3] transition-all duration-700"
                style={{ width: `${Math.min((todayCount / DAILY_GOAL) * 100, 100)}%` }}
              />
            </div>
            <p className="mt-2.5 text-xs text-slate-400">
              {todayCount >= DAILY_GOAL
                ? t("dashboard.goalDone")
                : t("dashboard.goalMore", { count: DAILY_GOAL - todayCount, goal: DAILY_GOAL })}
            </p>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-sm">
            <p className="text-[11px] font-black uppercase tracking-widest text-[#467ED3]">{t("dashboard.recentActivity")}</p>
            {history.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">{t("dashboard.noActivity")}</p>
            ) : (
              <ul className="mt-3 space-y-3.5">
                {history.slice(0, 4).map((item) => {
                  const activityIcon =
                    item.status === "approved"
                      ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      : item.status === "rejected"
                        ? <XCircle className="h-4 w-4 text-red-400" />
                        : <Mic className="h-4 w-4 text-slate-400" />;
                  const label =
                    item.status === "approved"
                      ? t("dashboard.approved")
                      : item.status === "rejected"
                        ? t("dashboard.needsRerecording")
                        : t("dashboard.submitted");
                  return (
                    <li key={item.id} className="flex items-start gap-2.5">
                      <span className="mt-0.5 shrink-0">{activityIcon}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-700">{label}</p>
                        <p className="truncate text-xs text-slate-400">{item.sentenceText}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Milestones */}
        <div className="rounded-3xl bg-white p-6 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-widest text-[#467ED3]">{t("dashboard.milestones")}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {milestones.map((m) => (
              <div
                key={m.label}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${
                  m.unlocked
                    ? "bg-[#467ED3]/10 text-[#467ED3]"
                    : "border border-slate-100 text-slate-300"
                }`}
              >
                {m.icon}
                <span>{m.label}</span>
                {m.unlocked && <CheckCircle2 className="h-3.5 w-3.5 opacity-60" />}
              </div>
            ))}
          </div>
        </div>

        {/* The bigger picture */}
        <div className="rounded-3xl bg-white p-6 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-widest text-[#467ED3]">{t("dashboard.biggerPicture")}</p>
          <div className="mt-3 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-sm">
              <p className="text-lg font-black leading-snug text-slate-950">
                {t("dashboard.biggerTitle")}
              </p>
              <p className="mt-2.5 text-sm leading-6 text-slate-500">
                {t("dashboard.biggerText")}
              </p>
            </div>
            <div className="shrink-0 sm:text-right">
              <p className="text-4xl font-black tabular-nums text-[#467ED3] sm:text-5xl">
                {communityTotal.toLocaleString()}
              </p>
              <p className="mt-1 text-[11px] font-black uppercase tracking-wider text-slate-400">
                {t("dashboard.communityRecordings")}
              </p>
            </div>
          </div>
          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-[#467ED3] transition-all duration-700"
              style={{ width: `${communityPct}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-slate-400">
            <span>{t("dashboard.towardGoal", { pct: communityPct })}</span>
            <span>{t("dashboard.goal", { count: DATASET_GOAL.toLocaleString() })}</span>
          </div>
          <p className="mt-5 border-t border-slate-50 pt-4 text-xs italic text-slate-400">
            "Waxaan wada dhisaynaa mustaqbalka codka Soomaalida." — Together we are building the future of the Somali voice.
          </p>
        </div>

      </div>
    </div>
  );
}

function RecordingPage({
  completedPromptIds,
  history,
  unlockNotice,
  onDismissUnlock,
  pendingOfflineCount,
  prompts,
  user,
  onBack,
  onSubmitRecording,
}: {
  completedPromptIds: string[];
  history: RecordingHistoryItem[];
  unlockNotice: string;
  onDismissUnlock: () => void;
  pendingOfflineCount: number;
  prompts: VoicePrompt[];
  user: RegisteredUser;
  onBack: () => void;
  onSubmitRecording: (prompt: VoicePrompt, blob: Blob, metadata: RecordingMetadata) => Promise<{ offlineSaved: boolean }>;
}) {
  const { t } = useLanguage();
  const firstIncompleteIndex = Math.max(prompts.findIndex((prompt) => !completedPromptIds.includes(prompt.sentenceId)), 0);
  const [promptIndex, setPromptIndex] = useState(firstIncompleteIndex);
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [metadata, setMetadata] = useState({
    deviceType: "Phone",
    backgroundNoise: "Quiet",
    speakingSpeed: "Normal",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [offlineSuccess, setOfflineSuccess] = useState(false);
  const [liveSeconds, setLiveSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const prompt = prompts[promptIndex] ?? prompts[0];
  const completed = prompt ? completedPromptIds.includes(prompt.sentenceId) : false;
  const [unlockTitle, unlockBody] = unlockNotice.split("|");

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  useEffect(() => {
    return () => stopActiveStream();
  }, []);

  // Live recording timer
  useEffect(() => {
    if (recorderState !== "recording") {
      setLiveSeconds(0);
      return;
    }
    setLiveSeconds(0);
    const interval = setInterval(() => setLiveSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [recorderState]);

  // Warn before leaving while recording or uploading
  useEffect(() => {
    const shouldWarn = recorderState === "recording" || busy;
    if (!shouldWarn) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [recorderState, busy]);

  useEffect(() => {
    setPromptIndex(Math.max(prompts.findIndex((item) => !completedPromptIds.includes(item.sentenceId)), 0));
  }, [completedPromptIds, prompts]);

  async function startRecording() {
    if (recorderState !== "idle") return;

    setError("");
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl("");
    setDuration(0);
    setRecorderState("starting");

    try {
      if (!window.isSecureContext) {
        throw new Error("Microphone recording requires a secure HTTPS connection.");
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not support microphone recording.");
      }

      if (typeof MediaRecorder === "undefined") {
        throw new Error("This browser does not support the MediaRecorder API.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      streamRef.current = stream;
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || chunksRef.current[0]?.type || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        const url = URL.createObjectURL(blob);
        setAudioBlob(blob);
        setAudioUrl(url);
        setRecorderState("recorded");
        stopActiveStream();
        setDuration(startedAtRef.current ? Math.max((Date.now() - startedAtRef.current) / 1000, 0) : 0);
        startedAtRef.current = null;
      };
      recorder.onerror = () => {
        stopActiveStream();
        startedAtRef.current = null;
        setRecorderState("idle");
        setError("Recording failed. Please try again or check Safari microphone permissions.");
      };
      startedAtRef.current = Date.now();
      recorder.start();
      setRecorderState("recording");
    } catch (err) {
      stopActiveStream();
      startedAtRef.current = null;
      setRecorderState("idle");
      setError(getMicrophoneErrorMessage(err));
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;

    try {
      recorder.stop();
    } catch (err) {
      stopActiveStream();
      startedAtRef.current = null;
      setRecorderState("idle");
      setError(getMicrophoneErrorMessage(err));
    }
  }

  function resetRecording() {
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl("");
    stopActiveStream();
    startedAtRef.current = null;
    setRecorderState("idle");
    setDuration(0);
  }

  function stopActiveStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
  }

  async function submitRecording() {
    if (!audioBlob || !prompt) return;
    setBusy(true);
    setError("");
    setOfflineSuccess(false);

    try {
      const result = await onSubmitRecording(prompt, audioBlob, {
        ageRange: user.ageRange,
        country: user.country,
        city: user.city,
        deviceType: metadata.deviceType,
        backgroundNoise: metadata.backgroundNoise,
        speakingSpeed: metadata.speakingSpeed,
        consent: true,
      });
      if (result.offlineSaved) {
        setOfflineSuccess(true);
      }
      resetRecording();
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      const isNetworkError =
        raw.includes("Load failed") ||
        raw.includes("Failed to fetch") ||
        raw.includes("Network request failed") ||
        raw.includes("NetworkError");
      setError(isNetworkError ? t("record.offlineError") : (raw || t("record.submitFailed")));
    } finally {
      setBusy(false);
    }
  }

  function goToNext() {
    const nextIncomplete = prompts.findIndex(
      (item, index) => index > promptIndex && !completedPromptIds.includes(item.sentenceId),
    );
    setPromptIndex(nextIncomplete >= 0 ? nextIncomplete : Math.min(promptIndex + 1, prompts.length - 1));
  }

  function skipPrompt() {
    resetRecording();
    setPromptIndex((index) => (index + 1) % prompts.length);
  }

  if (!prompt) return <CenteredMessage text={t("record.none")} />;

  return (
    <section className="mx-auto max-w-4xl px-4 py-4 sm:px-5 sm:py-8">
      <button className="btn-ghost mb-3 sm:mb-5" onClick={onBack}>{t("record.back")}</button>
      <div className="app-card overflow-hidden">
        <div className="border-b border-slate-200 bg-blue-50 px-4 py-3 sm:px-7 sm:py-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-bold text-blue-700">{t("record.promptOf", { current: promptIndex + 1, total: prompts.length })}</p>
            <p className="text-sm font-semibold text-slate-600">{user.fullName}</p>
          </div>
        </div>

        <div className="p-4 sm:p-8">
          {unlockNotice && (
            <div className="mb-3 rounded-3xl border border-blue-100 bg-blue-50 p-4 sm:mb-6 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-lg font-black text-[#467ED3]">{unlockTitle}</p>
                  <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">{unlockBody}</p>
                </div>
                <button className="btn-secondary min-h-10 rounded-xl px-4 py-2 text-xs" onClick={onDismissUnlock}>
                  {t("common.continue")}
                </button>
              </div>
            </div>
          )}

          {offlineSuccess && (
            <div className="mb-3 rounded-3xl border border-amber-200 bg-amber-50 p-3 sm:mb-5 sm:p-4">
              <p className="text-sm font-semibold text-amber-800">{t("record.offlineSaved")}</p>
            </div>
          )}

          {pendingOfflineCount > 0 && (
            <div className="mb-3 flex items-center gap-2 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 sm:mb-5 sm:px-4 sm:py-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[11px] font-black text-white">
                {pendingOfflineCount}
              </span>
              <p className="text-xs font-semibold text-amber-800">
                {t("record.offlinePending", { count: pendingOfflineCount })}
              </p>
            </div>
          )}

          {/* 1. Prompt card */}
          <div className="rounded-3xl border border-slate-200 bg-white p-4 text-center shadow-sm sm:p-6">
            <p className="text-sm font-bold uppercase tracking-wide text-slate-500">{t("record.readPrompt")}</p>
            <p className="mt-1 text-xs font-black uppercase tracking-widest text-[#467ED3] sm:mt-2">{translatePackTitle(prompt.packTitle, t)}</p>
            <h1 className="mt-3 text-3xl font-black leading-tight text-slate-950 sm:mt-5 sm:text-5xl">{prompt.sentenceText}</h1>
            {completed && (
              <p className="mt-3 rounded-full bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700 sm:mt-5">
                {t("record.completed")}
              </p>
            )}
          </div>

          {/* 2. Recording controls — directly below prompt */}
          {recorderState === "starting" && (
            <div className="mt-3 rounded-3xl border border-blue-100 bg-blue-50 p-4 text-center sm:mt-4 sm:p-5">
              <p className="text-lg font-black text-blue-700">{t("record.starting")}</p>
            </div>
          )}

          {recorderState === "recording" && (
            <div className="mt-3 rounded-3xl border border-red-100 bg-red-50 p-4 text-center sm:mt-4 sm:p-5">
              <div className="flex items-center justify-center gap-2.5">
                <span className="relative flex h-3 w-3 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
                </span>
                <p className="text-base font-black text-red-700">{t("record.recording")}</p>
              </div>
              <p className="mt-1.5 tabular-nums text-3xl font-black text-red-700">
                {String(Math.floor(liveSeconds / 60)).padStart(2, "0")}
                <span className="animate-pulse">:</span>
                {String(liveSeconds % 60).padStart(2, "0")}
              </p>
              <button
                className="btn-danger mt-3 w-full min-h-[48px] text-base"
                onClick={stopRecording}
              >
                {t("record.stop")}
              </button>
            </div>
          )}

          {recorderState === "idle" && (
            <div className="mt-3 flex flex-wrap gap-3 sm:mt-4">
              <button
                className="btn-primary flex-1 min-h-[52px] text-base sm:flex-none"
                type="button"
                onClick={() => void startRecording()}
              >
                <Mic className="mr-2 h-[18px] w-[18px]" aria-hidden="true" />
                {t("common.startRecording")}
              </button>
              <button className="btn-secondary" onClick={skipPrompt}>{t("record.skip")}</button>
            </div>
          )}

          {/* 3. Playback preview */}
          {audioUrl && (
            <div className="mt-3 rounded-3xl border border-blue-100 bg-blue-50 p-3 sm:mt-5 sm:p-4">
              <audio ref={audioRef} className="w-full" controls src={audioUrl} />
              <p className="mt-1.5 text-sm font-semibold text-blue-700 sm:mt-2">{t("record.duration", { seconds: duration.toFixed(1) })}</p>
            </div>
          )}

          {/* 4. Recording details */}
          <div className="mt-3 rounded-3xl border border-slate-200 bg-white p-4 sm:mt-5 sm:p-5">
            <h2 className="text-lg font-black text-slate-950">{t("record.details")}</h2>
            <div className="mt-3 grid gap-3 sm:mt-4 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <SelectField label={t("record.device")} value={metadata.deviceType} onChange={(value) => setMetadata({ ...metadata, deviceType: value })} options={["Phone", "Laptop", "External Microphone"]} />
              <SelectField label={t("record.noise")} value={metadata.backgroundNoise} onChange={(value) => setMetadata({ ...metadata, backgroundNoise: value })} options={["Quiet", "Medium", "Noisy"]} />
              <SelectField label={t("record.speed")} value={metadata.speakingSpeed} onChange={(value) => setMetadata({ ...metadata, speakingSpeed: value })} options={["Slow", "Normal", "Fast"]} />
            </div>
          </div>

          {/* 5. Submit area — only after recording is done */}
          {recorderState === "recorded" && (
            <div className="mt-3 flex flex-wrap gap-3 sm:mt-5">
              <button className="btn-secondary" onClick={() => audioRef.current?.play()}>{t("record.play")}</button>
              <button className="btn-secondary" onClick={resetRecording}>{t("record.rerecord")}</button>
              <button
                className="btn-primary flex-1 min-h-[52px] text-base sm:flex-none"
                disabled={busy}
                onClick={submitRecording}
              >
                {busy ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    {t("record.submitting")}
                  </span>
                ) : (
                  <>
                    <Upload className="mr-2 h-[18px] w-[18px]" aria-hidden="true" />
                    {t("record.submit")}
                  </>
                )}
              </button>
            </div>
          )}

          {error && <p className="mt-3 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-700 sm:mt-4">{error}</p>}

          <div className="mt-5 sm:mt-8">
            <h2 className="text-lg font-black text-slate-950">{t("record.recent")}</h2>
            <div className="mt-2 space-y-2 sm:mt-3 sm:space-y-3">
              {history.slice(0, 4).map((item) => (
                <div className="flex items-center justify-between rounded-2xl border border-slate-200 p-3" key={item.id}>
                  <p className="line-clamp-1 text-sm font-semibold text-slate-700">{item.sentenceText}</p>
                  <StatusPill status={item.status} />
                </div>
              ))}
              {history.length === 0 && <p className="text-sm text-slate-500">{t("common.noRecordingsYet")}</p>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Profile Page ────────────────────────────────────────────────

function ProfilePage({
  user,
  donorId,
  onSave,
  onBack,
}: {
  user: RegisteredUser;
  donorId: string;
  onSave: (updates: ProfileUpdates, avatarFile?: File) => Promise<void>;
  onBack: () => void;
}) {
  const [name, setName]       = useState(user.fullName);
  const [country, setCountry] = useState(user.country);
  const [dialect, setDialect] = useState(user.dialect);
  const [busy, setBusy]       = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError]     = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(user.avatarUrl);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const userInitial = user.fullName[0]?.toUpperCase() ?? "U";

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (previewUrl && previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSuccess(false);
    try {
      const file = fileInputRef.current?.files?.[0];
      await onSave({ fullName: name, country, dialect }, file);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F7FAFF] px-5 py-10">
      <div className="mx-auto max-w-xl">
        <button
          onClick={onBack}
          className="mb-8 flex items-center gap-1.5 text-[13px] font-medium text-slate-500 transition-colors hover:text-slate-800 focus:outline-none"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>

        <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-8 py-6">
            <p className="text-[11px] font-black uppercase tracking-widest text-[#467ed3]">Account</p>
            <h1 className="mt-1 text-2xl font-black text-slate-950">Your Profile</h1>
            <p className="mt-1 text-sm text-slate-500">Update your personal information and profile photo.</p>
          </div>

          <form onSubmit={handleSubmit} className="px-8 py-7 space-y-6">
            {/* Avatar upload */}
            <div className="flex items-center gap-5">
              <div className="relative shrink-0">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Profile"
                    className="h-20 w-20 rounded-full object-cover ring-4 ring-[#467ed3]/10"
                  />
                ) : (
                  <span
                    style={{ backgroundColor: "#467ed3" }}
                    className="flex h-20 w-20 items-center justify-center rounded-full text-3xl font-black text-white ring-4 ring-[#467ed3]/10"
                  >
                    {userInitial}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[#467ed3] text-white shadow transition hover:bg-[#3a6bbf] focus:outline-none"
                  aria-label="Change profile photo"
                >
                  <Upload className="h-3.5 w-3.5" />
                </button>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">Profile photo</p>
                <p className="mt-0.5 text-xs text-slate-500">JPG, PNG or WebP. Max 5 MB.</p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-2 text-xs font-semibold text-[#467ed3] hover:underline focus:outline-none"
                >
                  Upload photo
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            <div className="h-px bg-slate-100" />

            {/* Name */}
            <label className="block">
              <span className="field-label">Full name</span>
              <input
                className="field"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            {/* Email (read-only) */}
            <label className="block">
              <span className="field-label">Email address</span>
              <input
                className="field bg-slate-50 text-slate-500 cursor-not-allowed"
                type="email"
                value={user.email}
                readOnly
              />
              <p className="mt-1 text-[11px] text-slate-400">Email cannot be changed here.</p>
            </label>

            {/* Country */}
            <label className="block">
              <span className="field-label">Country</span>
              <select
                className="field"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              >
                {["Somalia", "Kenya", "Ethiopia", "Djibouti", "Uganda", "USA", "UK", "Canada"].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
                <optgroup label="Other">
                  {["Australia", "Belgium", "Denmark", "Finland", "France", "Germany", "Netherlands", "New Zealand", "Norway", "Sweden", "Switzerland", "United Arab Emirates"].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </optgroup>
              </select>
            </label>

            {/* Dialect */}
            <label className="block">
              <span className="field-label">Dialect</span>
              <select
                className="field"
                value={dialect}
                onChange={(e) => setDialect(e.target.value)}
              >
                <option value="Maxaa Tiri">Maxaa Tiri</option>
                <option value="May May">May May</option>
              </select>
            </label>

            {success && (
              <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                Profile updated successfully.
              </p>
            )}
            {error && (
              <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="btn-primary w-full"
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Contributions Page ───────────────────────────────────────────

function ContributionsPage({
  history,
  promptPacks,
  stats,
  user,
  onRecord,
  onBack,
}: {
  history: RecordingHistoryItem[];
  promptPacks: PromptPack[];
  stats: { total: number; minutes: number; approved: number; pending: number };
  user: RegisteredUser;
  onRecord: () => void;
  onBack: () => void;
}) {
  const { t } = useLanguage();
  const rejected       = history.filter((r) => r.status === "rejected").length;
  const activePacks    = promptPacks.filter((p) => p.completedAt === null);
  const completedPacks = promptPacks.filter((p) => p.completedAt !== null);
  const streak         = calculateStreak(history);
  const rank           = getContributorRank(stats.total, t);

  const statCards = [
    {
      label: "Total",    sub: "Recordings", value: stats.total,    desc: "sentences donated",
      Icon: Mic,          iconBg: "bg-[#467ed3]/[0.07]", iconColor: "text-[#467ed3]", numColor: "text-slate-900",
    },
    {
      label: "Approved", sub: "Recordings", value: stats.approved, desc: "added to the dataset",
      Icon: CheckCircle2, iconBg: "bg-emerald-50",       iconColor: "text-emerald-500", numColor: "text-emerald-600",
    },
    {
      label: "Pending",  sub: "Review",     value: stats.pending,  desc: "being checked now",
      Icon: Clock,        iconBg: "bg-amber-50",          iconColor: "text-amber-500",   numColor: "text-amber-600",
    },
    {
      label: "Needs",    sub: "Re-record",  value: rejected,       desc: "can be re-done",
      Icon: RotateCcw,    iconBg: "bg-red-50",            iconColor: "text-red-400",     numColor: "text-red-500",
    },
  ];

  return (
    <div className="min-h-screen bg-[#F8F9FB]">

      {/* ── Hero ──────────────────────────────────────────── */}
      <div className="border-b border-slate-100 bg-white">
        <div className="mx-auto max-w-3xl px-5 py-8 sm:py-10 lg:px-6">
          <button
            onClick={onBack}
            className="mb-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-400 transition-colors hover:text-slate-600 focus:outline-none"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back
          </button>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#467ed3]">
                Voice contributor
              </p>
              <h1 className="mt-1.5 text-[26px] font-black leading-tight tracking-tight text-slate-950 sm:text-[28px]">
                Your Voice Contribution
              </h1>
              <p className="mt-2 max-w-md text-[14.5px] leading-relaxed text-slate-500">
                Every sentence you record helps build ethical Somali speech technology — for everyone.
              </p>
            </div>
            <button
              onClick={onRecord}
              style={{ backgroundColor: "#467ed3" }}
              className="self-start rounded-xl px-5 py-2.5 text-[14px] font-semibold text-white shadow-sm transition hover:opacity-90 active:scale-95 focus:outline-none sm:mt-1 sm:shrink-0"
            >
              Record now
            </button>
          </div>

          {/* Contributor summary row */}
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-5 text-[13px]">
            <span className="flex items-center gap-1.5 font-semibold text-slate-700">
              <span style={{ backgroundColor: "#467ed3" }} className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-black text-white">
                {user.fullName[0]?.toUpperCase()}
              </span>
              {user.fullName}
            </span>
            <span className="text-slate-300">·</span>
            <span className="text-slate-500">{user.dialect}</span>
            <span className="text-slate-300">·</span>
            <span className="text-slate-500">{user.country}</span>
            {streak > 0 && (
              <>
                <span className="text-slate-300">·</span>
                <span className="flex items-center gap-1 font-medium text-orange-500">
                  <Flame className="h-3.5 w-3.5" aria-hidden="true" />
                  {streak} day{streak !== 1 ? "s" : ""} streak
                </span>
              </>
            )}
            <span className="rounded-full bg-[#467ed3]/[0.08] px-2.5 py-0.5 text-[12px] font-semibold text-[#467ed3]">
              {rank}
            </span>
          </div>
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────── */}
      <div className="mx-auto max-w-3xl space-y-4 px-5 py-6 lg:px-6">

        {/* Stat cards — 2×2 on mobile, 4-col on sm+ */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {statCards.map(({ label, sub, value, desc, Icon, iconBg, iconColor, numColor }) => (
            <div
              key={label}
              className="flex flex-col rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.04)]"
            >
              <div className={`mb-3 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
                <Icon className={`h-4 w-4 ${iconColor}`} aria-hidden="true" />
              </div>
              <p className={`text-[26px] font-black tabular-nums leading-none ${numColor}`}>{value}</p>
              <p className="mt-2 text-[12px] leading-tight text-slate-700">
                <span className="font-semibold">{label}</span>{" "}
                <span className="text-slate-400">{sub}</span>
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">{desc}</p>
            </div>
          ))}
        </div>

        {/* Active recording packs */}
        {activePacks.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
            <div className="flex items-center justify-between border-b border-slate-50 px-5 py-4">
              <div>
                <p className="text-[13px] font-bold text-slate-900">Recording packs</p>
                <p className="mt-0.5 text-[12px] text-slate-400">
                  Short sets of Somali sentences to improve dialect coverage
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-[#467ed3]/[0.08] px-2.5 py-1 text-[11.5px] font-semibold text-[#467ed3]">
                {activePacks.length} active
              </span>
            </div>

            <div className="divide-y divide-slate-50 px-5">
              {activePacks.map((pack) => {
                const pct = pack.promptCount > 0
                  ? Math.round((pack.completedPromptCount / pack.promptCount) * 100)
                  : 0;
                return (
                  <div key={pack.id} className="py-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="truncate text-[13.5px] font-medium text-slate-800">{pack.title}</p>
                      <span className="shrink-0 text-[12px] tabular-nums text-slate-400">
                        {pack.completedPromptCount} / {pack.promptCount}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-[#467ed3] transition-all duration-700"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-[11.5px] text-slate-400">{pct}% complete</p>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-slate-50 px-5 py-4">
              <button
                onClick={onRecord}
                style={{ backgroundColor: "#467ed3" }}
                className="w-full rounded-xl py-2.5 text-[14px] font-semibold text-white transition hover:opacity-90 active:scale-[0.99] focus:outline-none"
              >
                {t("common.continueRecording")}
              </button>
            </div>
          </div>
        )}

        {/* Completed packs */}
        {completedPacks.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
            <div className="flex items-center justify-between border-b border-slate-50 px-5 py-4">
              <p className="text-[13px] font-bold text-slate-900">Completed packs</p>
              <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-700">
                {completedPacks.length} done
              </span>
            </div>
            <div className="divide-y divide-slate-50 px-5">
              {completedPacks.map((pack) => (
                <div key={pack.id} className="flex items-center gap-3 py-3.5">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                  <p className="flex-1 truncate text-[13.5px] font-medium text-slate-700">{pack.title}</p>
                  <span className="shrink-0 text-[12px] text-slate-400">{pack.promptCount} sentences</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recording history */}
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
          <div className="flex items-center justify-between border-b border-slate-50 px-5 py-4">
            <div>
              <p className="text-[13px] font-bold text-slate-900">Recording history</p>
              <p className="mt-0.5 text-[12px] text-slate-400">
                {history.length === 0
                  ? "No recordings yet"
                  : `${history.length} recording${history.length !== 1 ? "s" : ""} submitted`}
              </p>
            </div>
            {history.length > 0 && (
              <button
                onClick={onRecord}
                className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-[12.5px] font-medium text-slate-600 transition hover:bg-slate-50 active:bg-slate-100 focus:outline-none"
              >
                Record more
              </button>
            )}
          </div>

          {history.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#467ed3]/[0.07]">
                <Mic className="h-5 w-5 text-[#467ed3]/60" aria-hidden="true" />
              </div>
              <p className="text-[14px] font-semibold text-slate-700">No recordings yet</p>
              <p className="mt-1 text-[13px] text-slate-400">
                Your voice will make a real difference. Start now.
              </p>
              <button
                onClick={onRecord}
                style={{ backgroundColor: "#467ed3" }}
                className="mt-5 rounded-xl px-5 py-2.5 text-[13.5px] font-semibold text-white transition hover:opacity-90 focus:outline-none"
              >
                Start Recording
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-slate-50">
              {history.map((item) => {
                const isRejected = item.status === "rejected";
                const isApproved = item.status === "approved";
                const dotColor   = isApproved ? "bg-emerald-400" : isRejected ? "bg-red-400" : "bg-amber-400";
                const statusText = isApproved ? "Approved" : isRejected ? "Needs re-record" : "In review";
                const statusColor = isApproved
                  ? "text-emerald-700"
                  : isRejected
                    ? "text-red-600"
                    : "text-amber-700";
                return (
                  <li key={item.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] leading-snug text-slate-800">{item.sentenceText}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className={`flex items-center gap-1.5 text-[12px] font-medium ${statusColor}`}>
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColor}`} aria-hidden="true" />
                            {statusText}
                          </span>
                          <span className="text-[12px] text-slate-400">
                            {new Date(item.createdAt).toLocaleDateString("en-GB", {
                              day: "numeric", month: "short", year: "numeric",
                            })}
                          </span>
                          {item.durationSeconds != null && (
                            <span className="text-[12px] text-slate-400">{item.durationSeconds.toFixed(1)}s</span>
                          )}
                        </div>
                      </div>
                      {isRejected && (
                        <button
                          onClick={onRecord}
                          className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50 focus:outline-none"
                        >
                          Re-record
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="pb-2" />
      </div>
    </div>
  );
}

// ── Settings helpers (module-level to avoid React re-render anti-pattern) ───

const SPRING = "cubic-bezier(0.16, 1, 0.3, 1)";

function SettingsToggle({
  id,
  checked,
  onChange,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        backgroundColor: checked ? "#4B82DF" : "#C8CDD6",
        transitionProperty: "background-color",
        transitionDuration: "220ms",
        transitionTimingFunction: SPRING,
      }}
      className="relative inline-flex h-[22px] w-[40px] shrink-0 cursor-pointer rounded-full border-2 border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-[#467ed3]/40 focus-visible:ring-offset-2"
    >
      <span
        style={{
          transform: checked ? "translateX(18px)" : "translateX(0)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.18), 0 0 1px rgba(0,0,0,0.08)",
          transitionProperty: "transform",
          transitionDuration: "220ms",
          transitionTimingFunction: SPRING,
        }}
        className="pointer-events-none inline-block h-[18px] w-[18px] rounded-full bg-white"
      />
    </button>
  );
}

function SettingsToggleRow({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-5">
      <div className="min-w-0 pt-px">
        <label htmlFor={id} className="cursor-pointer text-[14px] font-semibold text-slate-800 leading-snug">{label}</label>
        <p className="mt-0.5 text-[13px] leading-snug text-slate-500">{description}</p>
      </div>
      <div className="mt-0.5 shrink-0">
        <SettingsToggle id={id} checked={checked} onChange={onChange} />
      </div>
    </div>
  );
}

// ── Settings Page ────────────────────────────────────────────────

function SettingsPage({
  user,
  onSignOut,
  onBack,
  onProfile,
}: {
  user: RegisteredUser;
  onSignOut: () => void;
  onBack: () => void;
  onProfile?: () => void;
}) {
  const [emailNotif, setEmailNotif]     = useState(true);
  const [reviewNotif, setReviewNotif]   = useState(true);
  const [newPackNotif, setNewPackNotif] = useState(false);
  const [dataConsent, setDataConsent]   = useState(user.consent);

  return (
    <div className="min-h-screen bg-[#F8F9FB]">
      {/* Page header */}
      <div className="border-b border-slate-100 bg-white px-5 py-8">
        <div className="mx-auto max-w-xl">
          <button
            onClick={onBack}
            className="mb-5 flex items-center gap-1.5 text-[13px] font-medium text-slate-400 transition-colors hover:text-slate-700 focus:outline-none"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back
          </button>
          <p className="text-[11px] font-black uppercase tracking-widest text-[#467ed3]">Preferences</p>
          <h1 className="mt-2 text-2xl font-black text-slate-950">Settings</h1>
          <p className="mt-1 text-[15px] text-slate-500">Manage how Rajo AI works for you.</p>
        </div>
      </div>

      <div className="mx-auto max-w-xl space-y-3 px-5 py-8">

        {/* Language & Dialect */}
        <div className="rounded-2xl border border-slate-100 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
          <div className="px-5 pt-5 pb-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Language & Dialect</p>
          </div>
          <div className="px-5 pb-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-slate-800">Recording dialect</p>
                <p className="mt-0.5 text-[13px] text-slate-500">
                  {user.dialect}{user.country ? ` · ${user.country}` : ""}
                </p>
              </div>
              {onProfile && (
                <button
                  onClick={onProfile}
                  className="shrink-0 rounded-lg border border-[#467ed3]/30 px-3 py-1.5 text-[12px] font-semibold text-[#467ed3] transition hover:bg-[#467ed3]/5 focus:outline-none"
                >
                  Edit
                </button>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-slate-800">Interface language</p>
                <p className="mt-0.5 text-[13px] text-slate-500">Use the language selector in the top navigation bar.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="rounded-2xl border border-slate-100 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
          <div className="px-5 pt-5 pb-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Notifications</p>
          </div>
          <div className="px-5 pb-5 space-y-5">
            <SettingsToggleRow
              id="email-updates"
              label="Contribution updates"
              description="Get notified when your recordings are approved or flagged."
              checked={emailNotif}
              onChange={setEmailNotif}
            />
            <SettingsToggleRow
              id="review-notif"
              label="Review notifications"
              description="Know when our team reviews a batch of your contributions."
              checked={reviewNotif}
              onChange={setReviewNotif}
            />
            <SettingsToggleRow
              id="new-pack-notif"
              label="New recording packs"
              description="Be the first to know when new sentence packs are added for your dialect."
              checked={newPackNotif}
              onChange={setNewPackNotif}
            />
          </div>
        </div>

        {/* Privacy & Consent */}
        <div className="rounded-2xl border border-slate-100 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
          <div className="px-5 pt-5 pb-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Privacy & Consent</p>
          </div>
          <div className="px-5 pb-5 space-y-4">
            <SettingsToggleRow
              id="voice-consent"
              label="Voice data consent"
              description="Allow your recordings to be used for training ethical, community-owned Somali AI models."
              checked={dataConsent}
              onChange={setDataConsent}
            />
            <div className="rounded-xl bg-slate-50 px-4 py-3.5">
              <p className="text-[13px] leading-relaxed text-slate-500">
                Your voice data is stored securely and used only to build Somali AI that benefits the community. We never sell or misuse your data.
              </p>
              <a
                href="/about"
                className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-[#467ed3] hover:underline"
              >
                Read privacy details →
              </a>
            </div>
          </div>
        </div>

        {/* Account */}
        <div className="rounded-2xl border border-slate-100 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
          <div className="px-5 pt-5 pb-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Account</p>
          </div>
          <div className="px-5 pb-5 space-y-1">
            {/* Signed-in email */}
            <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200">
                <User className="h-4 w-4 text-slate-500" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Signed in as</p>
                <p className="truncate text-[14px] font-semibold text-slate-800">{user.email}</p>
              </div>
            </div>
            {/* Profile link */}
            {onProfile && (
              <button
                onClick={onProfile}
                className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-[14px] font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none"
              >
                <div className="flex items-center gap-3">
                  <User className="h-4 w-4 text-slate-400" />
                  <span>View &amp; edit profile</span>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-300" />
              </button>
            )}
            {/* Sign out */}
            <button
              onClick={onSignOut}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-[14px] font-semibold text-red-500 transition hover:bg-red-50 active:bg-red-100 focus:outline-none"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign out of Rajo AI</span>
            </button>
          </div>
        </div>

        <p className="pb-2 text-center text-[12px] text-slate-400">
          Questions?{" "}
          <a href="mailto:hello@rajoai.com" className="font-semibold text-[#467ed3] hover:underline">
            hello@rajoai.com
          </a>
        </p>
      </div>
    </div>
  );
}

// ── Shared form helpers ──────────────────────────────────────────

function TextField({
  label,
  onChange,
  placeholder,
  required,
  type = "text",
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
  value: string;
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <input className="field" placeholder={placeholder} required={required} type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SelectField({
  label,
  onChange,
  options,
  placeholder,
  required = true,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  required?: boolean;
  value: string;
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <select className="field" required={required} value={value} onChange={(event) => onChange(event.target.value)}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="field-label">{label}</span>
      <div className="min-h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base font-semibold text-slate-700">
        {value}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const { t } = useLanguage();
  const display = status === "pending_review" ? "pending" : status;
  const color =
    display === "approved"
      ? "bg-emerald-50 text-emerald-700"
      : display === "rejected"
        ? "bg-red-50 text-red-700"
        : "bg-amber-50 text-amber-700";

  return <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${color}`}>{t(`status.${display}`)}</span>;
}

function LoadingScreen() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[calc(100vh-68px)] items-center justify-center bg-white px-6"
    >
      <span className="sr-only">Loading Rajo AI</span>
      <div className="rajo-loader-logo-wrap">
        <img
          alt="Rajo AI"
          className="h-16 w-auto object-contain sm:h-[76px]"
          src="/logo%20rajo%20ai.png"
        />
      </div>
    </div>
  );
}

function CenteredMessage({ text }: { text: string }) {
  return <div className="flex min-h-[50vh] items-center justify-center px-5 text-center text-lg font-bold text-slate-600">{text}</div>;
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

function getSupportedAudioMimeType(): string | undefined {
  if (typeof MediaRecorder.isTypeSupported !== "function") return undefined;

  const supportedTypes = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/aac",
  ];

  return supportedTypes.find((type) => MediaRecorder.isTypeSupported(type));
}

function getMicrophoneErrorMessage(err: unknown): string {
  if (!(err instanceof DOMException) && !(err instanceof Error)) {
    return "Microphone access failed. Please try again.";
  }

  if (err.name === "NotAllowedError" || err.name === "SecurityError") {
    return "Microphone access was blocked. Tap Start Recording again and allow microphone access in Safari.";
  }

  if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
    return "No microphone was found on this device.";
  }

  if (err.name === "NotReadableError" || err.name === "AbortError") {
    return "Safari could not start the microphone. Close other apps using the microphone and try again.";
  }

  return err.message || "Microphone access failed. Please try again.";
}

function getInitialView(): View {
  const p = window.location.pathname;
  if (p === "/about")         return "about";
  if (p === "/record")        return "record";
  if (p === "/signin")        return "auth";
  if (p === "/profile")       return "profile";
  if (p === "/contributions") return "contributions";
  if (p === "/settings")      return "settings";
  return "home";
}

function calculateStreak(history: RecordingHistoryItem[]): number {
  if (history.length === 0) return 0;

  const makeKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const dateKeys = new Set(history.map((item) => makeKey(new Date(item.createdAt))));

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (!dateKeys.has(makeKey(today)) && !dateKeys.has(makeKey(yesterday))) return 0;

  const start = dateKeys.has(makeKey(today)) ? today : yesterday;
  let streak = 0;

  for (let i = 0; i < 365; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() - i);
    if (dateKeys.has(makeKey(d))) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

function countTodayRecordings(history: RecordingHistoryItem[]): number {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  return history.filter((item) => {
    const d = new Date(item.createdAt);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` === todayKey;
  }).length;
}

function getContributorRank(total: number, t?: (key: string) => string): string {
  if (total >= 51) return t ? t("rank.leader") : "Voice Leader";
  if (total >= 31) return t ? t("rank.champion") : "Voice Champion";
  if (total >= 16) return t ? t("rank.pioneer") : "Voice Pioneer";
  if (total >= 6) return t ? t("rank.builder") : "Voice Builder";
  if (total >= 1) return t ? t("rank.starter") : "Voice Starter";
  return t ? t("rank.new") : "New Voice";
}

function translatePackTitle(title: string, t: (key: string) => string): string {
  const normalized = title.trim().toLowerCase();
  if (normalized === "everyday somali") return t("pack.everydaySomali");
  if (normalized === "starter somali" || normalized === "starter") return t("pack.starter");
  if (normalized === "somali culture" || normalized === "culture") return t("pack.culture");
  if (normalized === "speech practice" || normalized === "speech") return t("pack.speech");
  return title;
}


export default App;


