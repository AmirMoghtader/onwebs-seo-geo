// @ts-nocheck
"use client";
export const dynamic = "force-static";
// Must run before any component calls into @tauri-apps/api in a plain browser.
import "./lib/browserShim";
import "@mantine/core/styles.css";
import "./globals.css";
import { MantineProvider } from "@mantine/core";
import MenuDrawer from "./components/ui/MenuDrawer";
import TopMenuBar from "./components/ui/TopMenuBar";
import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import Footer from "./components/ui/Footer";
import Loader from "@/components/Loader/Loader";
import { invoke } from "@tauri-apps/api/core";
import { usePathname } from "next/navigation";
import { UrlStatusChecker } from "./components/ui/URLchecker/URLchecker";
import NativeMenuBridge from "./components/ui/NativeMenuBridge";
import LanguageProvider from "./i18n/LanguageProvider";

// Uses the system font stack rather than next/font/google: fetching Roboto from
// Google at build time made the build depend on reaching fonts.googleapis.com.
// The Persian face (IRANSansX) is declared in globals.css and bundled locally.

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const pathname = usePathname();

  // GET THE THEME AND SET IT
  useEffect(() => {
    // On component mount, check local storage for dark mode preference
    const darkMode = localStorage?.getItem("dark-mode") === "true";
    setIsDarkMode(darkMode);

    // Add or remove the dark class on the root element
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  // Records the running version for other screens to read. The update check
  // itself is local-only in this build, so nothing leaves the machine here.
  useEffect(() => {
    const checkVersion = async () => {
      try {
        const version = await invoke("version_check_command");
        localStorage.setItem("app-version", version.local as string);
      } catch (err) {
        console.error("Failed to check version:", err);
      }
    };
    checkVersion();
  }, []);

  return (
    <html lang="en" className="min-w-[600px]" suppressHydrationWarning>
      <body
        className={`relative overflow-hidden rounded-md bg-gray-100 dark:bg-brand-darker/95 font-sans`}
        suppressHydrationWarning
      >
        <MantineProvider
          theme={{
            fontFamily:
              "IRANSansX, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Arial, sans-serif",
            headings: {
              fontFamily:
                "IRANSansX, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Arial, sans-serif",
            },
          }}
        >
          <LanguageProvider>
          {/* ChatBar removed: it was a public community chat room backed by a
              third-party Supabase project. */}
          {/* Real-height spacer for the fixed 44px top bar (+2px gap). A
              margin here collapses through empty blocks, and WebKit/Chromium
              disagree on how far that travels — a div with height doesn't. */}
          <div className="h-[46px]">
            <TopMenuBar />
          </div>
          {/* Menus live in the system menu bar now; this routes their clicks. */}
          <NativeMenuBridge />
          <UrlStatusChecker />
          <main className="rounded-md">
            {children}
            {pathname === "/ppc" ? "" : <Toaster />}
          </main>
          <Footer />
          <Loader />
          </LanguageProvider>
        </MantineProvider>
      </body>
    </html>
  );
}
