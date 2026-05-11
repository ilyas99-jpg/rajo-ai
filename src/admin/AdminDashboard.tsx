import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  createPrompt,
  createPromptPack,
  deletePrompt,
  deleteRecording,
  exportDatasetCsv,
  fetchAdminDashboardData,
  fetchAdminPromptPacks,
  updateRecordingQualityScore,
  updatePrompt,
  updatePromptPack,
  updateRecordingStatus,
  uploadPromptsCsv,
} from "./adminService";
import { getSupabase } from "../lib/supabase";
import type { AdminDonor, AdminPromptPack, AdminRecording, ReviewStatus } from "./adminTypes";

// The one and only authorized admin email. Checked client-side AND enforced
// server-side by Supabase RLS policies (auth.email() = ADMIN_EMAIL).
const ADMIN_EMAIL = "jamailyaz2024@gmail.com";
const DATASET_GOAL_HOURS = 100;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

type DonorRecordingGroup = {
  donorId: string;
  name: string;
  email: string;
  ageRange: string;
  gender: string;
  dialect: string;
  country: string;
  city: string;
  recordings: AdminRecording[];
  totalDurationSeconds: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  latestRecordingAt: string;
};

type BreakdownItem = {
  label: string;
  count: number;
};

type StatItem = {
  label: string;
  value: string;
  icon: string;
  breakdown?: BreakdownItem[];
};

type PromptListSize = 25 | 50 | "all";

export function AdminDashboard() {
  // undefined = Supabase session not yet resolved (loading)
  // null      = no active session
  // Session   = authenticated
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);

  const [donors, setDonors] = useState<AdminDonor[]>([]);
  const [recordings, setRecordings] = useState<AdminRecording[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dialectFilter, setDialectFilter] = useState("");
  const [genderFilter, setGenderFilter] = useState("");
  const [updatingId, setUpdatingId] = useState("");
  const [expandedDonors, setExpandedDonors] = useState<Set<string>>(new Set());
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState("");
  const [includeSignedUrls, setIncludeSignedUrls] = useState(false);
  const [promptPacks, setPromptPacks] = useState<AdminPromptPack[]>([]);
  const [promptError, setPromptError] = useState("");
  const [promptBusy, setPromptBusy] = useState(false);

  // Resolve Supabase Auth session on mount and keep it in sync.
  useEffect(() => {
    const sb = getSupabase();

    sb.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  // The authenticated user's email must exactly match the admin address.
  // This check is also enforced by server-side RLS policies.
  const isAdmin = session?.user?.email?.toLowerCase() === ADMIN_EMAIL;

  const loadDashboard = async () => {
    setIsLoading(true);
    setError("");

    try {
      const data = await fetchAdminDashboardData();
      setDonors(data.donors);
      setRecordings(data.recordings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load admin dashboard.");
    } finally {
      setIsLoading(false);
    }
  };

  const loadPromptManager = async () => {
    setPromptError("");
    try {
      setPromptPacks(await fetchAdminPromptPacks());
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : "Could not load prompt manager.");
    }
  };

  useEffect(() => {
    if (isAdmin) {
      void loadDashboard();
      void loadPromptManager();
    }
  }, [isAdmin]);

  const totalDurationSeconds = useMemo(
    () => recordings.reduce((sum, recording) => sum + (recording.duration_seconds ?? 0), 0),
    [recordings],
  );
  const totalHours = totalDurationSeconds / 3600;
  const progressPercent = Math.min((totalHours / DATASET_GOAL_HOURS) * 100, 100);

  const filteredRecordings = useMemo(() => {
    const query = search.trim().toLowerCase();

    return recordings.filter((recording) => {
      const donorName = recording.donor?.full_name ?? "";
      const donorEmail = recording.donor?.email ?? "";
      const dialect = recording.dialect || recording.donor?.dialect || "";
      const gender = recording.gender || recording.donor?.gender || "";
      const status = normalizeStatus(recording.status);

      return (
        (!query ||
          donorName.toLowerCase().includes(query) ||
          donorEmail.toLowerCase().includes(query) ||
          recording.sentence_text.toLowerCase().includes(query)) &&
        (!statusFilter || status === statusFilter) &&
        (!dialectFilter || dialect === dialectFilter) &&
        (!genderFilter || gender === genderFilter)
      );
    });
  }, [dialectFilter, genderFilter, recordings, search, statusFilter]);

  const donorGroups = useMemo(
    () => groupRecordingsByDonor(filteredRecordings),
    [filteredRecordings],
  );
  const dialectOptions = useMemo(
    () => unique(recordings.map((recording) => recording.dialect || recording.donor?.dialect)),
    [recordings],
  );
  const genderOptions = useMemo(
    () => unique(recordings.map((recording) => recording.gender || recording.donor?.gender)),
    [recordings],
  );

  // Sign in via Supabase Auth and verify the email server-side before granting access.
  const handleLoginSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (Date.now() < lockedUntil) {
      const secs = Math.ceil((lockedUntil - Date.now()) / 1000);
      setAuthError(`Too many failed attempts. Try again in ${secs} seconds.`);
      return;
    }

    const sb = getSupabase();
    const { error: signInError } = await sb.auth.signInWithPassword({
      email: loginEmail.trim().toLowerCase(),
      password: loginPassword,
    });

    if (signInError) {
      const attempts = loginAttempts + 1;
      setLoginAttempts(attempts);

      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        setLockedUntil(Date.now() + LOCKOUT_DURATION_MS);
        setLoginAttempts(0);
        setAuthError("Too many failed attempts. Please wait 15 minutes before trying again.");
      } else {
        setAuthError(
          `Invalid credentials. ${MAX_LOGIN_ATTEMPTS - attempts} attempt(s) remaining.`,
        );
      }

      setLoginPassword("");
      return;
    }

    // getUser() makes a live network call to Supabase — cannot be faked client-side.
    const {
      data: { user },
      error: userError,
    } = await sb.auth.getUser();

    if (userError || !user) {
      await sb.auth.signOut();
      setAuthError("Authentication failed. Please try again.");
      setLoginPassword("");
      return;
    }

    if (user.email?.toLowerCase() !== ADMIN_EMAIL) {
      await sb.auth.signOut();
      setAuthError("Access denied. This dashboard is restricted to authorized administrators.");
      setLoginEmail("");
      setLoginPassword("");
      return;
    }

    setAuthError("");
    setLoginAttempts(0);
    setLoginPassword("");
  };

  const handleAdminLogout = async () => {
    await getSupabase().auth.signOut();
    setDonors([]);
    setRecordings([]);
  };

  const handleStatusUpdate = async (recordingId: string, status: ReviewStatus) => {
    setUpdatingId(recordingId);
    setError("");

    try {
      await updateRecordingStatus(recordingId, status);
      setRecordings((current) =>
        current.map((recording) =>
          recording.id === recordingId
            ? { ...recording, status, reviewed_at: new Date().toISOString() }
            : recording,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update recording.");
    } finally {
      setUpdatingId("");
    }
  };

  const handleDeleteRecording = async (recording: AdminRecording) => {
    const confirmed = window.confirm("Delete this recording audio file and metadata row?");
    if (!confirmed) return;

    setUpdatingId(recording.id);
    setError("");

    try {
      await deleteRecording(recording);
      setRecordings((current) => current.filter((item) => item.id !== recording.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete recording.");
    } finally {
      setUpdatingId("");
    }
  };

  const handleQualityScoreUpdate = async (recordingId: string, qualityScore: number) => {
    setUpdatingId(recordingId);
    setError("");

    try {
      await updateRecordingQualityScore(recordingId, qualityScore);
      setRecordings((current) =>
        current.map((recording) =>
          recording.id === recordingId ? { ...recording, quality_score: qualityScore } : recording,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update quality score.");
    } finally {
      setUpdatingId("");
    }
  };

  const handleExport = async () => {
    setExportLoading(true);
    setExportError("");
    try {
      await exportDatasetCsv({ includeSignedUrls });
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExportLoading(false);
    }
  };

  const toggleDonor = (donorId: string) => {
    setExpandedDonors((current) => {
      const next = new Set(current);
      if (next.has(donorId)) next.delete(donorId);
      else next.add(donorId);
      return next;
    });
  };

  // Supabase session not yet resolved — show neutral loading state.
  if (session === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#eef6ff]">
        <p className="text-lg font-bold text-slate-600">Loading...</p>
      </main>
    );
  }

  // Not authenticated or authenticated with the wrong account.
  if (!session || !isAdmin) {
    return (
      <main className="min-h-screen bg-[#eef6ff] px-5 py-10 text-slate-900">
        <section className="mx-auto max-w-sm rounded-3xl border border-blue-100 bg-white p-6 shadow-soft">
          <img alt="RAJO AI" className="h-20 w-auto object-contain" src="/logo%20rajo%20ai.png" />
          <h1 className="mt-5 text-2xl font-black text-slate-950">RAJO AI Admin</h1>
          <p className="mt-1 text-sm text-slate-500">Authorized access only.</p>
          <form
            className="mt-5 space-y-3"
            onSubmit={(e) => void handleLoginSubmit(e)}
          >
            <label className="block">
              <span className="field-label">Email</span>
              <input
                autoComplete="email"
                className="field"
                required
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="field-label">Password</span>
              <input
                autoComplete="current-password"
                className="field"
                required
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
              />
            </label>
            {authError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-600">
                {authError}
              </p>
            )}
            <button className="btn-primary mt-2 w-full" type="submit">
              Sign In to Admin
            </button>
          </form>
          {session && !isAdmin && (
            <button
              className="mt-4 w-full text-sm text-slate-500 underline hover:text-slate-700"
              type="button"
              onClick={() => void handleAdminLogout()}
            >
              Sign out of current account
            </button>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#eef6ff] text-slate-900">
      <header className="border-b border-blue-100 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-6">
          <div className="flex items-center gap-4">
            <img alt="RAJO AI" className="h-16 w-auto object-contain" src="/logo%20rajo%20ai.png" />
            <div>
              <p className="text-sm font-black text-blue-700">RAJO AI Admin</p>
              <h1 className="text-2xl font-black text-slate-950">Voice Dataset Dashboard</h1>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <button className="admin-action admin-action-secondary" disabled={isLoading} onClick={() => void loadDashboard()}>
              {isLoading ? "Refreshing..." : "Refresh Data"}
            </button>
            <a className="admin-action admin-action-primary" href="/">
              Donate Flow
            </a>
            <button
              className="admin-action admin-action-secondary"
              onClick={() => void handleAdminLogout()}
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 lg:px-6 lg:py-8">
        {error && (
          <div className="rounded-2xl border border-red-100 bg-red-50 p-3 text-sm font-bold text-red-700">
            {error}
          </div>
        )}

        <StatsGrid donors={donors} recordings={recordings} totalDurationSeconds={totalDurationSeconds} />
        <ProgressCard progressPercent={progressPercent} totalHours={totalHours} />
        <ExportCard
          error={exportError}
          includeSignedUrls={includeSignedUrls}
          loading={exportLoading}
          onExport={() => void handleExport()}
          onToggleSignedUrls={setIncludeSignedUrls}
        />
        <PromptManager
          busy={promptBusy}
          error={promptError}
          packs={promptPacks}
          onCreatePack={async (input) => {
            setPromptBusy(true);
            setPromptError("");
            try {
              await createPromptPack(input);
              await loadPromptManager();
            } catch (err) {
              setPromptError(err instanceof Error ? err.message : "Could not create prompt pack.");
            } finally {
              setPromptBusy(false);
            }
          }}
          onCreatePrompt={async (input) => {
            setPromptBusy(true);
            setPromptError("");
            try {
              await createPrompt(input);
              await loadPromptManager();
            } catch (err) {
              setPromptError(err instanceof Error ? err.message : "Could not add prompt.");
            } finally {
              setPromptBusy(false);
            }
          }}
          onTogglePack={async (pack) => {
            setPromptBusy(true);
            setPromptError("");
            try {
              await updatePromptPack(pack.id, { isActive: !pack.is_active });
              await loadPromptManager();
            } catch (err) {
              setPromptError(err instanceof Error ? err.message : "Could not update prompt pack.");
            } finally {
              setPromptBusy(false);
            }
          }}
          onTogglePrompt={async (prompt) => {
            setPromptBusy(true);
            setPromptError("");
            try {
              await updatePrompt(prompt.id, { isActive: !prompt.is_active });
              await loadPromptManager();
            } catch (err) {
              setPromptError(err instanceof Error ? err.message : "Could not update prompt.");
            } finally {
              setPromptBusy(false);
            }
          }}
          onDeletePrompt={async (promptId) => {
            const confirmed = window.confirm("Delete this prompt permanently?");
            if (!confirmed) return;
            setPromptBusy(true);
            setPromptError("");
            try {
              await deletePrompt(promptId);
              await loadPromptManager();
            } catch (err) {
              setPromptError(err instanceof Error ? err.message : "Could not delete prompt.");
            } finally {
              setPromptBusy(false);
            }
          }}
          onUpdatePrompt={async (promptId, changes) => {
            setPromptBusy(true);
            setPromptError("");
            try {
              await updatePrompt(promptId, changes);
              await loadPromptManager();
            } catch (err) {
              setPromptError(err instanceof Error ? err.message : "Could not edit prompt.");
            } finally {
              setPromptBusy(false);
            }
          }}
          onUploadCsv={async (packId, csv) => {
            setPromptBusy(true);
            setPromptError("");
            try {
              const importedCount = await uploadPromptsCsv(packId, csv);
              await loadPromptManager();
              return importedCount;
            } catch (err) {
              setPromptError(err instanceof Error ? err.message : "Could not upload CSV.");
              throw err;
            } finally {
              setPromptBusy(false);
            }
          }}
        />

        <section className="rounded-3xl border border-blue-100 bg-white p-5 shadow-soft sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-wide text-blue-700">Recordings Review</p>
              <h2 className="mt-1.5 text-xl font-black leading-tight text-slate-950">
                {donorGroups.length} donors, {filteredRecordings.length} recordings
              </h2>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:w-[720px] lg:grid-cols-4">
              <input
                className="admin-field"
                placeholder="Search donor, email, or sentence"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <select className="admin-field" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
              <FilterSelect label="All dialects" options={dialectOptions} value={dialectFilter} onChange={setDialectFilter} />
              <FilterSelect label="All genders" options={genderOptions} value={genderFilter} onChange={setGenderFilter} />
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {donorGroups.map((group) => (
              <DonorRecordingsCard
                group={group}
                key={group.donorId}
                updatingId={updatingId}
                expanded={expandedDonors.has(group.donorId)}
                onDelete={(rec) => void handleDeleteRecording(rec)}
                onQualityScoreUpdate={(id, score) => void handleQualityScoreUpdate(id, score)}
                onStatusUpdate={(id, status) => void handleStatusUpdate(id, status)}
                onToggle={() => toggleDonor(group.donorId)}
              />
            ))}
          </div>

          {donorGroups.length === 0 && (
            <p className="py-10 text-center text-sm font-bold text-slate-500">No recordings match these filters.</p>
          )}
        </section>
      </div>
    </main>
  );
}

function groupRecordingsByDonor(recordings: AdminRecording[]): DonorRecordingGroup[] {
  const groups = new Map<string, DonorRecordingGroup>();

  recordings.forEach((recording) => {
    const donorId = recording.donor_id || "unknown";
    const group = groups.get(donorId) ?? {
      donorId,
      name: recording.donor?.full_name ?? "Unknown donor",
      email: recording.donor?.email ?? "",
      ageRange: recording.age_range || recording.donor?.age_range || "-",
      gender: recording.donor?.gender || recording.gender || "-",
      dialect: recording.donor?.dialect || recording.dialect || "-",
      country: recording.country || recording.donor?.country || "-",
      city: recording.city || recording.donor?.city || "-",
      recordings: [],
      totalDurationSeconds: 0,
      pendingCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      latestRecordingAt: recording.created_at,
    };

    group.recordings.push(recording);
    group.totalDurationSeconds += recording.duration_seconds ?? 0;
    if (normalizeStatus(recording.status) === "pending") group.pendingCount += 1;
    if (recording.status === "approved") group.approvedCount += 1;
    if (recording.status === "rejected") group.rejectedCount += 1;
    if (new Date(recording.created_at) > new Date(group.latestRecordingAt)) {
      group.latestRecordingAt = recording.created_at;
    }
    groups.set(donorId, group);
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      recordings: [...group.recordings].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    }))
    .sort(
      (a, b) =>
        new Date(b.latestRecordingAt).getTime() - new Date(a.latestRecordingAt).getTime(),
    );
}

function DonorRecordingsCard({
  expanded,
  group,
  updatingId,
  onDelete,
  onQualityScoreUpdate,
  onStatusUpdate,
  onToggle,
}: {
  expanded: boolean;
  group: DonorRecordingGroup;
  updatingId: string;
  onDelete: (recording: AdminRecording) => void;
  onQualityScoreUpdate: (recordingId: string, qualityScore: number) => void;
  onStatusUpdate: (recordingId: string, status: ReviewStatus) => void;
  onToggle: () => void;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <header className="flex flex-col gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-lg font-black text-slate-950">{group.name}</h3>
          <p className="text-sm font-semibold text-slate-500">{group.email || "No email"}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <MetaPill label="Gender" value={group.gender} />
            <MetaPill label="Age" value={group.ageRange} />
            <MetaPill label="Dialect" value={group.dialect} />
            <MetaPill label="Country" value={group.country} />
            <MetaPill label="City" value={group.city} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5 lg:min-w-[520px]">
          <Metric label="Recordings" value={group.recordings.length.toString()} />
          <Metric label="Duration" value={formatDuration(group.totalDurationSeconds)} />
          <Metric label="Pending" value={group.pendingCount.toString()} />
          <Metric label="Approved" value={group.approvedCount.toString()} />
          <Metric label="Rejected" value={group.rejectedCount.toString()} />
        </div>
      </header>

      <button className="btn-secondary mt-4 min-h-10 rounded-xl px-4 py-2 text-xs" onClick={onToggle}>
        {expanded ? "Hide recordings" : "View recordings"}
      </button>

      {expanded && (
        <div className="mt-4 space-y-3">
          {group.recordings.map((recording) => (
            <RecordingRow
              key={recording.id}
              recording={recording}
              updatingId={updatingId}
              onDelete={onDelete}
              onQualityScoreUpdate={onQualityScoreUpdate}
              onStatusUpdate={onStatusUpdate}
            />
          ))}
        </div>
      )}
    </article>
  );
}

function RecordingRow({
  recording,
  updatingId,
  onDelete,
  onQualityScoreUpdate,
  onStatusUpdate,
}: {
  recording: AdminRecording;
  updatingId: string;
  onDelete: (recording: AdminRecording) => void;
  onQualityScoreUpdate: (recordingId: string, qualityScore: number) => void;
  onStatusUpdate: (recordingId: string, status: ReviewStatus) => void;
}) {
  const busy = updatingId === recording.id;
  const isPending = normalizeStatus(recording.status) === "pending";

  return (
    <div className="rounded-2xl bg-slate-50 p-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={recording.status} />
            <span className="text-xs font-bold text-slate-500">{formatDate(recording.created_at)}</span>
            <span className="text-xs font-bold text-slate-500">
              {formatAudioDuration(recording.duration_seconds)}
            </span>
          </div>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-800">
            {recording.sentence_text}
          </p>
          <div className="mt-2">
            <AudioPlayer error={recording.audio_error} src={recording.signed_audio_url || recording.audio_url} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <MetaPill label="Age" value={recording.age_range || "-"} />
            <MetaPill label="Country" value={recording.country || "-"} />
            <MetaPill label="City" value={recording.city || "-"} />
            <MetaPill label="Device" value={recording.device_type || "-"} />
            <MetaPill label="Noise" value={recording.background_noise || "-"} />
            <MetaPill label="Speed" value={recording.speaking_speed || "-"} />
            <MetaPill label="Consent" value={recording.consent ? "Yes" : "No"} />
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-xs font-black text-slate-600">
            Quality
            <select
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-black"
              disabled={busy}
              value={recording.quality_score || 0}
              onChange={(event) => onQualityScoreUpdate(recording.id, Number(event.target.value))}
            >
              <option value={0}>-</option>
              {[1, 2, 3, 4, 5].map((score) => (
                <option key={score} value={score}>{score}</option>
              ))}
            </select>
          </label>
          {isPending ? (
            <>
              <button
                className="compact-btn bg-emerald-600 text-white"
                disabled={busy}
                onClick={() => onStatusUpdate(recording.id, "approved")}
              >
                Approve
              </button>
              <button
                className="compact-btn bg-orange-500 text-white"
                disabled={busy}
                onClick={() => onStatusUpdate(recording.id, "rejected")}
              >
                Reject
              </button>
            </>
          ) : (
            <span className="rounded-lg bg-white px-3 py-1.5 text-xs font-black text-slate-600">
              Reviewed
            </span>
          )}
          <button
            className="compact-btn bg-red-600 text-white"
            disabled={busy}
            onClick={() => onDelete(recording)}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function PromptManager({
  busy,
  error,
  packs,
  onCreatePack,
  onCreatePrompt,
  onTogglePack,
  onTogglePrompt,
  onDeletePrompt,
  onUpdatePrompt,
  onUploadCsv,
}: {
  busy: boolean;
  error: string;
  packs: AdminPromptPack[];
  onCreatePack: (input: {
    slug: string;
    title: string;
    description: string;
    language: string;
    dialect: string;
    unlockOrder: number;
    requiredPreviousPackId: string;
  }) => Promise<void>;
  onCreatePrompt: (input: {
    packId: string;
    text: string;
    category: string;
    difficulty: string;
    orderNumber: number;
  }) => Promise<void>;
  onTogglePack: (pack: AdminPromptPack) => Promise<void>;
  onTogglePrompt: (prompt: AdminPromptPack["prompts"][number]) => Promise<void>;
  onDeletePrompt: (promptId: string) => Promise<void>;
  onUpdatePrompt: (
    promptId: string,
    changes: { text: string; category: string; difficulty: string; orderNumber: number },
  ) => Promise<void>;
  onUploadCsv: (packId: string, csv: string) => Promise<number>;
}) {
  const [packForm, setPackForm] = useState({
    slug: "",
    title: "",
    description: "",
    language: "so",
    dialect: "Maxaa Tiri",
    unlockOrder: 1,
    requiredPreviousPackId: "",
  });
  const [selectedPackId, setSelectedPackId] = useState("");
  const [promptForm, setPromptForm] = useState({
    text: "",
    category: "",
    difficulty: "",
    orderNumber: 1,
  });
  const [csvText, setCsvText] = useState("");
  const [selectedCsvFileName, setSelectedCsvFileName] = useState("");
  const [importSuccess, setImportSuccess] = useState("");
  const [importError, setImportError] = useState("");
  const [promptsExpanded, setPromptsExpanded] = useState(false);
  const [promptListSize, setPromptListSize] = useState<PromptListSize>(25);
  const [expandedPromptId, setExpandedPromptId] = useState("");
  const csvFileInputRef = useRef<HTMLInputElement | null>(null);
  const promptListRef = useRef<HTMLDivElement | null>(null);

  const selectedPack = packs.find((pack) => pack.id === selectedPackId) ?? packs[0];
  const activeCount = (pack: AdminPromptPack) => pack.prompts.filter((prompt) => prompt.is_active).length;
  const csvRowCount = useMemo(() => countPromptCsvRows(csvText), [csvText]);
  const visiblePrompts = selectedPack
    ? promptListSize === "all"
      ? selectedPack.prompts
      : selectedPack.prompts.slice(0, promptListSize)
    : [];

  useEffect(() => {
    if (!selectedPackId && packs[0]) setSelectedPackId(packs[0].id);
  }, [packs, selectedPackId]);

  useEffect(() => {
    setCsvText("");
    setSelectedCsvFileName("");
    setImportSuccess("");
    setImportError("");
    setPromptsExpanded(false);
    setExpandedPromptId("");
    setPromptListSize(25);
    if (csvFileInputRef.current) csvFileInputRef.current.value = "";
  }, [selectedPack?.id]);

  return (
    <section className="rounded-3xl border border-blue-100 bg-white p-5 shadow-soft sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-wide text-blue-700">Prompt Manager</p>
          <h2 className="mt-1.5 text-xl font-black leading-tight text-slate-950">Prompt packs and recording prompts</h2>
          <p className="mt-1 max-w-2xl text-sm font-semibold leading-6 text-slate-500">
            Manage RAJO AI prompt sets from Supabase. Contributors only receive active prompts from unlocked packs.
          </p>
        </div>
        <div className="rounded-2xl bg-blue-50 px-4 py-3 text-sm font-black text-blue-700">
          {packs.reduce((sum, pack) => sum + activeCount(pack), 0)} active prompts
        </div>
      </div>

      {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}

      <div className="mt-6 grid gap-5 xl:grid-cols-[360px_1fr]">
        <form
          className="rounded-2xl border border-slate-100 bg-slate-50 p-4 sm:p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void onCreatePack(packForm).then(() =>
              setPackForm({
                slug: "",
                title: "",
                description: "",
                language: "so",
                dialect: "Maxaa Tiri",
                unlockOrder: packs.length + 2,
                requiredPreviousPackId: "",
              }),
            );
          }}
        >
          <h3 className="font-black text-slate-950">Create prompt pack</h3>
          <div className="mt-4 space-y-2.5">
            <input className="admin-field" placeholder="slug" required value={packForm.slug} onChange={(e) => setPackForm({ ...packForm, slug: e.target.value })} />
            <input className="admin-field" placeholder="Title" required value={packForm.title} onChange={(e) => setPackForm({ ...packForm, title: e.target.value })} />
            <textarea className="admin-field min-h-20" placeholder="Description" value={packForm.description} onChange={(e) => setPackForm({ ...packForm, description: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input className="admin-field" placeholder="Language" value={packForm.language} onChange={(e) => setPackForm({ ...packForm, language: e.target.value })} />
              <input className="admin-field" min={1} type="number" value={packForm.unlockOrder} onChange={(e) => setPackForm({ ...packForm, unlockOrder: Number(e.target.value) })} />
            </div>
            <select className="admin-field" required value={packForm.dialect} onChange={(e) => setPackForm({ ...packForm, dialect: e.target.value, requiredPreviousPackId: "" })}>
              <option value="Maxaa Tiri">Maxaa Tiri</option>
              <option value="May May">May May</option>
            </select>
            <select className="admin-field" value={packForm.requiredPreviousPackId} onChange={(e) => setPackForm({ ...packForm, requiredPreviousPackId: e.target.value })}>
              <option value="">No prerequisite</option>
              {packs.filter((pack) => pack.dialect === packForm.dialect).map((pack) => (
                <option key={pack.id} value={pack.id}>{pack.title}</option>
              ))}
            </select>
            <button className="admin-action admin-action-primary w-full" disabled={busy} type="submit">
              Create Pack
            </button>
          </div>
        </form>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {packs.map((pack) => (
              <button
                className={`min-h-32 rounded-2xl border p-4 text-left transition ${
                  selectedPack?.id === pack.id ? "border-blue-300 bg-blue-50" : "border-slate-100 bg-white hover:bg-slate-50"
                }`}
                key={pack.id}
                onClick={() => setSelectedPackId(pack.id)}
                type="button"
              >
                <p className="text-xs font-black uppercase tracking-wide text-blue-700">Order {pack.unlock_order}</p>
                <h3 className="mt-1 font-black text-slate-950">{pack.title}</h3>
                <p className="mt-1 text-xs font-bold text-slate-500">
                  {activeCount(pack)} active / {pack.prompts.length} total
                </p>
                <span className="mt-3 mr-2 inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">
                  {pack.dialect}
                </span>
                <span className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-black ${pack.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                  {pack.is_active ? "Active" : "Inactive"}
                </span>
              </button>
            ))}
          </div>

          {selectedPack && (
            <div className="rounded-2xl border border-slate-100 p-4 sm:p-5">
              <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-lg font-black text-slate-950">{selectedPack.title}</h3>
                  <p className="mt-1 text-xs font-black uppercase tracking-wide text-blue-700">{selectedPack.dialect}</p>
                  <p className="mt-1 text-sm font-semibold leading-6 text-slate-500">{selectedPack.description || "No description yet."}</p>
                </div>
                <button className="admin-action admin-action-secondary" disabled={busy} onClick={() => void onTogglePack(selectedPack)}>
                  {selectedPack.is_active ? "Deactivate Pack" : "Activate Pack"}
                </button>
              </div>

              <div className="mt-5 grid gap-4">
                <form
                  className="rounded-2xl border border-slate-100 bg-white p-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void onCreatePrompt({ packId: selectedPack.id, ...promptForm }).then(() =>
                      setPromptForm({ text: "", category: "", difficulty: "", orderNumber: selectedPack.prompts.length + 2 }),
                    );
                  }}
                >
                  <div className="flex flex-col gap-1">
                    <h4 className="text-sm font-black text-slate-950">Add single prompt</h4>
                    <p className="text-xs font-semibold text-slate-500">Create one prompt manually for this pack.</p>
                  </div>
                  <div className="mt-3 grid gap-2 lg:grid-cols-[1fr_130px_130px_100px_auto]">
                    <input className="admin-field" placeholder="Prompt text" required value={promptForm.text} onChange={(e) => setPromptForm({ ...promptForm, text: e.target.value })} />
                    <input className="admin-field" placeholder="Category" value={promptForm.category} onChange={(e) => setPromptForm({ ...promptForm, category: e.target.value })} />
                    <input className="admin-field" placeholder="Difficulty" value={promptForm.difficulty} onChange={(e) => setPromptForm({ ...promptForm, difficulty: e.target.value })} />
                    <input className="admin-field" min={1} type="number" value={promptForm.orderNumber} onChange={(e) => setPromptForm({ ...promptForm, orderNumber: Number(e.target.value) })} />
                    <button className="admin-action admin-action-primary" disabled={busy} type="submit">Add</button>
                  </div>
                </form>

                <div className="rounded-2xl border border-blue-100 bg-slate-50 p-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h4 className="text-sm font-black text-slate-950">Import CSV</h4>
                      <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                        Review the file details, then save to import prompts into this pack.
                      </p>
                    </div>
                    <span className="mt-2 inline-flex w-fit rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700 sm:mt-0">
                      {csvRowCount} row{csvRowCount === 1 ? "" : "s"} detected
                    </span>
                  </div>

                  {importSuccess && (
                    <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">
                      {importSuccess}
                    </p>
                  )}
                  {importError && (
                    <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
                      {importError}
                    </p>
                  )}

                  <textarea
                    className="admin-field mt-3 min-h-28"
                    placeholder="CSV: text,category,difficulty,order_number"
                    value={csvText}
                    onChange={(event) => {
                      setCsvText(event.target.value);
                      setImportSuccess("");
                      setImportError("");
                    }}
                  />
                  <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <input
                        accept=".csv,text/csv"
                        className="block w-full text-sm font-bold text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-black file:text-blue-700"
                        ref={csvFileInputRef}
                        type="file"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          setImportSuccess("");
                          setImportError("");
                          if (!file) {
                            setSelectedCsvFileName("");
                            return;
                          }
                          setSelectedCsvFileName(file.name);
                          void file.text().then(setCsvText).catch(() => {
                            setImportError("Could not read the selected CSV file.");
                          });
                        }}
                      />
                      <p className="mt-2 truncate text-xs font-bold text-slate-500">
                        {selectedCsvFileName ? `Selected file: ${selectedCsvFileName}` : "No CSV file selected."}
                      </p>
                    </div>
                    <button
                      className="admin-action admin-action-primary shrink-0"
                      disabled={busy || csvRowCount === 0}
                      onClick={() => {
                        setImportSuccess("");
                        setImportError("");
                        void onUploadCsv(selectedPack.id, csvText)
                          .then(() => {
                            setImportSuccess("Prompts imported successfully");
                            setCsvText("");
                            setSelectedCsvFileName("");
                            setPromptsExpanded(true);
                            if (csvFileInputRef.current) csvFileInputRef.current.value = "";
                            window.setTimeout(() => {
                              promptListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                            }, 0);
                          })
                          .catch((err) => {
                            setImportError(err instanceof Error ? err.message : "Could not import prompts.");
                          });
                      }}
                      type="button"
                    >
                      {busy ? "Importing..." : "Save / Import Prompts"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-slate-100 bg-white p-4" ref={promptListRef}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h4 className="text-sm font-black text-slate-950">Manage prompts</h4>
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      {selectedPack.prompts.length} prompt{selectedPack.prompts.length === 1 ? "" : "s"} in this pack
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {promptsExpanded && (
                      <button
                        className="admin-action admin-action-secondary"
                        type="button"
                        onClick={() => {
                          setPromptsExpanded(false);
                          setExpandedPromptId("");
                        }}
                      >
                        Collapse
                      </button>
                    )}
                    <button
                      className="admin-action admin-action-primary"
                      disabled={selectedPack.prompts.length === 0}
                      type="button"
                      onClick={() => setPromptsExpanded((current) => !current)}
                    >
                      {promptsExpanded ? "Hide Prompts" : `View Prompts (${selectedPack.prompts.length})`}
                    </button>
                  </div>
                </div>

                {!promptsExpanded && selectedPack.prompts.length === 0 && (
                  <p className="mt-4 rounded-2xl bg-slate-50 p-5 text-center text-sm font-bold text-slate-500">No prompts in this pack yet.</p>
                )}

                {promptsExpanded && (
                  <div className="mt-4">
                    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs font-bold text-slate-500">
                        Showing {visiblePrompts.length} of {selectedPack.prompts.length}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {([25, 50, "all"] as PromptListSize[]).map((size) => (
                          <button
                            className={`compact-btn ${
                              promptListSize === size ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-700"
                            }`}
                            key={String(size)}
                            type="button"
                            onClick={() => setPromptListSize(size)}
                          >
                            {size === "all" ? "Show All" : `Show ${size}`}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="overflow-x-auto rounded-2xl border border-slate-100">
                      <table className="min-w-[920px] w-full border-collapse text-left">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-500">Order</th>
                            <th className="px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-500">Text</th>
                            <th className="px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-500">Category</th>
                            <th className="px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-500">Difficulty</th>
                            <th className="px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-500">Status</th>
                            <th className="px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-500">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visiblePrompts.map((prompt) => (
                            <PromptTableRow
                              busy={busy}
                              expanded={expandedPromptId === prompt.id}
                              key={prompt.id}
                              prompt={prompt}
                              onExpand={() =>
                                setExpandedPromptId((current) => (current === prompt.id ? "" : prompt.id))
                              }
                              onToggle={() => void onTogglePrompt(prompt)}
                              onDelete={() => void onDeletePrompt(prompt.id)}
                              onUpdate={(changes) => void onUpdatePrompt(prompt.id, changes)}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function PromptTableRow({
  busy,
  expanded,
  prompt,
  onExpand,
  onToggle,
  onDelete,
  onUpdate,
}: {
  busy: boolean;
  expanded: boolean;
  prompt: AdminPromptPack["prompts"][number];
  onExpand: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onUpdate: (changes: { text: string; category: string; difficulty: string; orderNumber: number }) => void;
}) {
  const [text, setText] = useState(prompt.text);
  const [category, setCategory] = useState(prompt.category ?? "");
  const [difficulty, setDifficulty] = useState(prompt.difficulty ?? "");
  const [orderNumber, setOrderNumber] = useState(prompt.order_number);

  useEffect(() => {
    setText(prompt.text);
    setCategory(prompt.category ?? "");
    setDifficulty(prompt.difficulty ?? "");
    setOrderNumber(prompt.order_number);
  }, [prompt.category, prompt.difficulty, prompt.order_number, prompt.text]);

  const isDirty =
    text.trim() !== prompt.text ||
    category.trim() !== (prompt.category ?? "") ||
    difficulty.trim() !== (prompt.difficulty ?? "") ||
    orderNumber !== prompt.order_number;

  return (
    <>
      <tr className="border-t border-slate-100 align-middle">
        <td className="w-24 px-3 py-2">
          <input
            className="admin-field min-h-9 px-2 py-1 text-xs"
            min={1}
            type="number"
            value={orderNumber}
            onChange={(event) => setOrderNumber(Number(event.target.value))}
          />
        </td>
        <td className="max-w-[360px] px-3 py-2">
          <button
            className="block w-full truncate text-left text-sm font-bold text-slate-800 hover:text-blue-700"
            title={prompt.text}
            type="button"
            onClick={onExpand}
          >
            {text || "Untitled prompt"}
          </button>
        </td>
        <td className="w-36 px-3 py-2">
          <input
            className="admin-field min-h-9 px-2 py-1 text-xs"
            placeholder="Category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          />
        </td>
        <td className="w-36 px-3 py-2">
          <input
            className="admin-field min-h-9 px-2 py-1 text-xs"
            placeholder="Difficulty"
            value={difficulty}
            onChange={(event) => setDifficulty(event.target.value)}
          />
        </td>
        <td className="w-28 px-3 py-2">
          <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black ${prompt.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
            {prompt.is_active ? "Active" : "Inactive"}
          </span>
        </td>
        <td className="w-72 px-3 py-2">
          <div className="flex flex-wrap gap-1.5">
            <button className="compact-btn bg-blue-50 text-blue-700" type="button" onClick={onExpand}>
              {expanded ? "Close" : "Open"}
            </button>
            <button
              className="compact-btn bg-blue-600 text-white"
              disabled={busy || !isDirty}
              onClick={() => onUpdate({ text, category, difficulty, orderNumber })}
              type="button"
            >
              Save
            </button>
            <button className="compact-btn bg-slate-700 text-white" disabled={busy} onClick={onToggle} type="button">
              {prompt.is_active ? "Deactivate" : "Activate"}
            </button>
            <button className="compact-btn bg-red-600 text-white" disabled={busy} onClick={onDelete} type="button">
              Delete
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-slate-100 bg-slate-50">
          <td className="px-3 py-3" colSpan={6}>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wide text-slate-500">
                Prompt text
              </span>
              <textarea
                className="admin-field min-h-24"
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
          </td>
        </tr>
      )}
    </>
  );
}

function AudioPlayer({ error, src }: { error: string; src: string }) {
  const [failed, setFailed] = useState(false);

  if (!src) return <p className="text-sm font-bold text-slate-500">Recording file missing</p>;
  if (failed) {
    return (
      <p className="text-sm font-bold text-red-600">
        {error || "Audio failed to load"}
      </p>
    );
  }

  return (
    <audio
      className="h-9 w-full max-w-xl"
      controls
      preload="metadata"
      src={src}
      onError={() => setFailed(true)}
    />
  );
}

function StatsGrid({
  donors,
  recordings,
  totalDurationSeconds,
}: {
  donors: AdminDonor[];
  recordings: AdminRecording[];
  totalDurationSeconds: number;
}) {
  const approved = recordings.filter((recording) => recording.status === "approved").length;
  const rejected = recordings.filter((recording) => recording.status === "rejected").length;
  const pending = recordings.filter((recording) => normalizeStatus(recording.status) === "pending").length;

  const stats: StatItem[] = [
    { label: "Donors", value: donors.length.toString(), icon: "D" },
    { label: "Recordings", value: recordings.length.toString(), icon: "R" },
    { label: "Duration", value: formatDuration(totalDurationSeconds), icon: "T" },
    { label: "Pending", value: pending.toString(), icon: "P" },
    { label: "Approved", value: approved.toString(), icon: "A" },
    { label: "Rejected", value: rejected.toString(), icon: "X" },
    {
      label: "Gender",
      value: formatBreakdown(countBy(donors, "gender")),
      icon: "G",
      breakdown: getBreakdownItems(countBy(donors, "gender")),
    },
    {
      label: "Dialects",
      value: formatBreakdown(countBy(donors, "dialect")),
      icon: "L",
      breakdown: getBreakdownItems(countBy(donors, "dialect")),
    },
  ];

  return (
    <section className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <article className="flex h-36 overflow-hidden rounded-2xl border border-blue-100 bg-white p-4 shadow-soft" key={stat.label}>
          <div className="flex w-full items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-xs font-black text-blue-700">
              {stat.icon}
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">{stat.label}</p>
              {stat.breakdown ? (
                <StatBreakdown items={stat.breakdown} />
              ) : (
                <p className="mt-2 break-words text-2xl font-black leading-none text-slate-950">{stat.value}</p>
              )}
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}

function ProgressCard({
  progressPercent,
  totalHours,
}: {
  progressPercent: number;
  totalHours: number;
}) {
  return (
    <section className="rounded-3xl border border-blue-100 bg-white p-5 shadow-soft sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-wide text-blue-700">Dataset Progress</p>
          <p className="mt-1.5 text-lg font-black leading-tight text-slate-950">
            {formatHours(totalHours)} / {DATASET_GOAL_HOURS} hours collected
          </p>
        </div>
        <p className="text-sm font-black text-slate-500">{progressPercent.toFixed(1)}%</p>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-blue-50">
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${progressPercent}%` }} />
      </div>
    </section>
  );
}

function FilterSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select className="admin-field" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{label}</option>
      {options.map((option) => (
        <option key={option} value={option}>{option}</option>
      ))}
    </select>
  );
}

function StatBreakdown({ items }: { items: BreakdownItem[] }) {
  if (items.length === 0) {
    return <p className="mt-2 text-lg font-black leading-tight text-slate-950">None</p>;
  }

  return (
    <ul className="mt-3 grid max-h-20 gap-1.5 overflow-y-auto pr-1">
      {items.map((item) => (
        <li
          className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-blue-50 px-2.5 py-1.5"
          key={item.label}
        >
          <span className="min-w-0 truncate text-xs font-black text-blue-700">{item.label}</span>
          <span className="shrink-0 text-xs font-black text-slate-950">{item.count}</span>
        </li>
      ))}
    </ul>
  );
}

function StatusBadge({ status }: { status: string }) {
  const display = normalizeStatus(status);
  const colors =
    display === "approved"
      ? "bg-emerald-50 text-emerald-700"
      : display === "rejected"
        ? "bg-red-50 text-red-700"
        : "bg-orange-50 text-orange-700";

  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-black uppercase ${colors}`}>
      {display}
    </span>
  );
}

function MetaPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full bg-slate-100 px-2.5 py-1 font-black text-slate-600">
      {label}: <span className="text-slate-950">{value}</span>
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-blue-50 px-3 py-2">
      <p className="text-[10px] font-black uppercase tracking-wide text-blue-700">{label}</p>
      <p className="mt-1 text-sm font-black text-slate-950">{value}</p>
    </div>
  );
}

function ExportCard({
  error,
  includeSignedUrls,
  loading,
  onExport,
  onToggleSignedUrls,
}: {
  error: string;
  includeSignedUrls: boolean;
  loading: boolean;
  onExport: () => void;
  onToggleSignedUrls: (value: boolean) => void;
}) {
  return (
    <section className="rounded-3xl border border-blue-100 bg-white p-5 shadow-soft sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-wide text-blue-700">Dataset Export</p>
          <p className="mt-1.5 text-base font-black leading-tight text-slate-950">Export approved recordings as CSV</p>
          <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
            Includes all approved rows with metadata. No personal data beyond gender, dialect, country, and city.
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-black text-slate-700">
            <input
              checked={includeSignedUrls}
              className="h-4 w-4 accent-blue-600"
              type="checkbox"
              onChange={(e) => onToggleSignedUrls(e.target.checked)}
            />
            Include 1-hr signed download URLs
          </label>
          <button
            className="admin-action admin-action-primary"
            disabled={loading}
            onClick={onExport}
          >
            {loading ? "Exporting..." : "Export CSV"}
          </button>
        </div>
      </div>
      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>
      )}
    </section>
  );
}

function countBy<T extends Record<string, unknown>>(items: T[], key: keyof T): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const value = String(item[key] || "Unknown");
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function formatBreakdown(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) return "None";
  return entries.map(([label, count]) => `${label}: ${count}`).join(", ");
}

function getBreakdownItems(counts: Record<string, number>): BreakdownItem[] {
  return Object.entries(counts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function countPromptCsvRows(csvText: string): number {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return 0;

  const firstCells = splitCsvPreviewLine(lines[0]).map((cell) => cell.toLowerCase());
  const hasHeader = firstCells.includes("text") || firstCells.includes("prompt");
  const header = hasHeader ? firstCells : ["text", "category", "difficulty", "order_number"];
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const textIndex = Math.max(header.indexOf("text"), header.indexOf("prompt"));

  return dataLines.filter((line) => {
    const cells = splitCsvPreviewLine(line);
    return Boolean(cells[textIndex >= 0 ? textIndex : 0]?.trim());
  }).length;
}

function splitCsvPreviewLine(line: string): string[] {
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

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort();
}

function normalizeStatus(status: string): string {
  return status === "pending_review" ? "pending" : status;
}

function formatDuration(seconds: number): string {
  if (!seconds) return "0 min";
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} min`;
  return `${(seconds / 3600).toFixed(2)} hr`;
}

function formatAudioDuration(seconds: number | null): string {
  return seconds && seconds > 0 ? formatDuration(seconds) : "Duration unknown";
}

function formatHours(hours: number): string {
  return hours < 1 ? hours.toFixed(1) : hours.toFixed(2);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
