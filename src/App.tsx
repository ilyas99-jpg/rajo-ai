import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Award, CheckCircle2, Flame, Mic, Star, Trophy, XCircle } from "lucide-react";
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
  uploadAndSaveRecording,
} from "./lib/supabaseService";
import type { PublicStats } from "./lib/supabaseService";
import type { AgeRange, PromptPack, RecordingHistoryItem, RecordingMetadata, RegisteredUser, RegistrationFormData, VoicePrompt } from "./types";
import { createRegisteredUser } from "./utils/submissions";

type View = "home" | "about" | "auth" | "dashboard" | "record";
type AuthMode = "register" | "login";
type RecorderState = "idle" | "starting" | "recording" | "recorded";

const DIALECT_OPTIONS = [
  "Maxaa tiri",
  "Maay Maay",
  "Banaadiri",
  "Northern Somali",
  "Reer Xamar / Benadiri",
  "Other",
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
  const [view, setView] = useState<View>(() => getInitialView());
  const [authMode, setAuthMode] = useState<AuthMode>("register");
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<RegisteredUser | null>(null);
  const [donorId, setDonorId] = useState<string | null>(null);
  const [history, setHistory] = useState<RecordingHistoryItem[]>([]);
  const [completedPromptIds, setCompletedPromptIds] = useState<string[]>([]);
  const [promptPacks, setPromptPacks] = useState<PromptPack[]>([]);
  const [prompts, setPrompts] = useState<VoicePrompt[]>([]);
  const [promptLoading, setPromptLoading] = useState(false);
  const [unlockNotice, setUnlockNotice] = useState("");
  const [formData, setFormData] = useState(initialFormData);
  const postAuthRef = useRef<View>("dashboard");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

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
          setDonorId(profile.donorId);
          setLoginEmail(profile.user.email);
          await loadProgress(profile.donorId, profile.user.authUserId);
          if (startingPath === "/record") setView("record");
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

  function navigate(nextView: View, path: string) {
    window.history.pushState({}, "", path);
    setView(nextView);
  }

  async function loadProgress(id: string, authUserId?: string) {
    setPromptLoading(true);
    try {
      const progress = await fetchDonorProgress(id);
      setHistory(progress.history);
      setCompletedPromptIds(progress.completedSentenceIds);

      const promptAuthId = authUserId ?? user?.authUserId;
      if (promptAuthId) {
        const workspace = await fetchPromptWorkspace(promptAuthId, progress.completedSentenceIds);
        setPromptPacks(workspace.packs);
        setPrompts(workspace.prompts);
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
      setDonorId(profile.donorId);
      setFormData(initialFormData);
      setLoginEmail(profile.user.email);
      setLoginPassword("");
      await loadProgress(profile.donorId, profile.user.authUserId);
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
      setDonorId(profile.donorId);
      setLoginPassword("");
      await loadProgress(profile.donorId, profile.user.authUserId);
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
    setDonorId(null);
    setHistory([]);
    setCompletedPromptIds([]);
    setPromptPacks([]);
    setPrompts([]);
    setUnlockNotice("");
    navigate("home", "/");
  }

  async function handleSubmitRecording(prompt: VoicePrompt, blob: Blob, metadata: RecordingMetadata) {
    if (!user || !donorId) throw new Error("Please sign in before submitting a recording.");

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

    const unlock = await completePromptPackIfReady(user.authUserId, donorId, prompt.packId);
    if (unlock?.unlocked) {
      setUnlockNotice(
        `New prompts unlocked|You completed your first contribution set. ${unlock.packTitle} is now available.`,
      );
    }

    const workspace = await fetchPromptWorkspace(user.authUserId, nextCompleted);
    setPromptPacks(workspace.packs);
    setPrompts(workspace.prompts);
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

  return (
    <div className="min-h-screen bg-white text-slate-950">
      <TopBar
        activeView={view}
        isSignedIn={Boolean(user)}
        onAbout={() => navigate("about", "/about")}
        onContribute={() => startFromHome("register", "record")}
        onDashboard={() => navigate(user ? "dashboard" : "home", "/")}
        onHome={() => navigate("home", "/")}
        onLogout={handleLogout}
        onSignIn={() => startFromHome("login")}
      />

      <main>
        {authLoading ? (
          <CenteredMessage text="Loading Rajo AI..." />
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
            prompts={prompts}
            user={user}
            onBack={() => navigate("dashboard", "/")}
            onSubmitRecording={handleSubmitRecording}
          />
        ) : (
          <HomePage onAbout={() => navigate("about", "/about")} onStart={() => startFromHome("register", "record")} />
        )}
      </main>
    </div>
  );
}

function TopBar({
  activeView,
  isSignedIn,
  onAbout,
  onContribute,
  onDashboard,
  onHome,
  onLogout,
  onSignIn,
}: {
  activeView: View;
  isSignedIn: boolean;
  onAbout: () => void;
  onContribute: () => void;
  onDashboard: () => void;
  onHome: () => void;
  onLogout: () => void;
  onSignIn: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <button className="flex items-center" onClick={onDashboard}>
          <img alt="Rajo AI" className="h-10 w-auto object-contain" src="/logo%20rajo%20ai.png" />
        </button>
        <nav className="flex items-center gap-1 sm:gap-2">
          {activeView !== "home" && activeView !== "dashboard" && (
            <button className="btn-ghost text-sm" onClick={onHome}>
              Home
            </button>
          )}
          <button
            className={`btn-ghost text-sm ${activeView === "about" ? "bg-blue-50 text-rajo-primary" : ""}`}
            onClick={onAbout}
          >
            About
          </button>
          {isSignedIn ? (
            <button className="btn-ghost text-sm" onClick={onLogout}>
              Sign Out
            </button>
          ) : (
            <button className="btn-ghost text-sm" onClick={onSignIn}>
              Sign In
            </button>
          )}
          <button className="btn-primary ml-1 whitespace-nowrap text-sm" onClick={onContribute}>
            Contribute Voice
          </button>
        </nav>
      </div>
    </header>
  );
}

function AboutPage({ onStart }: { onStart: () => void }) {
  return (
    <div className="bg-white">

      {/* SECTION 1: HERO */}
      <section className="border-b border-slate-100 bg-white px-5 py-20 sm:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[11px] font-black uppercase tracking-widest text-[#467ED3]">About Rajo AI</p>
          <h1 className="mt-5 text-4xl font-black leading-tight text-slate-950 sm:text-6xl">
            Building ethical Somali voice technology with real Somali voices.
          </h1>
          <p className="mt-6 text-lg leading-8 text-slate-500">
            Codkeenna maanta wuxuu dhisayaa mustaqbalka Af-Soomaaliga.
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
          <p className="text-[11px] font-black uppercase tracking-widest text-[#467ED3]">Our mission</p>
          <h2 className="mt-4 text-3xl font-black text-slate-950 sm:text-4xl">
            Language should not be a barrier to technology.
          </h2>
          <p className="mt-6 text-lg leading-9 text-slate-600">
            Rajo AI collects high-quality Somali voice data with consent, respect, and transparency so future AI systems can understand and speak Somali more naturally.
          </p>
        </div>
      </section>

      {/* SECTION 4: WHY IT MATTERS */}
      <section className="bg-[#F7FAFF] px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <p className="text-[11px] font-black uppercase tracking-widest text-[#467ED3]">Why it matters</p>
          <h2 className="mt-4 text-3xl font-black text-slate-950 sm:text-4xl">Somali deserves a seat in the AI future.</h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-3">
            <article className="rounded-2xl border border-slate-100 bg-white p-7">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#467ED3]/10">
                <svg aria-hidden="true" className="h-5 w-5 text-[#467ED3]" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a9 9 0 0 1 18 0M3 9v5a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2V9m10 0v5a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2V9" />
                </svg>
              </div>
              <h3 className="mt-5 font-black text-slate-950">Underrepresented language</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">Somali is spoken by over 20 million people, yet it remains one of the least supported languages in modern speech AI.</p>
            </article>
            <article className="rounded-2xl border border-slate-100 bg-white p-7">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#467ED3]/10">
                <svg aria-hidden="true" className="h-5 w-5 text-[#467ED3]" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.5a4 4 0 0 0 4-4v-7a4 4 0 1 0-8 0v7a4 4 0 0 0 4 4Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 11.5v3a7 7 0 0 0 14 0v-3M12 21v-2.5" />
                </svg>
              </div>
              <h3 className="mt-5 font-black text-slate-950">Real accents and dialects</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">AI needs to hear Somali the way Somalis actually speak it with regional accents, natural rhythm, and real dialects.</p>
            </article>
            <article className="rounded-2xl border border-slate-100 bg-white p-7">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#467ED3]/10">
                <svg aria-hidden="true" className="h-5 w-5 text-[#467ED3]" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
                </svg>
              </div>
              <h3 className="mt-5 font-black text-slate-950">Our language, our future</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">If we don't build this now, Somali risks being left behind as the world moves deeper into voice-driven technology.</p>
            </article>
          </div>
        </div>
      </section>

      {/* SECTION 5: PRIVACY & ETHICS */}
      <section className="bg-white px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <p className="text-[11px] font-black uppercase tracking-widest text-[#467ED3]">Privacy & ethics</p>
          <h2 className="mt-4 text-3xl font-black text-slate-950 sm:text-4xl">Built with care and respect.</h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-3">
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-[#F7FAFF] p-7">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#467ED3]/10">
                <svg aria-hidden="true" className="h-5 w-5 text-[#467ED3]" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                </svg>
              </div>
              <div>
                <h3 className="font-black text-slate-950">Consent-based contribution</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">Every recording begins with clear, explicit consent from the contributor. You are always in control.</p>
              </div>
            </div>
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-[#F7FAFF] p-7">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#467ED3]/10">
                <svg aria-hidden="true" className="h-5 w-5 text-[#467ED3]" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
              </div>
              <div>
                <h3 className="font-black text-slate-950">Private audio storage</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">All recordings are stored in a secure, private bucket never publicly accessible without authorization.</p>
              </div>
            </div>
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-[#F7FAFF] p-7">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#467ED3]/10">
                <svg aria-hidden="true" className="h-5 w-5 text-[#467ED3]" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                </svg>
              </div>
              <div>
                <h3 className="font-black text-slate-950">Admin-reviewed submissions</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">Every recording is manually reviewed before it enters the dataset — quality and care at every step.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 6: CONTACT */}
      <section className="border-t border-slate-100 bg-white px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[11px] font-black uppercase tracking-widest text-[#467ED3]">Get in touch</p>
          <h2 className="mt-4 text-3xl font-black text-slate-950 sm:text-4xl">Questions or partnerships?</h2>
          <p className="mt-4 text-slate-500">We'd love to hear from researchers, community organizations, and anyone who wants to help Somali voice technology grow.</p>
          <a
            className="mt-8 inline-block rounded-xl bg-[#467ED3] px-8 py-3.5 text-base font-black text-white shadow-sm transition hover:bg-[#3a6ec0]"
            href="mailto:hello@rajoai.com"
          >
            hello@rajoai.com
          </a>
          <div className="mt-14 border-t border-slate-100 pt-10">
            <button className="btn-primary px-8 py-3 text-base" onClick={onStart}>
              Contribute your voice →
            </button>
            <p className="mt-4 text-sm italic text-[#467ED3]">
              Ku deeq codkaaga si aad uga qayb qaadato horumarinta luuqadda Soomaaliga.
            </p>
          </div>
        </div>
      </section>

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
      <CtaSection onStart={onStart} />
      <SiteFooter />
    </div>
  );
}

function HeroSection({ onAbout, onStart }: { onAbout: () => void; onStart: () => void }) {
  return (
    <section className="bg-white px-5 py-16 sm:py-20 lg:py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2 lg:gap-16">

        {/* Left — text */}
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#467ED3]">
            Built for Somali voices
          </p>
          <h1 className="mt-5 text-[2.4rem] font-black leading-[1.06] tracking-tight text-slate-950 sm:text-5xl">
           Preserve Somali voices for the future
          </h1>
          <p className="mt-5 max-w-md text-lg leading-8 text-slate-500">
            Record a few Somali sentences and help build speech technology that understands Somali accents and dialects
          </p>
           <p  className="mt-10  text-sm italic text-slate-400">Your contributions will be used to train AI models that better understand and generate Somali speech.</p>
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
              src="/somalia-coast.jpg"
              style={{ filter: "saturate(0.82) brightness(0.97)", objectPosition: "center 42%" }}
            />
          </div>
          <figcaption className="mt-2.5 text-right text-xs text-slate-400">
            Murcanyo, Bari, Somalia. 
            Photo: Marwan Somali
          </figcaption>
        </figure>

      </div>
    </section>
  );
}

function HowItWorksSection() {
  return (
    <section className="bg-white px-5 py-16 sm:py-20">
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
  return (
    <footer className="bg-slate-950 px-5 py-12 text-center">
      <img
        alt="Rajo AI"
        className="mx-auto h-10 w-auto object-contain opacity-90"
        src="/logo%20rajo%20ai.png"
      />
      <p className="mt-5 text-sm font-semibold text-slate-400">Questions or partnerships?</p>
      <a
        className="mt-1 block text-sm font-black text-blue-400 hover:text-blue-300"
        href="mailto:hello@rajoai.com"
      >
        hello@rajoai.com
      </a>
      <p className="mt-8 text-xs text-slate-600">Built for Somali voices, with respect and consent.</p>
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
    <section className="border-y border-slate-100 bg-[#F7FAFF] px-5 py-12">
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
                    dialectOther: event.target.value === "Other" ? formData.dialectOther : "",
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
            {formData.dialect === "Other" && (
              <TextField
                label="Other dialect"
                placeholder="Type your dialect"
                required
                value={formData.dialectOther}
                onChange={(value) => onFormChange({ ...formData, dialectOther: value })}
              />
            )}
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
  prompts,
  stats,
  user,
  onRecord,
}: {
  completedPromptIds: string[];
  history: RecordingHistoryItem[];
  promptLoading: boolean;
  promptPacks: PromptPack[];
  prompts: VoicePrompt[];
  stats: { total: number; minutes: number; approved: number; pending: number };
  user: RegisteredUser;
  onRecord: () => void;
}) {
  const [publicStats, setPublicStats] = useState<PublicStats | null>(null);

  useEffect(() => {
    fetchPublicStats().then(setPublicStats).catch(() => {});
  }, []);

  const streak = useMemo(() => calculateStreak(history), [history]);
  const todayCount = useMemo(() => countTodayRecordings(history), [history]);
  const currentPack = promptPacks.find((pack) => !pack.completedAt) ?? promptPacks[promptPacks.length - 1];
  const totalPrompts = currentPack?.promptCount ?? 0;
  const completedCount = Math.min(currentPack?.completedPromptCount ?? 0, totalPrompts);
  const remainingPrompts = Math.max(totalPrompts - completedCount, 0);
  const unlockedCount = promptPacks.length;
  const progressPct = totalPrompts > 0 ? Math.min(Math.round((completedCount / totalPrompts) * 100), 100) : 0;
  const rank = getContributorRank(stats.total);
  const DAILY_GOAL = 5;

  const milestones = [
    { icon: <Mic className="h-3.5 w-3.5" />, label: "First Recording", unlocked: stats.total >= 1 },
    { icon: <Flame className="h-3.5 w-3.5" />, label: "3-Day Streak", unlocked: streak >= 3 },
    { icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: "First Approval", unlocked: stats.approved >= 1 },
    { icon: <Star className="h-3.5 w-3.5" />, label: "10 Recordings", unlocked: stats.total >= 10 },
    { icon: <Trophy className="h-3.5 w-3.5" />, label: "25 Recordings", unlocked: stats.total >= 25 },
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
            <p className="text-[11px] font-black uppercase tracking-widest opacity-60">Contributor Dashboard</p>
            <h1 className="mt-3 text-2xl font-black leading-snug sm:text-[1.75rem]">
              {firstName(user.fullName)}, your voice matters.
            </h1>
            <p className="mt-3 text-sm leading-[1.75] opacity-75">
              Every recording you submit helps future AI systems understand Somali voices, accents, and dialects.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm font-semibold opacity-70">
              {streak > 0 && (
                <span className="flex items-center gap-1.5">
                  <Flame className="h-3.5 w-3.5" /> {streak}-day streak
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
              Continue Recording →
            </button>
          </div>
        </div>

        {/* Progress */}
        <div className="rounded-3xl bg-white p-6 shadow-sm">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest text-[#467ED3]">Current Pack Progress</p>
              <p className="mt-1.5 text-xl font-black text-slate-950">
                {promptLoading ? "Loading prompt set..." : `${completedCount} of ${totalPrompts} prompts completed`}
              </p>
              {currentPack && (
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  Current set: {currentPack.title} · {unlockedCount} unlocked
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
            {completedCount === 0
              ? "Record your first prompt to begin contributing to the Somali voice dataset."
              : completedCount < totalPrompts
                ? `${remainingPrompts} prompts remaining in this pack — each one adds to a language dataset that will last for generations.`
                : "This prompt pack is complete. New prompts will appear when the next set unlocks."}
          </p>
        </div>

        {/* Total Contributions */}
        <div className="space-y-3">
          <p className="px-1 text-[11px] font-black uppercase tracking-widest text-[#467ED3]">Total Contributions</p>
          {/* Primary — what matters most */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="text-4xl font-black tracking-tight text-slate-950">{stats.total}</p>
              <p className="mt-1.5 text-sm text-slate-500">Recordings submitted</p>
            </div>
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="text-4xl font-black tracking-tight text-slate-950">{stats.minutes.toFixed(1)}</p>
              <p className="mt-1.5 text-sm text-slate-500">Minutes of voice donated</p>
            </div>
          </div>
          {/* Secondary — supporting context */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white px-5 py-4 shadow-sm">
              <p className="text-lg font-black text-slate-700">{stats.approved}</p>
              <p className="mt-0.5 text-xs text-slate-400">Recordings approved</p>
            </div>
            <div className="rounded-2xl bg-white px-5 py-4 shadow-sm">
              <p className="text-lg font-black text-slate-700">{streak > 0 ? `${streak}-day` : "—"}</p>
              <p className="mt-0.5 text-xs text-slate-400">Current streak</p>
            </div>
          </div>
        </div>

        {/* Today + Recent activity */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-3xl bg-white p-6 shadow-sm">
            <p className="text-[11px] font-black uppercase tracking-widest text-[#467ED3]">Today</p>
            <p className="mt-2 text-xl font-black text-slate-950">
              {todayCount === 0
                ? "No recordings yet."
                : todayCount >= DAILY_GOAL
                  ? "Daily goal reached."
                  : `${todayCount} of ${DAILY_GOAL} recorded.`}
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-[#467ED3] transition-all duration-700"
                style={{ width: `${Math.min((todayCount / DAILY_GOAL) * 100, 100)}%` }}
              />
            </div>
            <p className="mt-2.5 text-xs text-slate-400">
              {todayCount >= DAILY_GOAL
                ? "Excellent — you've reached today's goal."
                : `${DAILY_GOAL - todayCount} more to reach today's goal of ${DAILY_GOAL}.`}
            </p>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-sm">
            <p className="text-[11px] font-black uppercase tracking-widest text-[#467ED3]">Recent Activity</p>
            {history.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No recordings yet. Start your first prompt.</p>
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
                      ? "Approved"
                      : item.status === "rejected"
                        ? "Needs re-recording"
                        : "Submitted";
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
          <p className="text-[11px] font-black uppercase tracking-widest text-[#467ED3]">Milestones</p>
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
          <p className="text-[11px] font-black uppercase tracking-widest text-[#467ED3]">The Bigger Picture</p>
          <div className="mt-3 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-sm">
              <p className="text-lg font-black leading-snug text-slate-950">
                You are contributing to one of the first large-scale Somali voice datasets.
              </p>
              <p className="mt-2.5 text-sm leading-6 text-slate-500">
                Together, contributors from around the world are building the foundation for AI that truly understands Somali — its voices, accents, and dialects.
              </p>
            </div>
            <div className="shrink-0 sm:text-right">
              <p className="text-4xl font-black tabular-nums text-[#467ED3] sm:text-5xl">
                {communityTotal.toLocaleString()}
              </p>
              <p className="mt-1 text-[11px] font-black uppercase tracking-wider text-slate-400">
                community recordings
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
            <span>{communityPct}% toward goal</span>
            <span>Goal: {DATASET_GOAL.toLocaleString()} recordings</span>
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
  prompts,
  user,
  onBack,
  onSubmitRecording,
}: {
  completedPromptIds: string[];
  history: RecordingHistoryItem[];
  unlockNotice: string;
  onDismissUnlock: () => void;
  prompts: VoicePrompt[];
  user: RegisteredUser;
  onBack: () => void;
  onSubmitRecording: (prompt: VoicePrompt, blob: Blob, metadata: RecordingMetadata) => Promise<void>;
}) {
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

    try {
      await onSubmitRecording(prompt, audioBlob, {
        ageRange: user.ageRange,
        country: user.country,
        city: user.city,
        deviceType: metadata.deviceType,
        backgroundNoise: metadata.backgroundNoise,
        speakingSpeed: metadata.speakingSpeed,
        consent: true,
      });
      resetRecording();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit recording.");
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

  if (!prompt) return <CenteredMessage text="No prompts are available yet." />;

  return (
    <section className="mx-auto max-w-4xl px-5 py-8">
      <button className="btn-ghost mb-5" onClick={onBack}>Back to Dashboard</button>
      <div className="app-card overflow-hidden">
        <div className="border-b border-slate-200 bg-blue-50 px-5 py-4 sm:px-7">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-bold text-blue-700">Prompt {promptIndex + 1} of {prompts.length}</p>
            <p className="text-sm font-semibold text-slate-600">{user.fullName}</p>
          </div>
        </div>

        <div className="p-5 sm:p-8">
          {unlockNotice && (
            <div className="mb-6 rounded-3xl border border-blue-100 bg-blue-50 p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-lg font-black text-[#467ED3]">{unlockTitle}</p>
                  <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">{unlockBody}</p>
                </div>
                <button className="btn-secondary min-h-10 rounded-xl px-4 py-2 text-xs" onClick={onDismissUnlock}>
                  Continue
                </button>
              </div>
            </div>
          )}
          <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <p className="text-sm font-bold uppercase tracking-wide text-slate-500">Read this Somali prompt</p>
            <p className="mt-2 text-xs font-black uppercase tracking-widest text-[#467ED3]">{prompt.packTitle}</p>
            <h1 className="mt-5 text-3xl font-black leading-tight text-slate-950 sm:text-5xl">{prompt.sentenceText}</h1>
            {completed && (
              <p className="mt-5 rounded-full bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700">
                Already completed. Submit again only if you want to re-record this prompt.
              </p>
            )}
          </div>

          {recorderState === "starting" && (
            <div className="mt-6 rounded-3xl border border-blue-100 bg-blue-50 p-5 text-center">
              <p className="text-lg font-black text-blue-700">Starting microphone...</p>
            </div>
          )}

          {recorderState === "recording" && (
            <div className="mt-6 rounded-3xl border border-red-100 bg-red-50 p-5 text-center">
              <p className="text-lg font-black text-red-700">Recording...</p>
            </div>
          )}

          {audioUrl && (
            <div className="mt-6 rounded-3xl border border-blue-100 bg-blue-50 p-4">
              <audio ref={audioRef} className="w-full" controls src={audioUrl} />
              <p className="mt-2 text-sm font-semibold text-blue-700">Duration: {duration.toFixed(1)} seconds</p>
            </div>
          )}

          <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-black text-slate-950">Recording details</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <SelectField label="Device Type" value={metadata.deviceType} onChange={(value) => setMetadata({ ...metadata, deviceType: value })} options={["Phone", "Laptop", "External Microphone"]} />
              <SelectField label="Background Noise" value={metadata.backgroundNoise} onChange={(value) => setMetadata({ ...metadata, backgroundNoise: value })} options={["Quiet", "Medium", "Noisy"]} />
              <SelectField label="Speaking Speed" value={metadata.speakingSpeed} onChange={(value) => setMetadata({ ...metadata, speakingSpeed: value })} options={["Slow", "Normal", "Fast"]} />
            </div>
          </div>

          <div className="mt-7 flex flex-wrap gap-3">
            {recorderState === "idle" && (
              <>
                <button className="btn-primary" type="button" onClick={() => void startRecording()}>Start Recording</button>
                <button className="btn-secondary" onClick={skipPrompt}>Skip Prompt</button>
              </>
            )}
            {recorderState === "recording" && (
              <button className="btn-danger" onClick={stopRecording}>Stop Recording</button>
            )}
            {recorderState === "recorded" && (
              <>
                <button className="btn-secondary" onClick={() => audioRef.current?.play()}>Play Recording</button>
                <button className="btn-secondary" onClick={resetRecording}>Re-record</button>
                <button className="btn-primary" disabled={busy} onClick={submitRecording}>{busy ? "Submitting..." : "Submit Recording"}</button>
              </>
            )}
          </div>

          {error && <p className="mt-5 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}

          <div className="mt-8">
            <h2 className="text-lg font-black text-slate-950">Recent recordings</h2>
            <div className="mt-3 space-y-3">
              {history.slice(0, 4).map((item) => (
                <div className="flex items-center justify-between rounded-2xl border border-slate-200 p-3" key={item.id}>
                  <p className="line-clamp-1 text-sm font-semibold text-slate-700">{item.sentenceText}</p>
                  <StatusPill status={item.status} />
                </div>
              ))}
              {history.length === 0 && <p className="text-sm text-slate-500">No recordings yet.</p>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

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
  const display = status === "pending_review" ? "pending" : status;
  const color =
    display === "approved"
      ? "bg-emerald-50 text-emerald-700"
      : display === "rejected"
        ? "bg-red-50 text-red-700"
        : "bg-amber-50 text-amber-700";

  return <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${color}`}>{display}</span>;
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
  if (window.location.pathname === "/about") return "about";
  if (window.location.pathname === "/record") return "record";
  if (window.location.pathname === "/signin") return "auth";
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

function getContributorRank(total: number): string {
  if (total >= 51) return "Voice Leader";
  if (total >= 31) return "Voice Champion";
  if (total >= 16) return "Voice Pioneer";
  if (total >= 6) return "Voice Builder";
  if (total >= 1) return "Voice Starter";
  return "New Voice";
}


export default App;


