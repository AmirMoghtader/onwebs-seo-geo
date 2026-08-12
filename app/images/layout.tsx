export const dynamic = "force-static";
import MenuDrawer from "../components/ui/MenuDrawer";
import type React from "react";
import type { Metadata } from "next";
import { ThemeProvider } from "./components/theme-provider";

// Uses the system font stack rather than next/font/google: fetching Roboto from
// Google at build time made the build depend on reaching fonts.googleapis.com.

export default function ImagesLayout({ children }: any) {
  return (
    <main className={`-mt-20 h-screen flex flex-col font-sans`}>
      <div className=" w-full bg-white border-b dark:border-b-brand-dark h-11 flex-none dark:bg-brand-darker">
        <div className="pt-2">
          <MenuDrawer />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </main>
  );
}
