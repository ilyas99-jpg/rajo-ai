import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  deleteRecording,
  exportDatasetCsv,
  fetchAdminDashboardData,
  updateRecordingQualityScore,
  updateRecordingStatus,
} from "./adminService";
import { getSupabase } from "../lib/supabase";
import type { AdminDonor, AdminRecording, ReviewStatus } from "./adminTypes";

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

  useEffect(() => {
    if (isAdmin) void loadDashboard();
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
          <div className="flex gap-2">
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

      <div className="mx-auto max-w-7xl space-y-4 px-4 py-4 lg:px-6">
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

        <section className="rounded-3xl border border-blue-100 bg-white p-4 shadow-soft">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-blue-700">Recordings Review</p>
              <h2 className="mt-1 text-xl font-black text-slate-950">
                {donorGroups.length} donors, {filteredRecordings.length} recordings
              </h2>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:w-[720px] lg:grid-cols-4">
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

          <div className="mt-4 space-y-4">
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
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <header className="flex flex-col gap-3 border-b border-slate-100 pb-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-lg font-black text-slate-950">{group.name}</h3>
          <p className="text-sm font-semibold text-slate-500">{group.email || "No email"}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
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

      <button className="btn-secondary mt-3 min-h-10 rounded-xl px-4 py-2 text-xs" onClick={onToggle}>
        {expanded ? "Hide recordings" : "View recordings"}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
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

  const stats = [
    { label: "Donors", value: donors.length.toString(), icon: "D" },
    { label: "Recordings", value: recordings.length.toString(), icon: "R" },
    { label: "Duration", value: formatDuration(totalDurationSeconds), icon: "T" },
    { label: "Pending", value: pending.toString(), icon: "P" },
    { label: "Approved", value: approved.toString(), icon: "A" },
    { label: "Rejected", value: rejected.toString(), icon: "X" },
    { label: "Gender", value: formatBreakdown(countBy(donors, "gender")), icon: "G" },
    { label: "Dialects", value: formatBreakdown(countBy(donors, "dialect")), icon: "L" },
  ];

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <article className="rounded-2xl border border-blue-100 bg-white p-3 shadow-soft" key={stat.label}>
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-xs font-black text-blue-700">
              {stat.icon}
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">{stat.label}</p>
              <p className="mt-1 break-words text-xl font-black leading-tight text-slate-950">{stat.value}</p>
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
    <section className="rounded-3xl border border-blue-100 bg-white px-4 py-3 shadow-soft">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-blue-700">Dataset Progress</p>
          <p className="mt-1 text-lg font-black text-slate-950">
            {formatHours(totalHours)} / {DATASET_GOAL_HOURS} hours collected
          </p>
        </div>
        <p className="text-sm font-black text-slate-500">{progressPercent.toFixed(1)}%</p>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-blue-50">
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
    <section className="rounded-3xl border border-blue-100 bg-white px-4 py-3 shadow-soft">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-blue-700">Dataset Export</p>
          <p className="mt-1 text-base font-black text-slate-950">Export approved recordings as CSV</p>
          <p className="mt-0.5 text-xs font-semibold text-slate-500">
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
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>
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
