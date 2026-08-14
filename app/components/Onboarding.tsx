// @ts-nocheck
"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Rocket,
  Shield,
  X,
  Zap,
  FileCode,
  Layers,
  ScrollText,
  PlugZap,
  Key,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import confetti from "canvas-confetti";
import { GitHubLogoIcon } from "@radix-ui/react-icons";

const steps = [
  {
    id: 1,
    title: "Welcome to Onwebs SEO & GEO.",
    description:
      "Your complete marketing solution — built for SEO and GEO professionals who want it all, in one smart toolkit.",
    icon: Rocket,
    imageSrc: "icon.png",
  },
  {
    id: 2,
    title: "Shallow Crawl (single page)",
    description:
      "Granular page analysis with AI-driven insights and performance recommendations. Identify and resolve issues with precision.",
    icon: FileCode,
    imageSrc: "shallow.png",
  },
  {
    id: 3,
    title: "Deep Crawl (bulk)",
    description:
      "Crawl your entire website and get actionable insights. Onwebs SEO & GEO detects errors and delivers smart solutions. Discover your website\'s deepest secrets.",
    icon: Layers,
    imageSrc: "deep.png",
  },
  {
    id: 4,
    title: "Log Analyser",
    description:
      "A powerful feature that enables you to analyze your server logs (Apache/Nginx) and gain actionable insights. Discover crawler timings, visit frequencies, and content taxonomies.",
    icon: ScrollText,
    imageSrc: "log.png",
  },
  {
    id: 5,
    title: "Connectors & Integrations",
    description:
      "Extend Onwebs SEO & GEO\'s capabilities by integrating with your favorite tools — PageSpeed Insights, Google Search Console, Google Analytics, Microsoft Clarity, Power BI, and more.",
    icon: PlugZap,
    imageSrc: "integrations.png",
    // Each connector needs a key the user has to go and fetch. Saying so here,
    // with the actual steps, beats a settings screen with an empty box and no
    // clue where the value comes from.
    guides: [
      {
        name: "Open PageRank — امتیاز اعتبار دامنه",
        // The one that ships with a working default, which is exactly why it
        // needs explaining: the shared key runs out.
        note:
          "این یکی از ابتدا کار می‌کند، ولی با کلیدی مشترک که سهمیه‌اش بین همهٔ کاربران تقسیم می‌شود. کلید خودت را بگیر تا سهمیهٔ اختصاصی داشته باشی.",
        steps: [
          "به openpagerank.keywordseverywhere.com برو",
          "با حساب Keywords Everywhere وارد شو (ساختنش رایگان است و کارت بانکی نمی‌خواهد)",
          "در داشبورد، یک OPR API Key بساز و کپی کن",
          "در Onwebs: تنظیمات ← کانکتورها ← Open PageRank و کلید را جای‌گذاری کن",
        ],
        limit: "رایگان: ۳۰٬۰۰۰ دامنه در ماه",
      },
      {
        name: "Google Search Console — کلیک، ایمپرشن و رتبه",
        steps: [
          "به console.cloud.google.com برو و یک پروژه بساز",
          "در APIs & Services ← Library، سرویس «Search Console API» را Enable کن",
          "در Credentials یک OAuth Client ID از نوع Desktop app بساز",
          "فایل JSON را دانلود کن و در Onwebs از تنظیمات ← کانکتورها ← Search Console واردش کن",
          "دکمهٔ اتصال را بزن و در مرورگر به سایتی که در Search Console تأیید کرده‌ای دسترسی بده",
        ],
        limit: "رایگان — فقط برای سایت‌هایی که مالکیتشان را تأیید کرده‌ای",
      },
      {
        name: "Google Analytics — ترافیک ارگانیک",
        steps: [
          "در همان پروژهٔ Google Cloud، سرویس «Google Analytics Data API» را Enable کن",
          "همان OAuth Client ID مرحلهٔ قبل قابل استفاده است",
          "شناسهٔ Property را از Analytics ← Admin ← Property Settings بردار (عددی است، نه G-)",
          "در Onwebs: تنظیمات ← کانکتورها ← Analytics و شناسه را وارد کن",
        ],
        limit: "رایگان",
      },
      {
        name: "PageSpeed Insights — Core Web Vitals",
        steps: [
          "در همان پروژهٔ Google Cloud، سرویس «PageSpeed Insights API» را Enable کن",
          "در Credentials یک API Key بساز",
          "در Onwebs: تنظیمات ← کانکتورها ← PageSpeed و کلید را وارد کن",
        ],
        limit: "بدون کلید ~۱ درخواست در ثانیه؛ با کلید ۲۵٬۰۰۰ در روز",
      },
      {
        name: "Microsoft Clarity — رفتار کاربر",
        steps: [
          "به clarity.microsoft.com برو و پروژه‌ات را باز کن",
          "Settings ← Data Export ← Generate new API token",
          "توکن را در Onwebs: تنظیمات ← کانکتورها ← Clarity وارد کن",
        ],
        limit: "رایگان — ۱۰ درخواست در روز",
      },
    ],
  },
  {
    id: 6,
    title: "Keyword Tracking & Content Exploration",
    description:
      "Track your keywords, identify patterns and receive new content ideas and recommendations as you optimise your pages with contextual awareness.",
    icon: Key,
    imageSrc: "tracking.png",
  },
  {
    id: 7,
    title: "And more...",
    description:
      "Onwebs SEO & GEO offers a wide range of advanced features and integrations. Help us improve by contributing and giving us feedback.",
    icon: CheckCircle,
    imageSrc: "more.png",
  },
];

export default function Onboarding({ onComplete }) {
  const [currentStep, setCurrentStep] = useState(1);
  const [completed, setCompleted] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    const onboardingCompleted = localStorage.getItem("onboarding") === "true";

    if (!onboardingCompleted) {
      const timer = setTimeout(() => {
        setShowOnboarding(true);
      }, 1);

      return () => clearTimeout(timer);
    }
  }, []);

  const completeOnboarding = () => {
    localStorage.setItem("onboarding", "true");
    setShowOnboarding(false);
  };

  const handleNext = () => {
    if (currentStep < steps.length) {
      setCurrentStep(currentStep + 1);
    } else {
      setCompleted(true);

      onComplete();
      completeOnboarding();
      confetti({
        particleCount: 150,
        spread: 90,
        origin: { y: 0.6 },
        colors: ["#8B5CF6", "#3B82F6", "#A78BFA"],
        zIndex: 9999,
      });
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleReset = () => {
    setCurrentStep(1);
    setCompleted(false);
  };

  const handleClose = () => {
    completeOnboarding();
  };

  if (!showOnboarding) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[999999999999] bg-black/50 !transform-none">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-4xl">
          <section className="w-full h-[450px] border-0 shadow-lg bg-white dark:bg-slate-900 rounded-lg overflow-hidden flex flex-col">
            <div className="bg-gradient-to-r relative flex h-10 from-blue-600 to-purple-600 text-white">
              <CardTitle className="text-2xl font-bold p-1.5 pl-4 text-white dark:text-white z-0">
                راهنمای شروع
              </CardTitle>
              {/* <X */}
              {/*   className="absolute right-4 top-2 cursor-pointer" */}
              {/*   onClick={handleClose} */}
              {/* /> */}
            </div>

            <CardContent className="p-6 flex-1 overflow-auto z-0">
              <div className="mb-6">
                <div className="flex justify-between mb-2">
                  {steps.map((step) => (
                    <div
                      key={step.id}
                      className={`flex-1 h-1 rounded-full mx-1 ${
                        step.id <= currentStep
                          ? "bg-gradient-to-r from-blue-500 to-purple-500"
                          : "bg-gray-200"
                      }`}
                    />
                  ))}
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>شروع</span>
                  <span>پایان</span>
                </div>
              </div>

              <div className="h-[250px]">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentStep}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.3 }}
                    className="h-full flex flex-col md:flex-row items-center justify-center gap-8"
                  >
                    {!completed ? (
                      <>
                        <div className="flex-1 flex flex-col items-center md:items-start text-center md:text-left">
                          <div className="mb-4 p-3 rounded-full bg-gradient-to-r from-blue-100 to-purple-100">
                            {steps[currentStep - 1] &&
                              (() => {
                                const IconComponent =
                                  steps[currentStep - 1].icon;
                                return (
                                  <IconComponent className="h-4 w-4 text-blue-600" />
                                );
                              })()}
                          </div>
                          <h3 className="text-2xl font-bold mb-3 dark:text-white">
                            {steps[currentStep - 1]?.title}
                          </h3>
                          <p className="text-gray-600 mb-4">
                            {steps[currentStep - 1]?.description}
                          </p>

                          {/* Connector setup, spelled out. A key box with no
                              instructions is where onboarding usually dies. */}
                          {steps[currentStep - 1]?.guides && (
                            <div
                              dir="rtl"
                              className="w-full text-right space-y-3 max-h-[320px] overflow-y-auto pr-1 mb-4"
                            >
                              {steps[currentStep - 1].guides.map((guide) => (
                                <details
                                  key={guide.name}
                                  className="rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-3 py-2"
                                >
                                  <summary className="cursor-pointer text-sm font-bold dark:text-white list-none flex items-center justify-between gap-2">
                                    <span>{guide.name}</span>
                                    <span className="text-[10px] font-normal text-gray-500 shrink-0">
                                      {guide.limit}
                                    </span>
                                  </summary>
                                  {guide.note && (
                                    <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
                                      {guide.note}
                                    </p>
                                  )}
                                  <ol className="mt-2 space-y-1 text-[11px] text-gray-600 dark:text-white/70 list-decimal pr-4">
                                    {guide.steps.map((line) => (
                                      <li key={line}>{line}</li>
                                    ))}
                                  </ol>
                                </details>
                              ))}
                            </div>
                          )}
                          <section className="w-full flex items-center">
                            <p className="text-sm text-gray-500">
                              {currentStep === 1
                                ? "Let's get started with a few simple steps."
                                : currentStep === 2
                                  ? "Perfect for on-page, off-page, and technical SEO."
                                  : currentStep === 3
                                    ? "Great for bulk analysis and optimisation"
                                    : currentStep === 4
                                      ? "Perfect for crawl budget analysis"
                                      : currentStep === 5
                                        ? "A one-stop solution for all your SEO needs"
                                        : currentStep === 6
                                          ? "Great for content optimisation"
                                          : currentStep === 7
                                            ? "Enjoy it, and let us know what you think! Find us on "
                                            : "Keep all your data in one place"}{" "}
                            </p>
                            {currentStep === 7 && (
                              <a
                                href="https://github.com/mascanho/RustySEO"
                                target="_blank"
                                rel="noreferrer"
                                className="inline-block ml-2"
                              >
                                <GitHubLogoIcon className="h-5 w-5 text-gray-500" />
                              </a>
                            )}
                          </section>
                        </div>
                        <div className="flex-1 flex justify-center items-center h-full">
                          <div
                            className={`${currentStep === 1 ? "w-40" : " w-80"} h-auto relative rounded-lg overflow-hidden`}
                          >
                            <img
                              src={
                                steps[currentStep - 1]?.imageSrc ||
                                "/hero.jpg"
                              }
                              alt={`Illustration for ${steps[currentStep - 1]?.title}`}
                              className={`${currentStep === 1 ? "object-fit" : "object-cover"} w-full h-full`}
                            />
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="w-full flex flex-col md:flex-row items-center justify-center gap-8">
                        <div className="flex-1 flex flex-col items-center md:items-start text-center md:text-left">
                          <div className="mb-4 p-4 rounded-full bg-gradient-to-r from-blue-100 to-purple-100">
                            <CheckCircle className="h-5 w-5 text-purple-600" />
                          </div>
                          <h3 className="text-2xl font-bold mb-3">تمام شد!</h3>
                          <p className="text-gray-600 mb-4">
                            راهنمای شروع را کامل کردید.
                          </p>
                          <div className="flex space-x-2">
                            <Button
                              onClick={handleReset}
                              className="mt-2 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600"
                            >
                              شروع دوباره
                            </Button>
                            <Button
                              variant="outline"
                              className="mt-2"
                              onClick={handleClose}
                            >
                              بستن
                            </Button>
                          </div>
                        </div>
                        <div className="flex-1 flex justify-center items-center h-full">
                          <div className="w-full h-[250px] relative rounded-lg overflow-hidden shadow-md">
                            <img
                              src="/hero.jpg"
                              alt="راهنمای شروع کامل شد"
                              className="object-cover w-full h-full"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </CardContent>

            {!completed && (
              <CardFooter className="flex justify-between border-t dark:border-t-brand-dark p-3 px-6">
                <Button
                  variant="outline"
                  onClick={handlePrevious}
                  disabled={currentStep === 1}
                  className="flex items-center gap-1 dark:text-white dark:bg-brand-dark h-7"
                >
                  <ChevronLeft className="h-4 w-4 dark:text-white" /> بازگشت
                </Button>
                <Button
                  onClick={handleNext}
                  className="bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 flex items-center gap-1 dark:text-white  h-7"
                >
                  {currentStep === steps.length ? "Finish" : "Next"}{" "}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </CardFooter>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
