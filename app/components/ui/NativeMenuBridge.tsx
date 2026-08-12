// @ts-nocheck
"use client";

// Routes clicks from the native macOS menu bar to the app.
//
// The menus live in Rust now (src-tauri/src/app_menu.rs) so they sit in the
// system menu bar like every other Mac app. Each item emits `native_menu` with
// its id; this component turns that id into the same navigation or dialog the
// in-window menu used to trigger, so there is one behaviour rather than two.

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useVisibilityStore } from "@/store/VisibilityStore";
import { useLanguage } from "@/app/i18n/LanguageProvider";

// Mode is a route: single-page analysis lives at "/", the full-site crawler
// at "/global". Both Mode entries used to point at "/global", which is why
// there was no way back to single-page analysis from the menu.
const ROUTES: Record<string, string> = {
  "tools.imageConverter": "/images",
  "sitemaps.view": "/global",
  "mode.single": "/",
  "mode.spider": "/global",
};

const NativeMenuBridge = () => {
  const router = useRouter();
  const { setLang } = useLanguage();
  const {
    showSerpKeywords,
    showCustomSearch,
    showUrlChecker,
  } = useVisibilityStore();

  useEffect(() => {
    const p = listen("native_menu", (event: any) => {
      const id = String(event.payload || "");
      if (!id) return;

      // Anything with a plain destination just navigates.
      if (ROUTES[id]) {
        router.push(ROUTES[id]);
        return;
      }

      // List mode needs the setting on as well as the route, otherwise it
      // would just start an ordinary crawl.
      if (id === "mode.list") {
        invoke("update_settings_command", {
          updates: JSON.stringify({ list_mode: true }),
        })
          .then(() => {
            toast.success("حالت List فعال شد — آدرس‌ها را در تنظیمات وارد کنید");
            router.push("/global");
          })
          .catch(() => toast.error("تغییر حالت ناموفق بود"));
        return;
      }
      if (id === "mode.spider" || id === "mode.single") {
        // Leaving list mode on would silently limit the next crawl to a
        // stale URL list.
        invoke("update_settings_command", {
          updates: JSON.stringify({ list_mode: false }),
        }).catch(() => {});
      }

      if (id === "lang.en" || id === "lang.fa") {
        setLang(id === "lang.en" ? "en" : "fa");
        if (id === "lang.en") toast.success("Interface switched to English");
        return;
      }

      // Crawl controls talk to the backend directly — no modal involved.
      if (id === "crawl.pause" || id === "crawl.stop") {
        const cmd = id === "crawl.pause" ? "pause_crawl_command" : "stop_crawl_command";
        invoke(cmd)
          .then(() =>
            toast.success(id === "crawl.pause" ? "کراول موقتاً متوقف شد" : "کراول متوقف شد"),
          )
          .catch(() => toast.error("اجرای دستور ناموفق بود"));
        return;
      }
      if (id === "crawl.start") {
        // The Crawl button owns the URL in the address bar, so ask it to fire
        // rather than duplicating that state here.
        window.dispatchEvent(new CustomEvent("onwebs:startCrawl"));
        return;
      }

      switch (id) {
        case "view.toggleTheme": {
          const next = !(localStorage.getItem("dark-mode") === "true");
          localStorage.setItem("dark-mode", String(next));
          document.documentElement.classList.toggle("dark", next);
          break;
        }

        case "view.urlChecker":
          showUrlChecker?.();
          break;

        case "config.customSearch":
          showCustomSearch?.();
          break;

        case "tools.serpKeywords":
          showSerpKeywords?.();
          break;

        // The dialogs these open are owned by TopMenuBar, which listens for
        // this event on the window and opens the matching modal. Re-emitting
        // as a DOM event keeps that wiring local to the component that owns
        // the modal state instead of lifting it all up here.
        case "file.openCrawl":
        case "file.saveCrawl":
        case "file.settings":
        case "file.openConfigFolder":
        case "config.crawlConfig":
        case "config.include":
        case "config.exclude":
        case "config.speed":
        case "config.userAgent":
        case "config.customExtraction":
        case "view.panes":
        case "vis.open":
        case "tools.diffChecker":
        case "conn.searchConsole":
        case "conn.analytics":
        case "conn.clarity":
        case "conn.powerBi":
        case "conn.ollama":
        case "conn.gemini":
        case "help.about":
        case "help.suggestion":
        case "reports.crawlPdf":
          window.dispatchEvent(new CustomEvent("onwebs:menu", { detail: id }));
          break;

        default:
          if (id.startsWith("reports.") || id.startsWith("bulk.")) {
            window.dispatchEvent(new CustomEvent("onwebs:menu", { detail: id }));
          } else {
            toast.message(`منوی «${id}» هنوز به عملی وصل نشده است`);
          }
      }
    });

    return () => {
      p.then((unlisten) => unlisten());
    };
  }, [router, setLang, showSerpKeywords, showCustomSearch, showUrlChecker]);

  return null;
};

export default NativeMenuBridge;
