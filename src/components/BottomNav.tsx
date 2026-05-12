import { BarChart2, Home, Mic, Settings } from "lucide-react";
import type { RegisteredUser } from "../types";

type AppView =
  | "home"
  | "about"
  | "auth"
  | "dashboard"
  | "record"
  | "profile"
  | "contributions"
  | "settings";

interface BottomNavProps {
  activeView: AppView;
  user: RegisteredUser | null;
  onDashboard: () => void;
  onRecord: () => void;
  onContributions: () => void;
  onSettings: () => void;
}

const APP_VIEWS: AppView[] = [
  "dashboard",
  "record",
  "profile",
  "contributions",
  "settings",
];

export function BottomNav({
  activeView,
  user,
  onDashboard,
  onRecord,
  onContributions,
  onSettings,
}: BottomNavProps) {
  if (!user || !APP_VIEWS.includes(activeView)) return null;

  const items = [
    {
      icon: Home,
      label: "Home",
      view: "dashboard" as AppView,
      action: onDashboard,
    },
    {
      icon: Mic,
      label: "Record",
      view: "record" as AppView,
      action: onRecord,
      primary: true,
    },
    {
      icon: BarChart2,
      label: "Stats",
      view: "contributions" as AppView,
      action: onContributions,
    },
    {
      icon: Settings,
      label: "Settings",
      view: "settings" as AppView,
      action: onSettings,
    },
  ];

  return (
    <nav
      aria-label="App navigation"
      className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200/80 bg-white/[0.96] backdrop-blur-md md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-center justify-around px-2 pt-1.5 pb-1">
        {items.map(({ icon: Icon, label, view, action, primary }) => {
          const isActive = activeView === view;
          return (
            <button
              key={view}
              onClick={action}
              aria-label={label}
              aria-current={isActive ? "page" : undefined}
              className="group flex flex-1 flex-col items-center justify-center gap-1 rounded-xl py-1.5 focus:outline-none active:scale-95 transition-transform duration-100"
            >
              {primary ? (
                <span
                  className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-all duration-150 ${
                    isActive
                      ? "bg-[#467ed3] shadow-[0_4px_16px_rgba(70,126,211,0.45)] text-white"
                      : "bg-[#467ed3]/10 text-[#467ed3] group-active:bg-[#467ed3]/20"
                  }`}
                  aria-hidden="true"
                >
                  <Icon className="h-5 w-5" />
                </span>
              ) : (
                <>
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors duration-150 ${
                      isActive
                        ? "text-[#467ed3]"
                        : "text-slate-400 group-active:text-slate-700"
                    }`}
                    aria-hidden="true"
                  >
                    <Icon className="h-[22px] w-[22px]" />
                  </span>
                  <span
                    className={`text-[10px] font-bold transition-colors duration-150 ${
                      isActive ? "text-[#467ed3]" : "text-slate-400"
                    }`}
                  >
                    {label}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
