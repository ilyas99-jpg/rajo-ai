import { useEffect, useRef, useState } from "react";
import {
  BarChart2,
  ChevronDown,
  Globe,
  LogOut,
  Menu,
  Settings,
  User,
  X,
} from "lucide-react";
import { useLanguage, type AppLanguage } from "../i18n";
import type { RegisteredUser } from "../types";

type View = "home" | "about" | "auth" | "dashboard" | "record" | "profile" | "contributions" | "settings";

export interface NavbarProps {
  activeView: View;
  user: RegisteredUser | null;
  avatarUrl?: string;
  onHome: () => void;
  onAbout: () => void;
  onHowItWorks: () => void;
  onDataset: () => void;
  onFaq: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onProfile: () => void;
  onContributions: () => void;
  onSettings: () => void;
}

function AvatarBubble({
  avatarUrl,
  initial,
  size,
}: {
  avatarUrl?: string;
  initial: string;
  size: "sm" | "md";
}) {
  const dim = size === "sm" ? "h-8 w-8 text-[13px]" : "h-[30px] w-[30px] text-[12px]";
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt="Profile"
        className={`${dim} rounded-full object-cover ring-2 ring-white`}
      />
    );
  }
  return (
    <span
      style={{ backgroundColor: "#467ed3" }}
      className={`flex ${dim} shrink-0 items-center justify-center rounded-full font-bold text-white`}
    >
      {initial}
    </span>
  );
}

export function Navbar({
  activeView,
  user,
  avatarUrl,
  onHome,
  onAbout,
  onHowItWorks,
  onDataset,
  onFaq,
  onSignIn,
  onSignOut,
  onProfile,
  onContributions,
  onSettings,
}: NavbarProps) {
  const [scrolled, setScrolled]             = useState(false);
  const [mobileOpen, setMobileOpen]         = useState(false);
  const [userDropdownOpen, setUserDropdown] = useState(false);
  const [langDropdownOpen, setLangDropdown] = useState(false);
  const { language, setLanguage, t }        = useLanguage();

  const userRef             = useRef<HTMLDivElement>(null);
  const langRef             = useRef<HTMLDivElement>(null);
  const mobileDropdownRef   = useRef<HTMLDivElement>(null);
  const mobileAvatarBtnRef  = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      const t = e.target as Node;
      // Close user dropdown only when the tap/click lands outside every
      // element that belongs to the user-menu system (desktop wrapper,
      // mobile dropdown panel, mobile avatar trigger button).
      const insideDesktop       = userRef.current?.contains(t)           ?? false;
      const insideMobilePanel   = mobileDropdownRef.current?.contains(t) ?? false;
      const insideMobileAvatar  = mobileAvatarBtnRef.current?.contains(t) ?? false;
      if (!insideDesktop && !insideMobilePanel && !insideMobileAvatar) {
        setUserDropdown(false);
      }
      if (langRef.current && !langRef.current.contains(t)) {
        setLangDropdown(false);
      }
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

  function selectLanguage(lang: AppLanguage) {
    setLanguage(lang);
    setLangDropdown(false);
    setMobileOpen(false);
  }

  const navLinks = [
    { label: t("nav.home"),       view: "home"  as View, action: onHome },
    { label: t("nav.about"),      view: "about" as View, action: onAbout },
    { label: t("nav.howItWorks"), view: null,             action: onHowItWorks },
    { label: t("nav.dataset"),    view: null,             action: onDataset },
    { label: t("nav.faq"),        view: null,             action: onFaq },
  ];

  const userInitial = user?.fullName?.[0]?.toUpperCase() ?? "U";
  const firstName   = user?.fullName?.split(" ")[0] ?? "";
  const resolvedAvatar = avatarUrl ?? user?.avatarUrl;

  const dropdownItems = [
    { Icon: User,      label: t("nav.profile"),        action: onProfile },
    { Icon: BarChart2, label: t("nav.contributions"),  action: onContributions },
    { Icon: Settings,  label: t("nav.settings"),       action: onSettings },
  ];
  const languageCode = language === "en" ? "EN" : "SO";

  return (
    <header
      role="banner"
      className={`sticky top-0 z-30 h-[68px] border-b border-[#E5E7EB] bg-white/[0.97] transition-all duration-300 ease-out ${
        scrolled ? "shadow-[0_2px_20px_rgba(0,0,0,0.06)] backdrop-blur-md" : ""
      }`}
    >
      {/* ── Main bar ────────────────────────────────────────────────── */}
      {/* flex-1 trick: left flex-1 | center auto | right flex-1 justify-end */}
      <div className="mx-auto flex h-full max-w-6xl items-center px-4 sm:px-5 lg:px-8">

        {/* Left: logo — flex-1 keeps it anchored left */}
        <div className="flex flex-1 items-center">
        <button
          onClick={onHome}
          aria-label="Rajo AI – go to home"
          className="flex shrink-0 items-center border-0 bg-transparent p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#467ed3]/30 focus-visible:rounded-md"
        >
          <img
            src="/logo%20rajo%20ai.png"
            alt="Rajo AI"
            className="h-11 w-auto object-contain"
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
        </div>

        {/* Center: nav links (desktop) */}
        <nav aria-label="Main navigation" className="hidden items-center gap-8 md:flex">
          {navLinks.map(({ label, view, action }) => {
            const isActive = view !== null && activeView === view;
            return (
              <button
                key={label}
                onClick={action}
                aria-current={isActive ? "page" : undefined}
                style={{ color: isActive ? "#467ed3" : "#4B5563" }}
                className="group relative pb-[3px] text-[14px] font-medium tracking-wide transition-colors duration-200 ease-out hover:text-[#467ed3] focus:outline-none"
              >
                {label}
                <span
                  aria-hidden="true"
                  style={{ backgroundColor: "#467ed3" }}
                  className={`absolute bottom-0 left-0 h-[2px] rounded-full transition-all duration-200 ease-out ${
                    isActive ? "w-full" : "w-0 group-hover:w-full"
                  }`}
                />
              </button>
            );
          })}
        </nav>

        {/* Right: language + auth controls — flex-1 + justify-end pushes to far right */}
        <div className="flex flex-1 items-center justify-end gap-1">

          {/* Language switcher (desktop) */}
          <div className="relative hidden md:block" ref={langRef}>
            <button
              onClick={() => { setLangDropdown((v) => !v); setUserDropdown(false); }}
              aria-haspopup="listbox"
              aria-expanded={langDropdownOpen}
              aria-label={`${t("nav.language")}: ${language === "en" ? "English" : "Af-Soomaali"}`}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-[#4B5563] transition-all duration-200 hover:bg-[#F3F6FB] hover:text-[#467ed3] focus:outline-none"
            >
              <Globe className="h-[14px] w-[14px]" aria-hidden="true" />
              <span>{languageCode}</span>
              <ChevronDown
                aria-hidden="true"
                className={`h-[11px] w-[11px] transition-transform duration-200 ${langDropdownOpen ? "rotate-180" : ""}`}
              />
            </button>

            {langDropdownOpen && (
              <div
                role="listbox"
                aria-label={t("nav.selectLanguage")}
                className="absolute right-0 top-full mt-2 w-44 overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-[0_8px_24px_rgba(0,0,0,0.08)]"
              >
                {(
                  [
                    { code: "en" as AppLanguage, label: "English",  sub: "English",     flag: "🇬🇧" },
                    { code: "so" as AppLanguage, label: "Soomaali", sub: "Af-Soomaali", flag: "🇸🇴" },
                  ] as const
                ).map(({ code, label, sub, flag }) => (
                  <button
                    key={code}
                    role="option"
                    aria-selected={language === code}
                    onClick={() => selectLanguage(code)}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors duration-150 hover:bg-blue-50 ${
                      language === code ? "font-semibold text-[#467ed3]" : "font-medium text-[#374151]"
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

          {/* Divider */}
          <div className="mx-2 hidden h-5 w-px bg-gray-200 md:block" aria-hidden="true" />

          {/* User avatar (desktop) or Sign In */}
          {user ? (
            <div className="relative hidden md:block" ref={userRef}>
              <button
                onClick={() => { setUserDropdown((v) => !v); setLangDropdown(false); }}
                aria-haspopup="menu"
                aria-expanded={userDropdownOpen}
                aria-label={`Account menu for ${user.fullName}`}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-all duration-200 hover:bg-[#F3F6FB] focus:outline-none focus:ring-2 focus:ring-[#467ed3]/30"
              >
                <AvatarBubble avatarUrl={resolvedAvatar} initial={userInitial} size="md" />
                <span className="max-w-[72px] truncate text-[13px] font-medium text-[#374151]">
                  {firstName}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={`h-[11px] w-[11px] text-gray-400 transition-transform duration-200 ${userDropdownOpen ? "rotate-180" : ""}`}
                />
              </button>

              {userDropdownOpen && (
                <div
                  role="menu"
                  aria-label="User actions"
                  className="absolute right-0 top-full mt-2.5 w-52 overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_12px_32px_rgba(0,0,0,0.1)]"
                >
                  <div className="border-b border-[#F3F4F6] px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <AvatarBubble avatarUrl={resolvedAvatar} initial={userInitial} size="sm" />
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold text-slate-900">{user.fullName}</div>
                        <div className="truncate text-[11px] text-gray-400">{user.email}</div>
                      </div>
                    </div>
                  </div>

                  <div className="py-1.5">
                    {dropdownItems.map(({ Icon, label, action }) => (
                      <button
                        key={label}
                        role="menuitem"
                        onClick={() => { action(); setUserDropdown(false); }}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] font-medium text-[#374151] transition-colors duration-150 hover:bg-gray-50 focus:outline-none"
                      >
                        <Icon className="h-[15px] w-[15px] text-gray-400" aria-hidden="true" />
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="border-t border-[#F3F4F6] py-1.5">
                    <button
                      role="menuitem"
                      onClick={() => { onSignOut(); setUserDropdown(false); }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] font-medium text-red-500 transition-colors duration-150 hover:bg-red-50 focus:outline-none"
                    >
                      <LogOut className="h-[15px] w-[15px]" aria-hidden="true" />
                      {t("nav.signOut")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={onSignIn}
              className="hidden rounded-lg border border-[#D1D5DB] bg-white px-4 py-[7px] text-[13px] font-medium text-[#374151] shadow-sm transition-all duration-200 hover:border-[#467ed3] hover:text-[#467ed3] hover:shadow-none focus:outline-none focus:ring-2 focus:ring-[#467ed3]/30 md:block"
            >
              {t("nav.signIn")}
            </button>
          )}

          {/* Mobile: avatar (if logged in) + hamburger — always right-aligned */}
          <div className="flex items-center gap-2 md:hidden">
            {user && (
              <button
                ref={mobileAvatarBtnRef}
                onClick={() => { setUserDropdown((v) => !v); setMobileOpen(false); }}
                aria-label={`Account menu for ${user.fullName}`}
                aria-haspopup="menu"
                aria-expanded={userDropdownOpen}
                className="flex h-9 w-9 items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-[#467ed3]/30"
              >
                <AvatarBubble avatarUrl={resolvedAvatar} initial={userInitial} size="sm" />
              </button>
            )}
            <button
              onClick={() => { setMobileOpen((v) => !v); setUserDropdown(false); }}
              aria-expanded={mobileOpen}
              aria-controls="navbar-mobile-menu"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[#374151] transition-colors duration-150 active:bg-gray-100 focus:outline-none"
            >
              {mobileOpen
                ? <X    className="h-[19px] w-[19px]" aria-hidden="true" />
                : <Menu className="h-[19px] w-[19px]" aria-hidden="true" />
              }
            </button>
          </div>
        </div>
      </div>

      {/* Mobile avatar dropdown */}
      {user && userDropdownOpen && (
        <div
          ref={mobileDropdownRef}
          role="menu"
          aria-label="User actions"
          className="absolute right-4 top-[68px] z-50 w-56 overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_16px_40px_rgba(0,0,0,0.12)] md:hidden"
        >
          <div className="border-b border-[#F3F4F6] px-4 py-3.5">
            <div className="flex items-center gap-3">
              <AvatarBubble avatarUrl={resolvedAvatar} initial={userInitial} size="sm" />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-slate-900">{user.fullName}</div>
                <div className="truncate text-[11px] text-gray-400">{user.email}</div>
              </div>
            </div>
          </div>
          <div className="py-1.5">
            {dropdownItems.map(({ Icon, label, action }) => (
              <button
                key={label}
                role="menuitem"
                onClick={() => { action(); setUserDropdown(false); }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] font-medium text-[#374151] transition-colors duration-150 hover:bg-gray-50 focus:outline-none"
              >
                <Icon className="h-[15px] w-[15px] text-gray-400" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          <div className="border-t border-[#F3F4F6] py-1.5">
            <button
              role="menuitem"
              onClick={() => { onSignOut(); setUserDropdown(false); }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] font-medium text-red-500 transition-colors duration-150 hover:bg-red-50 focus:outline-none"
            >
              <LogOut className="h-[15px] w-[15px]" aria-hidden="true" />
              {t("nav.signOut")}
            </button>
          </div>
        </div>
      )}

      {/* ── Mobile menu ─────────────────────────────────────────────── */}
      <div
        id="navbar-mobile-menu"
        aria-hidden={!mobileOpen}
        className={`absolute left-0 right-0 top-[68px] z-40 overflow-hidden border-b border-[#E5E7EB] bg-white transition-all duration-300 ease-in-out md:hidden ${
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

          {!user && (
            <div className="mt-4">
              <button
                onClick={() => { onSignIn(); setMobileOpen(false); }}
                className="w-full rounded-xl border border-[#E5E7EB] py-2.5 text-center text-[14px] font-medium text-[#374151] transition-colors duration-150 hover:border-[#467ed3] hover:text-[#467ed3] focus:outline-none"
              >
                {t("nav.signIn")}
              </button>
            </div>
          )}

          <div className="mt-4 border-t border-[#F3F4F6] pt-4">
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-widest text-gray-400">
              {t("nav.language")}
            </p>
            <div className="flex gap-2">
              {(
                [
                  { code: "en" as AppLanguage, label: "English",  flag: "🇬🇧" },
                  { code: "so" as AppLanguage, label: "Soomaali", flag: "🇸🇴" },
                ] as const
              ).map(({ code, label, flag }) => (
                <button
                  key={code}
                  onClick={() => selectLanguage(code)}
                  aria-pressed={language === code}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-xl border py-2.5 text-[13px] font-medium transition-colors duration-150 ${
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
