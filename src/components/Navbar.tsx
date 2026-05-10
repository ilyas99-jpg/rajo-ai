import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Globe,
  Headphones,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  X,
} from "lucide-react";
import type { RegisteredUser } from "../types";

type View = "home" | "about" | "auth" | "dashboard" | "record";
type Language = "EN" | "SO";

export interface NavbarProps {
  activeView: View;
  user: RegisteredUser | null;
  onHome: () => void;
  onAbout: () => void;
  onHowItWorks: () => void;
  onDashboard: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onMyRecordings?: () => void;
  onSettings?: () => void;
}

export function Navbar({
  activeView,
  user,
  onHome,
  onAbout,
  onHowItWorks,
  onDashboard,
  onSignIn,
  onSignOut,
  onMyRecordings,
  onSettings,
}: NavbarProps) {
  const [scrolled, setScrolled]             = useState(false);
  const [mobileOpen, setMobileOpen]         = useState(false);
  const [userDropdownOpen, setUserDropdown] = useState(false);
  const [langDropdownOpen, setLangDropdown] = useState(false);
  const [language, setLanguage]             = useState<Language>("EN");

  const userRef = useRef<HTMLDivElement>(null);
  const langRef = useRef<HTMLDivElement>(null);

  // Soft shadow + blur kicks in after 12 px of scroll
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (userRef.current && !userRef.current.contains(e.target as Node))
        setUserDropdown(false);
      if (langRef.current && !langRef.current.contains(e.target as Node))
        setLangDropdown(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setUserDropdown(false);
    setLangDropdown(false);
  }, [activeView]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  function selectLanguage(lang: Language) {
    setLanguage(lang);
    setLangDropdown(false);
    console.log("Language selected:", lang);
  }

  const navLinks = [
    { label: "Home",         view: "home"  as View, action: onHome },
    { label: "About",        view: "about" as View, action: onAbout },
    { label: "How it Works", view: null,             action: onHowItWorks },
    ...(user ? [{ label: "Dashboard", view: "dashboard" as View, action: onDashboard }] : []),
  ];

  const userInitial = user?.fullName?.[0]?.toUpperCase() ?? "U";
  const firstName   = user?.fullName?.split(" ")[0] ?? "";

  return (
    <header
      role="banner"
      className={`sticky top-0 z-30 h-[72px] border-b border-[#E5E7EB] bg-white/[0.97] transition-shadow duration-300 ease-out ${
        scrolled ? "shadow-[0_2px_16px_rgba(0,0,0,0.07)] backdrop-blur-sm" : ""
      }`}
    >
      {/* ── Desktop bar ─────────────────────────────────────────────────── */}
      <div className="mx-auto grid h-full max-w-6xl grid-cols-[1fr_auto_1fr] items-center px-5 lg:px-6">

        {/* Left: logo only */}
        <button
          onClick={onHome}
          aria-label="Rajo AI – go to home"
          className="flex items-center rounded focus:outline-none focus:ring-2 focus:ring-[#467ed3]/30"
        >
          <img
            src="/logo%20rajo%20ai.png"
            alt="Rajo AI"
            className="h-12 w-auto object-contain"
            onError={(e) => {
              const img = e.currentTarget;
              img.style.display = "none";
              const fb = img.nextElementSibling as HTMLElement | null;
              if (fb) fb.style.display = "block";
            }}
          />
          <span style={{ display: "none" }} className="text-[20px] font-black tracking-tight text-slate-900">
            RAJO<span style={{ color: "#467ed3" }}>AI</span>
          </span>
        </button>

        {/* Center: nav links */}
        <nav aria-label="Main navigation" className="hidden items-center gap-7 md:flex">
          {navLinks.map(({ label, view, action }) => {
            const isActive = view !== null && activeView === view;
            return (
              <button
                key={label}
                onClick={action}
                aria-current={isActive ? "page" : undefined}
                style={{ color: isActive ? "#467ed3" : "#374151" }}
                className="group relative pb-[3px] text-[15px] font-medium transition-colors duration-200 ease-out hover:text-[#467ed3] focus:outline-none"
              >
                {label}
                {/* Underline: always rendered; grows from 0 → 100% on hover, stays full when active */}
                <span
                  aria-hidden="true"
                  style={{ backgroundColor: "#467ed3" }}
                  className={`absolute bottom-0 left-0 h-px rounded-full transition-all duration-200 ease-out ${
                    isActive ? "w-full" : "w-0 group-hover:w-full"
                  }`}
                />
              </button>
            );
          })}
        </nav>

        {/* Right: language + auth */}
        <div className="flex items-center justify-end gap-2.5">

          {/* Language switcher (desktop) */}
          <div className="relative hidden md:block" ref={langRef}>
            <button
              onClick={() => { setLangDropdown((v) => !v); setUserDropdown(false); }}
              aria-haspopup="listbox"
              aria-expanded={langDropdownOpen}
              aria-label={`Language: ${language === "EN" ? "English" : "Af-Soomaali"}`}
              className="flex items-center gap-1.5 rounded px-2 py-1.5 text-[14px] font-medium text-[#374151] transition-colors duration-200 ease-out hover:text-[#467ed3] focus:outline-none"
            >
              <Globe className="h-[15px] w-[15px]" aria-hidden="true" />
              <span>{language}</span>
              <ChevronDown
                aria-hidden="true"
                className={`h-[13px] w-[13px] transition-transform duration-200 ease-out ${langDropdownOpen ? "rotate-180" : ""}`}
              />
            </button>

            {langDropdownOpen && (
              <div
                role="listbox"
                aria-label="Select language"
                className="absolute right-0 top-full mt-2 w-44 overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-soft"
              >
                {(
                  [
                    { code: "EN" as Language, label: "English",  sub: "English",     flag: "🇬🇧" },
                    { code: "SO" as Language, label: "Soomaali", sub: "Af-Soomaali", flag: "🇸🇴" },
                  ] as const
                ).map(({ code, label, sub, flag }) => (
                  <button
                    key={code}
                    role="option"
                    aria-selected={language === code}
                    onClick={() => selectLanguage(code)}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors duration-150 hover:bg-blue-50 ${
                      language === code
                        ? "font-semibold text-[#467ed3]"
                        : "font-medium text-[#374151]"
                    }`}
                  >
                    <span aria-hidden="true">{flag}</span>
                    <div className="flex-1 leading-tight">
                      <div>{label}</div>
                      <div className="text-[11px] text-gray-400">{sub}</div>
                    </div>
                    {language === code && (
                      <span style={{ color: "#467ed3" }} aria-hidden="true">✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* User avatar or Sign In */}
          {user ? (
            <div className="relative" ref={userRef}>
              <button
                onClick={() => { setUserDropdown((v) => !v); setLangDropdown(false); }}
                aria-haspopup="menu"
                aria-expanded={userDropdownOpen}
                aria-label={`Account menu for ${user.fullName}`}
                className="flex items-center gap-1.5 rounded px-2 py-1.5 transition-colors duration-200 ease-out hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#467ed3]/30"
              >
                <span
                  aria-hidden="true"
                  style={{ backgroundColor: "#467ed3" }}
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-[12px] font-bold text-white"
                >
                  {userInitial}
                </span>
                <span className="hidden max-w-[80px] truncate text-[14px] font-medium text-[#374151] sm:block">
                  {firstName}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={`h-[13px] w-[13px] text-gray-400 transition-transform duration-200 ease-out ${userDropdownOpen ? "rotate-180" : ""}`}
                />
              </button>

              {userDropdownOpen && (
                <div
                  role="menu"
                  aria-label="User actions"
                  className="absolute right-0 top-full mt-2 w-52 overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-soft"
                >
                  <div className="border-b border-[#E5E7EB] px-4 py-3">
                    <div className="truncate text-[13px] font-semibold text-slate-900">{user.fullName}</div>
                    <div className="truncate text-[12px] text-gray-400">{user.email}</div>
                  </div>

                  {[
                    { Icon: LayoutDashboard, label: "Dashboard",     action: onDashboard },
                    { Icon: Headphones,      label: "My Recordings", action: onMyRecordings },
                    { Icon: Settings,        label: "Settings",      action: onSettings },
                  ].map(({ Icon, label, action }) => (
                    <button
                      key={label}
                      role="menuitem"
                      onClick={() => { action?.(); setUserDropdown(false); }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] font-medium text-[#374151] transition-colors duration-150 hover:bg-gray-50"
                    >
                      <Icon className="h-[15px] w-[15px] text-gray-400" aria-hidden="true" />
                      {label}
                    </button>
                  ))}

                  <div className="border-t border-[#E5E7EB]">
                    <button
                      role="menuitem"
                      onClick={() => { onSignOut(); setUserDropdown(false); }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] font-medium text-red-600 transition-colors duration-150 hover:bg-red-50"
                    >
                      <LogOut className="h-[15px] w-[15px]" aria-hidden="true" />
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={onSignIn}
              className="hidden rounded border border-[#E5E7EB] px-3.5 py-[7px] text-[14px] font-medium text-[#374151] transition-colors duration-200 ease-out hover:border-[#467ed3] hover:text-[#467ed3] focus:outline-none focus:ring-2 focus:ring-[#467ed3]/30 md:block"
            >
              Sign In
            </button>
          )}

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-controls="navbar-mobile-menu"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            className="flex h-8 w-8 items-center justify-center rounded text-[#374151] transition-colors duration-150 hover:bg-gray-100 focus:outline-none md:hidden"
          >
            {mobileOpen
              ? <X    className="h-[18px] w-[18px]" aria-hidden="true" />
              : <Menu className="h-[18px] w-[18px]" aria-hidden="true" />
            }
          </button>
        </div>
      </div>

      {/* ── Mobile menu ─────────────────────────────────────────────────── */}
      <div
        id="navbar-mobile-menu"
        aria-hidden={!mobileOpen}
        className={`absolute left-0 right-0 top-[72px] overflow-hidden border-b border-[#E5E7EB] bg-white transition-all duration-300 ease-in-out md:hidden ${
          mobileOpen ? "max-h-[100dvh]" : "max-h-0"
        }`}
      >
        <nav aria-label="Mobile navigation" className="flex flex-col px-5 pb-6 pt-3">

          {navLinks.map(({ label, view, action }) => {
            const isActive = view !== null && activeView === view;
            return (
              <button
                key={label}
                onClick={() => { action(); setMobileOpen(false); }}
                aria-current={isActive ? "page" : undefined}
                style={{ color: isActive ? "#467ed3" : "#374151" }}
                className="border-b border-[#F3F4F6] py-3.5 text-left text-[15px] font-medium transition-colors duration-150 hover:text-[#467ed3] focus:outline-none last:border-0"
              >
                {label}
              </button>
            );
          })}

          <div className="mt-4 flex flex-col gap-2.5">
            {user ? (
              <>
                <div className="flex items-center gap-3 rounded-xl bg-gray-50 px-3 py-2.5">
                  <span
                    style={{ backgroundColor: "#467ed3" }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
                  >
                    {userInitial}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-slate-900">{user.fullName}</div>
                    <div className="truncate text-[12px] text-gray-400">{user.email}</div>
                  </div>
                </div>

                {[
                  { Icon: LayoutDashboard, label: "Dashboard",     action: onDashboard,    always: true  },
                  { Icon: Headphones,      label: "My Recordings", action: onMyRecordings, always: false },
                  { Icon: Settings,        label: "Settings",      action: onSettings,     always: false },
                ].map(({ Icon, label, action, always }) =>
                  (always || action) ? (
                    <button
                      key={label}
                      onClick={() => { action?.(); setMobileOpen(false); }}
                      className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-left text-[14px] font-medium text-[#374151] transition-colors duration-150 hover:bg-gray-50 focus:outline-none"
                    >
                      <Icon className="h-4 w-4 text-gray-400" aria-hidden="true" />
                      {label}
                    </button>
                  ) : null
                )}

                <button
                  onClick={() => { onSignOut(); setMobileOpen(false); }}
                  className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-left text-[14px] font-medium text-red-600 transition-colors duration-150 hover:bg-red-50 focus:outline-none"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Sign Out
                </button>
              </>
            ) : (
              <button
                onClick={() => { onSignIn(); setMobileOpen(false); }}
                className="rounded-lg border border-[#E5E7EB] py-2.5 text-center text-[14px] font-medium text-[#374151] transition-colors duration-150 hover:border-[#467ed3] hover:text-[#467ed3] focus:outline-none"
              >
                Sign In
              </button>
            )}
          </div>

          <div className="mt-4 border-t border-[#F3F4F6] pt-4">
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-widest text-gray-400">
              Language
            </p>
            <div className="flex gap-2">
              {(
                [
                  { code: "EN" as Language, label: "English",  flag: "🇬🇧" },
                  { code: "SO" as Language, label: "Soomaali", flag: "🇸🇴" },
                ] as const
              ).map(({ code, label, flag }) => (
                <button
                  key={code}
                  onClick={() => selectLanguage(code)}
                  aria-pressed={language === code}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg border py-2.5 text-[13px] font-medium transition-colors duration-150 ${
                    language === code
                      ? "border-[#467ed3] bg-blue-50 text-[#467ed3]"
                      : "border-[#E5E7EB] text-[#374151] hover:border-[#467ed3] hover:text-[#467ed3]"
                  }`}
                >
                  <span aria-hidden="true">{flag}</span>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </nav>
      </div>
    </header>
  );
}
