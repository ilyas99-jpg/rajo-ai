import { useEffect, useState } from "react";
import { Download, Share2, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const STORAGE_KEY = "rajo-install-dismissed";
const DISMISS_DAYS = 30;

function isDismissed(): boolean {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    if (!val) return false;
    return Date.now() - parseInt(val, 10) < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

function isInStandaloneMode(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in window.navigator &&
      (window.navigator as { standalone?: boolean }).standalone === true)
  );
}

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isDismissed() || isInStandaloneMode()) return;

    const ios =
      /iphone|ipad|ipod/i.test(navigator.userAgent) &&
      !("MSStream" in window);

    if (ios) {
      setIsIOS(true);
      setVisible(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {}
    setVisible(false);
  }

  async function install() {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setDeferredPrompt(null);
        dismiss();
      }
    } catch {}
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Install RAJO AI app"
      className="fixed bottom-[76px] left-3 right-3 z-50 mx-auto max-w-sm rounded-2xl border border-[#467ed3]/20 bg-white p-4 shadow-[0_8px_40px_rgba(70,126,211,0.2)] md:bottom-6 md:left-auto md:right-6 md:max-w-xs"
    >
      <div className="flex items-start gap-3">
        <img
          src="/icons/pwa-64x64.png"
          alt=""
          aria-hidden="true"
          className="h-10 w-10 shrink-0 rounded-xl"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-slate-900">Install RAJO AI</p>
          {isIOS ? (
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Tap{" "}
              <Share2
                className="inline h-3 w-3 align-[-1px] text-[#467ed3]"
                aria-label="Share"
              />{" "}
              then <strong className="text-slate-700">"Add to Home Screen"</strong>
            </p>
          ) : (
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Add to your home screen for the best experience.
            </p>
          )}
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {!isIOS && deferredPrompt && (
        <button
          onClick={() => void install()}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#467ed3] py-2.5 text-sm font-black text-white transition-colors hover:bg-[#3567b8] focus:outline-none focus:ring-2 focus:ring-[#467ed3]/30 active:scale-[0.98]"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Install App
        </button>
      )}
    </div>
  );
}
