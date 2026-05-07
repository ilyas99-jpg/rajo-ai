import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { AdminDashboard } from "./admin/AdminDashboard";
import { BrandWaveform } from "./components/Brand";
import { voicePrompts as starterPrompts } from "./data/prompts";
import {
  fetchDonorProgress,
  getCurrentSessionProfile,
  loginWithPassword,
  logoutUser,
  registerAndCreateProfile,
  uploadAndSaveRecording,
} from "./lib/supabaseService";
import type { RecordingHistoryItem, RecordingMetadata, RegisteredUser, RegistrationFormData, VoicePrompt } from "./types";
import { createRegisteredUser } from "./utils/submissions";

type View = "home" | "about" | "auth" | "dashboard" | "record" | "prompts";
type AuthMode = "register" | "login";
type RecorderState = "idle" | "recording" | "recorded";

const PROMPTS_KEY = "rajo-ai-prompts";
const DIALECT_OPTIONS = [
  "Maxaa tiri",
  "Maay Maay",
  "Banaadiri",
  "Northern Somali",
  "Reer Xamar / Benadiri",
  "Other",
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
  age: "18",
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
  const [prompts, setPrompts] = useState<VoicePrompt[]>(loadPrompts);
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
          await loadProgress(profile.donorId);
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
    localStorage.setItem(PROMPTS_KEY, JSON.stringify(prompts));
  }, [prompts]);

  useEffect(() => {
    const onPopState = () => setView(getInitialView());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function navigate(nextView: View, path: string) {
    window.history.pushState({}, "", path);
    setView(nextView);
  }

  async function loadProgress(id: string) {
    const progress = await fetchDonorProgress(id);
    setHistory(progress.history);
    setCompletedPromptIds(progress.completedSentenceIds);
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
      setHistory([]);
      setCompletedPromptIds([]);
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
      await loadProgress(profile.donorId);
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
    setCompletedPromptIds((ids) =>
      ids.includes(prompt.sentenceId) ? ids : [...ids, prompt.sentenceId],
    );
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
        onDashboard={() => navigate(user ? "dashboard" : "home", "/")}
        onHome={() => navigate("home", "/")}
        onLogout={handleLogout}
        onSignIn={() => startFromHome("login")}
      />

      <main>
        {authLoading ? (
          <CenteredMessage text="Loading RAJO AI..." />
        ) : view === "home" ? (
          <HomePage onStart={() => startFromHome("register", "record")} />
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
            prompts={prompts}
            stats={stats}
            user={user}
            onRecord={() => navigate("record", "/record")}
          />
        ) : view === "record" && user ? (
          <RecordingPage
            completedPromptIds={completedPromptIds}
            history={history}
            prompts={prompts}
            user={user}
            onBack={() => navigate("dashboard", "/")}
            onSubmitRecording={handleSubmitRecording}
          />
        ) : view === "prompts" && user ? (
          <PromptManagement prompts={prompts} onBack={() => navigate("dashboard", "/")} onPromptsChange={setPrompts} />
        ) : (
          <HomePage onStart={() => startFromHome("register", "record")} />
        )}
      </main>
    </div>
  );
}

function TopBar({
  activeView,
  isSignedIn,
  onAbout,
  onDashboard,
  onHome,
  onLogout,
  onSignIn,
}: {
  activeView: View;
  isSignedIn: boolean;
  onAbout: () => void;
  onDashboard: () => void;
  onHome: () => void;
  onLogout: () => void;
  onSignIn: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <button className="flex items-center gap-3" onClick={onDashboard}>
          <img alt="RAJO AI" className="h-14 w-auto object-contain" src="/logo%20rajo%20ai.png" />
        </button>
        <nav className="flex items-center gap-1 sm:gap-2">
          {activeView !== "home" && activeView !== "dashboard" && (
            <button className="btn-ghost" onClick={onHome}>Home</button>
          )}
          <button className={`btn-ghost ${activeView === "about" ? "bg-blue-50 text-rajo-primary" : ""}`} onClick={onAbout}>
            About
          </button>
          {isSignedIn ? (
            <button className="btn-ghost" onClick={onLogout}>Sign Out</button>
          ) : (
            <button className="btn-ghost" onClick={onSignIn}>Sign In</button>
          )}
        </nav>
      </div>
    </header>
  );
}

function AboutPage({ onStart }: { onStart: () => void }) {
  return (
    <div>
      {/* ── SECTION 1: HERO ── */}
      <section className="relative overflow-hidden bg-white px-5 py-20 sm:py-28">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-blue-50/70 to-white" />
        {/* Waveform — logo pattern scaled up, low-opacity decorative background */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center" aria-hidden="true">
          <BrandWaveform className="w-full max-w-2xl" opacity={0.07} />
        </div>
        <div className="relative mx-auto max-w-5xl text-center">
          <p className="text-sm font-black uppercase tracking-[0.22em] text-[#467ED3]">ABOUT RAJO AI</p>
          <h1 className="mx-auto mt-6 max-w-4xl text-5xl font-black leading-tight text-slate-950 sm:text-7xl">
            Building the future of Somali voice AI.
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-xl leading-9 text-slate-600">
            An open initiative dedicated to ethical, high-quality Somali speech technology — for everyone.
          </p>
          <p className="mt-5 text-lg italic text-[#467ED3]">
            U hiili luuqadaada hooyo adoo ku deeqaya codkaaga.
          </p>
        </div>
      </section>

      {/* ── SECTION 2: WHY WE EXIST ── */}
      <section className="bg-white px-5 py-14 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-8 text-3xl font-black text-slate-950 sm:text-4xl">Why we exist</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <article className="about-panel transition hover:-translate-y-1 hover:border-blue-100 hover:shadow-lg">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#467ED3]/10">
                <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="#467ED3" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.5a4 4 0 0 0 4-4v-7a4 4 0 1 0-8 0v7a4 4 0 0 0 4 4Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 11.5v3a7 7 0 0 0 14 0v-3M12 21v-2.5" />
                </svg>
              </div>
              <h3 className="mt-5 text-xl font-black text-slate-950">Built for Somali</h3>
              <p className="mt-3 text-base leading-7 text-slate-600">Most AI voices struggle with Somali pronunciation and accent.</p>
            </article>
            <article className="about-panel transition hover:-translate-y-1 hover:border-blue-100 hover:shadow-lg">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#467ED3]/10">
                <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="#467ED3" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a9 9 0 0 1 18 0" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 9v5a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2V9" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 9v5a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2V9" />
                </svg>
              </div>
              <h3 className="mt-5 text-xl font-black text-slate-950">Tools we deserve</h3>
              <p className="mt-3 text-base leading-7 text-slate-600">Voice assistants, audiobooks, and accessibility tools that understand us.</p>
            </article>
            <article className="about-panel transition hover:-translate-y-1 hover:border-blue-100 hover:shadow-lg">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#467ED3]/10">
                <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="#467ED3" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
                </svg>
              </div>
              <h3 className="mt-5 text-xl font-black text-slate-950">Ethics first</h3>
              <p className="mt-3 text-base leading-7 text-slate-600">Data collected with consent, transparency, and respect.</p>
            </article>
          </div>
        </div>
      </section>

      {/* ── SECTION 3: HOW IT WORKS ── */}
      <section className="bg-[#FAFBFD] px-5 py-14 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-8 text-3xl font-black text-slate-950 sm:text-4xl">How it works</h2>
          <div className="space-y-3">
            {[
              "Contributors read short everyday Somali prompts",
              "Recordings are reviewed for quality",
              "Data trains Somali TTS and ASR models",
              "Models released to the Somali community",
            ].map((step, i) => (
              <div className="about-panel flex items-center gap-4 p-5" key={step}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#467ED3] text-sm font-black text-white">
                  {i + 1}
                </span>
                <p className="text-lg font-semibold text-slate-700">{step}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 4: OUR COMMITMENT ── */}
      <section className="bg-white px-5 py-14 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-8 text-3xl font-black text-slate-950 sm:text-4xl">Our commitment</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              ["Consent first", "Every recording begins with clear permission from the contributor."],
              ["Privacy", "Contributor data is handled carefully and used only for the stated mission."],
              ["Community ownership", "Somali speakers should help shape Somali voice technology."],
              ["Diversity", "All dialects, accents, genders, regions, and speaking styles welcome."],
            ].map(([title, text]) => (
              <article className="about-panel" key={title}>
                <h3 className="text-xl font-black text-slate-950">{title}</h3>
                <p className="mt-3 leading-7 text-slate-600">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 5: WHO WE ARE ── */}
      <section className="bg-[#FAFBFD] px-5 py-14 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-8 text-3xl font-black text-slate-950 sm:text-4xl">Who we are</h2>
          <div className="about-panel space-y-6">
            <p className="text-lg leading-9 text-slate-700">
              RAJO AI was founded by Jama Ilyas Abdisalan, a Somali software engineer and AI specialist. AI today can speak Somali — but it doesn't sound Somali. The pronunciation is wrong, the rhythm is foreign. He started RAJO to fix that. Our language deserves to be heard correctly by every machine in the world.
            </p>
            <blockquote className="border-l-4 border-[#467ED3] pl-5">
              <p className="text-lg italic text-slate-800">
                "Tallaabo yar oo wax wayn u ah mustaqbalka Soomaalida."
              </p>
              <p className="mt-2 text-sm text-slate-500">A small step — a giant one for the Somali future.</p>
            </blockquote>
            <p className="text-lg font-semibold text-slate-700">
              Built for Somalis everywhere —{" "}
              <em className="text-[#467ED3]">Soomaali meel kasta oo ay joogto.</em>
            </p>
          </div>
        </div>
      </section>

      {/* ── SECTION 6: CTA ── */}
      <section className="px-5 py-20">
        <div className="mx-auto max-w-4xl rounded-[2rem] border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-blue-50 px-6 py-16 text-center shadow-soft sm:px-10">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#467ED3] text-white">
            <svg aria-hidden="true" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.5a4 4 0 0 0 4-4v-7a4 4 0 1 0-8 0v7a4 4 0 0 0 4 4Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 11.5v3a7 7 0 0 0 14 0v-3M12 21v-2.5" />
            </svg>
          </div>
          <h2 className="text-4xl font-black text-slate-950 sm:text-5xl">
            Ready to make history with your voice?
          </h2>
          <p className="mt-4 text-lg italic text-[#467ED3]">
            Ku deeq codkaaga si aad uga qayb qaadato horumarinta luuqadda Soomaaliga.
          </p>
          <button className="btn-primary mt-8 bg-[#467ED3] text-base" onClick={onStart}>
            Ku deeq codkaaga →
          </button>
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

function HomePage({ onStart }: { onStart: () => void }) {
  return (
    <section className="mx-auto flex min-h-[calc(100vh-73px)] max-w-4xl flex-col items-center justify-center px-5 py-12 text-center">
      <BrandWaveform className="mb-6 h-12 w-auto sm:h-14" opacity={0.7} />
      <h1 className="text-4xl font-black tracking-normal text-slate-950 sm:text-6xl">
        Donate your Somali voice
      </h1>
      <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600 sm:text-xl">
        Help build ethical Somali voice AI by reading short Somali prompts
      </p>
      <div className="mt-9 flex w-full max-w-md flex-col gap-3 sm:flex-row">
        <button className="btn-primary flex-1 text-base" onClick={onStart}>Start Recording</button>
      </div>
      <p className="mt-7 rounded-full border border-blue-100 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700">
        Your voice is collected only with consent
      </p>
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
              <TextField label="Age" required type="number" value={formData.age} onChange={(value) => onFormChange({ ...formData, age: value })} />
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
              I consent to RAJO AI collecting my submitted voice recordings for ethical Somali voice AI.
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
  prompts,
  stats,
  user,
  onRecord,
}: {
  prompts: VoicePrompt[];
  stats: { total: number; minutes: number; approved: number; pending: number };
  user: RegisteredUser;
  onRecord: () => void;
}) {
  const cards = [
    ["Total recordings", stats.total.toString()],
    ["Total minutes", stats.minutes.toFixed(1)],
    ["Approved recordings", stats.approved.toString()],
    ["Pending review", stats.pending.toString()],
  ];

  return (
    <section className="mx-auto max-w-6xl px-5 py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-950 sm:text-4xl">Welcome, {firstName(user.fullName)}</h1>
          <p className="mt-2 text-slate-600">{prompts.length} Somali prompts are ready.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button className="btn-primary" onClick={onRecord}>Record New Voice</button>
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([label, value]) => (
          <article className="app-card p-5" key={label}>
            <p className="text-sm font-semibold text-slate-500">{label}</p>
            <p className="mt-3 text-3xl font-black text-slate-950">{value}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function RecordingPage({
  completedPromptIds,
  history,
  prompts,
  user,
  onBack,
  onSubmitRecording,
}: {
  completedPromptIds: string[];
  history: RecordingHistoryItem[];
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
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [duration, setDuration] = useState(0);
  const [metadata, setMetadata] = useState({
    deviceType: "Phone",
    backgroundNoise: "Quiet",
    speakingSpeed: "Normal",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const prompt = prompts[promptIndex] ?? prompts[0];
  const completed = prompt ? completedPromptIds.includes(prompt.sentenceId) : false;

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  async function startRecording() {
    setError("");
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        setAudioBlob(blob);
        setAudioUrl(url);
        setRecorderState("recorded");
        stream.getTracks().forEach((track) => track.stop());
        if (startedAt) setDuration(Math.max((Date.now() - startedAt) / 1000, 0));
      };
      setStartedAt(Date.now());
      recorder.start();
      setRecorderState("recording");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Microphone access failed.");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
  }

  function resetRecording() {
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl("");
    setRecorderState("idle");
    setDuration(0);
  }

  async function submitRecording() {
    if (!audioBlob || !prompt) return;
    setBusy(true);
    setError("");

    try {
      await onSubmitRecording(prompt, audioBlob, {
        ageRange: ageToRange(user.age),
        country: user.country,
        city: user.city,
        deviceType: metadata.deviceType,
        backgroundNoise: metadata.backgroundNoise,
        speakingSpeed: metadata.speakingSpeed,
        consent: true,
      });
      resetRecording();
      goToNext();
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
          <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <p className="text-sm font-bold uppercase tracking-wide text-slate-500">Read this Somali prompt</p>
            <h1 className="mt-5 text-3xl font-black leading-tight text-slate-950 sm:text-5xl">{prompt.sentenceText}</h1>
            {completed && (
              <p className="mt-5 rounded-full bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700">
                Already completed. Submit again only if you want to re-record this prompt.
              </p>
            )}
          </div>

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
                <button className="btn-primary" onClick={startRecording}>Start Recording</button>
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

function PromptManagement({
  prompts,
  onBack,
  onPromptsChange,
}: {
  prompts: VoicePrompt[];
  onBack: () => void;
  onPromptsChange: (prompts: VoicePrompt[]) => void;
}) {
  const [text, setText] = useState("");

  function addPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;

    onPromptsChange([
      ...prompts,
      {
        sentenceId: `custom-${Date.now()}`,
        sentenceText: trimmed,
      },
    ]);
    setText("");
  }

  return (
    <section className="mx-auto max-w-4xl px-5 py-8">
      <button className="btn-ghost mb-5" onClick={onBack}>Back to Dashboard</button>
      <div className="app-card p-5 sm:p-7">
        <h1 className="text-3xl font-black text-slate-950">Prompt Management</h1>
        <p className="mt-2 text-slate-600">Add Somali words or sentences. They will appear one by one on the recording page.</p>
        <form className="mt-6 flex flex-col gap-3 sm:flex-row" onSubmit={addPrompt}>
          <input className="field flex-1" placeholder="Type a Somali word or sentence" value={text} onChange={(event) => setText(event.target.value)} />
          <button className="btn-primary" type="submit">Add Prompt</button>
        </form>
        <div className="mt-6 space-y-3">
          {prompts.map((prompt, index) => (
            <div className="flex gap-3 rounded-2xl border border-slate-200 p-4" key={prompt.sentenceId}>
              <span className="font-black text-blue-700">{index + 1}</span>
              <p className="font-semibold text-slate-700">{prompt.sentenceText}</p>
            </div>
          ))}
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
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <select className="field" required value={value} onChange={(event) => onChange(event.target.value)}>
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

function ageToRange(age: number): string {
  if (age >= 45) return "45+";
  if (age >= 35) return "35-44";
  if (age >= 25) return "25-34";
  return "18-24";
}

function getInitialView(): View {
  if (window.location.pathname === "/about") return "about";
  if (window.location.pathname === "/record") return "record";
  if (window.location.pathname === "/signin") return "auth";
  return "home";
}

function loadPrompts(): VoicePrompt[] {
  try {
    const saved = localStorage.getItem(PROMPTS_KEY);
    if (!saved) return starterPrompts;
    const parsed = JSON.parse(saved) as VoicePrompt[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : starterPrompts;
  } catch {
    return starterPrompts;
  }
}

export default App;
