"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  ShieldCheck,
  Key,
  Globe,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";

interface GSCConnectionWizardProps {
  onComplete: () => void;
  onClose: () => void;
}

export default function GSCConnectionWizard({
  onComplete,
  onClose,
}: GSCConnectionWizardProps) {
  const [step, setStep] = useState(1);
  const [config, setConfig] = useState({
    clientId: "",
    projectId: "",
    clientSecret: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [properties, setProperties] = useState<string[]>([]);
  const [selectedProperty, setSelectedProperty] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");

  const handleNext = () => setStep((s) => s + 1);
  const handleBack = () => setStep((s) => s - 1);

  const handleImportJson = async () => {
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const { readTextFile } = await import("@tauri-apps/plugin-fs");

      const filePath = await openDialog({
        multiple: false,
        filters: [{ name: "Google OAuth Client", extensions: ["json"] }],
      });
      if (!filePath || typeof filePath !== "string") return;

      const raw = await readTextFile(filePath);
      const parsed = JSON.parse(raw);
      const info = parsed.installed || parsed.web || parsed;

      if (!info.client_id || !info.client_secret) {
        toast.error("این فایل شبیه JSON کلاینت OAuth گوگل نیست");
        return;
      }

      setConfig({
        clientId: info.client_id,
        projectId: info.project_id || "",
        clientSecret: info.client_secret,
      });
      toast.success("Client ID و Secret از فایل خوانده شد");
    } catch (error) {
      console.error("Import JSON error:", error);
      toast.error("خواندن فایل انتخاب‌شده ناموفق بود");
    }
  };

  const handleConnect = async () => {
    if (!config.clientId || !config.clientSecret) {
      toast.error("لطفاً Client ID و Client Secret را وارد کنید");
      return;
    }

    setIsLoading(true);
    try {
      // 1. Start local server to receive the code
      const port = await invoke<number>("start_gsc_auth_server");
      const redirectUri = `http://localhost:${port}`;

      // 2. Listen for the code from the backend
      const unlisten = await (
        await import("@tauri-apps/api/event")
      ).listen<string>("gsc-auth-code", async (event) => {
        const code = event.payload;
        try {
          // 3. Exchange code for token
          const tokenResponse = await invoke<string>("exchange_gsc_code", {
            code,
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            redirectUri,
          });
          const tokenData = JSON.parse(tokenResponse);
          const token = tokenData.access_token;
          const refresh = tokenData.refresh_token;

          setAccessToken(token);
          if (refresh) setRefreshToken(refresh);

          fetchProperties(token);
          unlisten();
        } catch (error) {
          console.error("Exchange error:", error);
          toast.error("تبدیل code به token ناموفق بود");
          setIsLoading(false);
          unlisten();
        }
      });

      // 4. Open Google Auth URL in system browser
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=https://www.googleapis.com/auth/webmasters.readonly&prompt=consent&access_type=offline`;

      const { open } = await import("@tauri-apps/plugin-shell");
      await open(authUrl);

      toast.info("در حال باز کردن ورود Google در مرورگر شما...");
    } catch (error) {
      console.error("OAuth error:", error);
      toast.error("شروع فرایند احراز هویت ناموفق بود");
      setIsLoading(false);
    }
  };

  const fetchProperties = async (token: string) => {
    try {
      const response = await fetch(
        "https://www.googleapis.com/webmasters/v3/sites",
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const data = await response.json();
      if (data.siteEntry) {
        setProperties(data.siteEntry.map((s: any) => s.siteUrl));
        setStep(4);
      } else {
        toast.error("هیچ property‌ای در Search Console پیدا نشد");
      }
    } catch (error) {
      console.error("Fetch properties error:", error);
      toast.error("دریافت propertyها ناموفق بود");
    } finally {
      setIsLoading(false);
    }
  };

  const handleFinalize = async () => {
    console.log("Finalizing GSC connection...", {
      clientId: config.clientId,
      projectId: config.projectId,
      selectedProperty,
      hasToken: !!accessToken,
    });
    if (!selectedProperty) {
      toast.error("لطفاً یک property انتخاب کنید");
      return;
    }

    setIsLoading(true);
    try {
      console.log("Invoking set_google_search_console_credentials...");
      // Save credentials and tokens to backend
      await invoke("set_google_search_console_credentials", {
        credentials: {
          clientId: config.clientId,
          projectId: config.projectId,
          clientSecret: config.clientSecret,
          url: selectedProperty,
          propertyType: selectedProperty.startsWith("sc-domain:")
            ? "domain"
            : "site",
          range: "3 months",
          rows: "99999", // Backend will fetch maximum regardless
          token: accessToken,
          refresh_token: refreshToken,
        },
      });
      console.log("Credentials saved successfully");

      toast.success("Search Console با موفقیت متصل شد!");
      console.log("Calling onComplete...");
      onComplete();
    } catch (error) {
      console.error("Finalize error:", error);
      toast.error("ذخیره تنظیمات اتصال ناموفق بود");
    } finally {
      setIsLoading(false);
    }
  };

  const stepVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 100 : -100,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (direction: number) => ({
      x: direction < 0 ? 100 : -100,
      opacity: 0,
    }),
  };

  return (
    <div className="flex flex-col min-h-[600px] w-full max-w-lg mx-auto overflow-hidden bg-white dark:bg-brand-darker rounded-2xl shadow-2xl border border-gray-100 dark:border-brand-dark">
      {/* Header */}
      <div className="p-6 border-b border-gray-100 dark:border-brand-dark flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
            <Search className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold dark:text-white">
              اتصال به Search Console
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Step {step} of 4
            </p>
          </div>
        </div>
        <button
          onClick={() => (step > 1 ? handleBack() : onClose())}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
      </div>

      {/* Progress Bar */}
      <div className="h-1 w-full bg-gray-100 dark:bg-brand-dark">
        <motion.div
          className="h-full bg-blue-600"
          initial={{ width: "25%" }}
          animate={{ width: `${(step / 4) * 100}%` }}
        />
      </div>

      {/* Content */}
      <div className="flex-1 p-8 relative overflow-hidden">
        <AnimatePresence mode="wait" custom={step}>
          {step === 1 && (
            <motion.div
              key="step1"
              custom={1}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="flex flex-col h-full text-left"
            >
              <div className="flex-1 flex flex-col items-start justify-center space-y-6">
                <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-full">
                  <ShieldCheck className="h-12 w-12 text-green-600 dark:text-green-400" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-bold dark:text-white">
                    دستیابی به بینش‌های عمیق
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                    Google Search Console خود را متصل کنید تا رتبه‌ها، impressions و clicks را به‌صورت لحظه‌ای در Onwebs SEO & GEO ببینید.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4 w-full pt-4">
                  <div className="p-3 bg-gray-50 dark:bg-brand-dark rounded-xl border border-gray-100 dark:border-brand-dark/50 text-left">
                    <Globe className="h-4 w-4 text-blue-500 mb-2" />
                    <p className="text-[10px] font-bold dark:text-white">
                      پوشش جهانی
                    </p>
                    <p className="text-[9px] text-gray-500">
                      رصد عملکرد در سراسر جهان
                    </p>
                  </div>
                  <div className="p-3 bg-gray-50 dark:bg-brand-dark rounded-xl border border-gray-100 dark:border-brand-dark/50 text-left">
                    <Key className="h-4 w-4 text-purple-500 mb-2" />
                    <p className="text-[10px] font-bold dark:text-white">
                      دسترسی امن
                    </p>
                    <p className="text-[9px] text-gray-500">
                      اتصال رسمی از طریق Google API
                    </p>
                  </div>
                </div>
              </div>
              <div className="pt-8">
                <Button
                  onClick={handleNext}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-6 rounded-xl group dark:bg-blue-600 dark:text-white dark:hover:bg-blue-600/90 hover:text-white"
                >
                  شروع کنید
                  <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
                </Button>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step2"
              custom={1}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="flex flex-col h-full"
            >
              <div className="flex-1 space-y-4">
                <div className="space-y-2">
                  <h3 className="text-lg font-bold dark:text-white">
                    پیکربندی API
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    جزئیات Google Cloud Project خود را وارد کنید. راهنمایی می‌خواهید؟
                    <a
                      href="#"
                      className="text-blue-600 ml-1 inline-flex items-center"
                    >
                      مشاهده راهنما <ExternalLink className="h-3 w-3 ml-1" />
                    </a>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleImportJson}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-blue-300 dark:border-blue-500/50 text-blue-600 dark:text-blue-400 text-xs font-bold hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Import client_secret.json
                </button>
                <div className="flex items-center gap-2 text-[10px] text-gray-400">
                  <div className="flex-1 h-px bg-gray-200 dark:bg-brand-dark" />
                  یا دستی وارد کنید
                  <div className="flex-1 h-px bg-gray-200 dark:bg-brand-dark" />
                </div>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      Client ID
                    </label>
                    <Input
                      value={config.clientId}
                      onChange={(e) =>
                        setConfig({ ...config, clientId: e.target.value })
                      }
                      placeholder="xxx-xxx.apps.googleusercontent.com"
                      className="bg-gray-50 dark:bg-brand-dark border-gray-200 dark:border-brand-dark py-6 dark:text-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      Project ID
                    </label>
                    <Input
                      value={config.projectId}
                      onChange={(e) =>
                        setConfig({ ...config, projectId: e.target.value })
                      }
                      placeholder="my-awesome-project"
                      className="bg-gray-50 dark:bg-brand-dark border-gray-200 dark:border-brand-dark py-6 dark:text-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      Client Secret
                    </label>
                    <Input
                      type="password"
                      value={config.clientSecret}
                      onChange={(e) =>
                        setConfig({ ...config, clientSecret: e.target.value })
                      }
                      placeholder="GOCSPX-xxxxxxxxxxxxxxxx"
                      className="bg-gray-50 dark:text-white  dark:bg-brand-dark border-gray-200 dark:border-brand-dark py-6"
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-3 pt-8">
                <Button
                  variant="ghost"
                  onClick={handleBack}
                  className="flex-1 py-6 rounded-xl bg-gray-200 hover:bg-gray-300 dark:bg-gray-200 dark:hover:bg-gray-300 dark:text-black"
                >
                  بازگشت
                </Button>
                <Button
                  onClick={handleNext}
                  className="flex-[2] bg-blue-600 hover:bg-blue-700 text-white py-6 rounded-xl dark:bg-blue-700 dark:text-white dark:hover:bg-brand-bright/90 dark:hover:text-white"
                >
                  ادامه
                </Button>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="step3"
              custom={1}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="flex flex-col h-full text-left"
            >
              <div className="flex-1 flex flex-col items-start justify-center space-y-8">
                <div className="p-6 bg-blue-50 dark:bg-blue-900/20 rounded-full animate-pulse">
                  <Key className="h-16 w-16 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-bold dark:text-white">
                    اجازه دسترسی
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    اکنون یک پنجره امن ورود Google باز می‌شود تا به Onwebs SEO & GEO اجازه خواندن داده‌های Search Console شما داده شود.
                  </p>
                </div>
                <Button
                  onClick={handleConnect}
                  disabled={isLoading}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-7 rounded-xl shadow-lg shadow-blue-500/30 dark:shadow-none flex items-center justify-center gap-3 transition-all active:scale-95"
                >
                  {isLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      <div className="bg-white p-1 rounded-full">
                        <img
                          src="/icon.png"
                          className="h-4 w-4"
                          alt="Google"
                        />
                      </div>
                      <span className="font-bold">اتصال با Google</span>
                    </>
                  )}
                </Button>
              </div>
              <div className="space-y-2 pt-8">
                <p className="text-[10px] text-gray-400">
                  Onwebs SEO & GEO تنها دسترسی فقط‌خواندنی به داده‌های Search Console شما درخواست می‌کند.
                </p>
                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/30 rounded-lg">
                  <p className="text-[10px] text-amber-800 dark:text-amber-200 flex items-center gap-1.5 justify-center">
                    <AlertCircle className="h-3 w-3" />
                    اگر پنجره باز نشد، بررسی کنید که popupها در تنظیمات شما مسدود نباشند.
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div
              key="step4"
              custom={1}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="flex flex-col h-full"
            >
              <div className="flex-1 space-y-6">
                <div className="space-y-2">
                  <h3 className="text-lg font-bold dark:text-white">
                    انتخاب Property
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Property وب‌سایتی را که می‌خواهید در این فضای کاری رصد کنید انتخاب کنید.
                  </p>
                </div>
                <div className="max-h-[220px] overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                  {properties.map((prop) => (
                    <button
                      key={prop}
                      onClick={() => setSelectedProperty(prop)}
                      className={`w-full p-4 rounded-xl border text-left transition-all flex items-center justify-between ${
                        selectedProperty === prop
                          ? "bg-blue-50 dark:bg-blue-900/30 border-blue-500 dark:border-blue-400 shadow-sm"
                          : "bg-gray-50 dark:bg-brand-dark border-gray-100 dark:border-brand-dark hover:border-gray-300"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Globe
                          className={`h-4 w-4 ${selectedProperty === prop ? "text-blue-600" : "text-gray-400"}`}
                        />
                        <span
                          className={`text-xs font-medium ${selectedProperty === prop ? "text-blue-900 dark:text-blue-100" : "text-gray-700 dark:text-gray-300"}`}
                        >
                          {prop}
                        </span>
                      </div>
                      {selectedProperty === prop && (
                        <CheckCircle2 className="h-4 w-4 text-blue-600" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div className="pt-8">
                <Button
                  onClick={handleFinalize}
                  disabled={isLoading || !selectedProperty}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-6 rounded-xl font-bold"
                >
                  {isLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    "Complete Setup"
                  )}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
