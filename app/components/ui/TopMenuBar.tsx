// @ts-nocheck
"use client";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@/components/ui/menubar";
import { Alert, Drawer, MenuItem, Modal } from "@mantine/core";
import Todo from "./Todo";
import { useDisclosure } from "@mantine/hooks";
import TodoItems from "./TodoItems";
import { useCallback, useEffect, useState } from "react";
import PageSpeedInsigthsApi from "../PageSpeedInsigthsApi";
import openBrowserWindow from "@/app/Hooks/OpenBrowserWindow";
import OllamaSelect from "./OllamaSelector/OllamaSelect";
import GSCConnectionWizard from "./GSCcontainer/GSCConnectionWizard";
import GA4ConnectionWizard from "./GA4container/GA4ConnectionWizard";
import { usePathname, useRouter } from "next/navigation";
import WindowToggler from "./Panes/WindowToggler";
import GeminiSelector from "./GeminiSelector/GeminiSelector";
import About from "./About/About";
import SuggestionBox from "./Suggestion/SuggestionBox";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { generateCrawlReportPDF } from "./TopMenuBar/CrawlReport/generateCrawlReportPDF";
import ReportsMenu from "./TopMenuBar/Reports/ReportsMenu";
import CrawlConfig from "./SettingsModal/CrawlConfig/CrawlConfig";
import BulkExportMenu from "./TopMenuBar/BulkExport/BulkExportMenu";
import { saveCrawl, openCrawl } from "./TopMenuBar/CrawlFile/crawlFile";
import useGlobalCrawlStore, { useDataActions } from "@/store/GlobalCrawlDataStore";
import { generateServerLogReportPDF } from "./TopMenuBar/ServerLogReport/generateServerLogReportPDF";
import { LuPanelRight } from "react-icons/lu";
import {
  FiFile,
  FiEye,
  FiCheckSquare,
  FiBarChart2,
  FiFileText,
  FiZap,
  FiTool,
  FiHelpCircle,
  FiLogOut,
  FiGlobe,
  FiSearch,
  FiMessageSquare,
} from "react-icons/fi";
import { GiRobotGrab, GiSpiderBot } from "react-icons/gi";
import { FaRegLightbulb, FaRegMoon } from "react-icons/fa";
import { AiOutlineShareAlt, AiOutlinePrinter } from "react-icons/ai";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useVisibilityStore } from "@/store/VisibilityStore";
import KeywordSerp from "./TopMenuBar/KeywordSerp";
import Configurations from "./TopMenuBar/Configurations/Configurations";
import { FaGear } from "react-icons/fa6";
import MSClarity from "./MSClarityModal/MSClarityModal";
import SettingsModal from "./SettingsModal/SettingsModal";
import { getCurrentWindow } from "@tauri-apps/api/window";
import CustomSearchSelector from "./Extractors/CustomSearchSelector";
import { PiGitDiff } from "react-icons/pi";
import DiffChecker from "./DiffChecker/DiffChecker";
import { GoFileDiff } from "react-icons/go";
import { Settings } from "lucide-react";
import PowerBi from "./MSClarityModal/PowerBi";
import { useOnboardingStore } from "@/store/OnboardingStore";
import { BiDoorOpen, BiLogoSlackOld } from "react-icons/bi";
import { CiFolderOn, CiSettings } from "react-icons/ci";
import { UrlStatusChecker } from "./URLchecker/URLchecker";
import { MdOutlineHttps } from "react-icons/md";
import VisualisationsModal from "./Visualisations/VisualisationsModal";

const TopMenuBar = () => {
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isGeneratingServerLogReport, setIsGeneratingServerLogReport] =
    useState(false);
  const pathname = usePathname();

  const {
    visibility,
    showSerpKeywords,
    hideSerpKeywords,
    showCustomSearch,
    hideCustomSearch,
    showChangelog,
    showUrlChecker,
  } = useVisibilityStore();

  const router = useRouter();
  // Theme
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    const theme = localStorage?.getItem("dark-mode");
    if (theme === "true") {
      // Changed to string comparison
      setIsDarkMode(true);
    } else {
      setIsDarkMode(false);
    }
  }, []);

  const [openedPageSpeed, { open: openPageSpeed, close: closePageSpeed }] =
    useDisclosure(false);
  const [openedDrawer, { open: openDrawer, close: closeDrawer }] =
    useDisclosure(false);
  const [openedModal, { open: openModal, close: closeModal }] =
    useDisclosure(false);
  const [url, setUrl] = useState<string>("");
  const [strategy, setStrategy] = useState("");

  const [openedOllama, { open: openOllama, close: closeOllama }] =
    useDisclosure(false);
  const [openedGemini, { open: openGemini, close: closeGemini }] =
    useDisclosure(false);
  const [openedPanes, { open: openPanes, close: closePanes }] =
    useDisclosure(false);
  const [openedAbout, { open: openAbout, close: closeAbout }] =
    useDisclosure(false);
  const [
    openedSuggestion,
    { open: openSuggestion, close: closeSuggestion },
  ] = useDisclosure(false);

  const [
    openedSearchConsole,
    { open: openSearchConsole, close: closeSearchConsole },
  ] = useDisclosure(false);

  const [openedMSClarity, { open: openMSClarity, close: closeMSClarity }] =
    useDisclosure(false);

  const [openedPowerBi, { open: openPowerBi, close: closePowerBi }] =
    useDisclosure(false);

  const [
    openedGoogleAnalytics,
    { open: openGoogleAnalytics, close: closeGoogleAnalytics },
  ] = useDisclosure(false);

  const [openedCrawlConfig, { open: openCrawlConfig, close: closeCrawlConfig }] =
    useDisclosure(false);

  const [openedConfs, { open: openConfs, close: closeConfs }] =
    useDisclosure(false);

  const [openedSettings, { open: openSettings, close: closeSettings }] =
    useDisclosure(false);

  // Diff Crawl Checker
  const [
    openedDiffChecker,
    { open: openDiffChecker, close: closeDiffChecker },
  ] = useDisclosure(false);

  // Visualisations Hub
  const [
    openedVisualisations,
    { open: openVisualisations, close: closeVisualisations },
  ] = useDisclosure(false);

  // HANDLE ONBOARDING MODAL
  const [showOnboarding, setShowOnboarding] = useState(false);
  const completed = useOnboardingStore((state) => state.completed);

  useEffect(() => {
    const fetchUrlFromSessionStorage = () => {
      const urlSession: any = window?.sessionStorage?.getItem("url");
      const strategySession: any = window?.sessionStorage?.getItem("strategy");
      setUrl(urlSession || "");
      setStrategy(strategySession || "DESKTOP");
    };

    fetchUrlFromSessionStorage();

    return () => {
      // Cleanup logic if needed
    };
  }, [openModal, openedModal, url, strategy]);

  // CHANGE THEME
  const toggleDarkMode = () => {
    const newMode = !isDarkMode;
    setIsDarkMode(newMode);
    localStorage?.setItem("dark-mode", newMode.toString());
    if (newMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  useEffect(() => {
    const savedMode = localStorage?.getItem("dark-mode");
    if (savedMode !== null) {
      const parsedMode = savedMode === "true";
      setIsDarkMode(parsedMode);
      if (parsedMode) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }
  }, []);

  // File > Save / Open Crawl. The crawl database only keeps the most recent
  // run, so this is what lets a crawl outlive the next one.
  const crawlRows = useGlobalCrawlStore((st) => st.crawlData);
  const { setDomainCrawlData } = useDataActions();

  const handleSaveCrawl = async () => {
    try {
      const path = await saveCrawl(crawlRows || []);
      if (path) toast.success(`کراول ذخیره شد (${crawlRows.length} صفحه)`);
    } catch (e: any) {
      if (e?.message === "EMPTY") {
        toast.error("کراولی برای ذخیره نیست — اول یک کراول اجرا کنید");
      } else {
        console.error(e);
        toast.error("ذخیره کراول ناموفق بود");
      }
    }
  };

  const handleOpenCrawl = async () => {
    try {
      const file = await openCrawl();
      if (!file) return;
      setDomainCrawlData(file.rows);
      toast.success(
        `کراول بازشد: ${file.domain} — ${file.pageCount} صفحه`,
        { description: file.savedAt ? `ذخیره‌شده در ${file.savedAt.slice(0, 10)}` : undefined },
      );
    } catch (e: any) {
      const why =
        e?.message === "NOT_JSON"
          ? "فایل خراب است یا JSON نیست"
          : e?.message === "NOT_A_CRAWL"
            ? "این فایل، فایل کراول نیست"
            : e?.message === "NEWER_VERSION"
              ? "این فایل با نسخه‌ی جدیدتری ساخته شده"
              : "باز کردن فایل ناموفق بود";
      toast.error(why);
    }
  };

  // The native menu bar (src-tauri/src/app_menu.rs) forwards its clicks here,
  // because the modals they open are owned by this component. One handler, so
  // the native menu and the buttons in this bar never drift apart.
  useEffect(() => {
    const onMenu = (e: any) => {
      switch (e?.detail) {
        case "file.openCrawl": handleOpenCrawl(); break;
        case "file.saveCrawl": handleSaveCrawl(); break;
        case "file.openConfigFolder": handleOpenSettingsFolder(); break;
        case "file.settings":
        case "config.crawlConfig":
        case "config.include":
        case "config.exclude":
        case "config.speed":
        case "config.userAgent":
        case "config.customExtraction": openSettings(); break;
        case "view.panes": openPanes(); break;
        case "vis.open": openVisualisations(); break;
        case "tools.diffChecker": openDiffChecker(); break;
        case "conn.searchConsole": openSearchConsole(); break;
        case "conn.analytics": openGoogleAnalytics(); break;
        case "conn.clarity": openMSClarity(); break;
        case "conn.powerBi": openPowerBi(); break;
        case "conn.ollama": openOllama(); break;
        case "conn.gemini": openGemini(); break;
        case "help.about": openAbout(); break;
        case "help.suggestion": openSuggestion(); break;
        case "reports.crawlPdf": handleGenerateReport(); break;
        default: break;
      }
    };
    window.addEventListener("onwebs:menu", onMenu);
    return () => window.removeEventListener("onwebs:menu", onMenu);
  });

  // Generate the full crawl PDF report (on-page SEO, technical health,
  // issues, performance and a full page inventory in one document).
  const handleGenerateReport = async () => {
    if (isGeneratingReport) return;
    setIsGeneratingReport(true);
    const toastId = toast.loading("در حال تولید گزارش کراول…");
    try {
      const result = await generateCrawlReportPDF();
      if (result.success) {
        toast.success(result.message, { id: toastId });
      } else {
        toast.message(result.message, { id: toastId });
      }
    } catch (error) {
      console.error("Failed to generate crawl report:", error);
      toast.error("تولید گزارش کراول ناموفق بود.", { id: toastId });
    } finally {
      setIsGeneratingReport(false);
    }
  };

  // Generate the full server log PDF report (traffic, crawlers, status
  // codes, file types, bandwidth, bot categories, crawl-sync/SEO health,
  // and top-N breakdowns, with charts, in one document).
  const handleGenerateServerLogReport = async () => {
    if (isGeneratingServerLogReport) return;
    setIsGeneratingServerLogReport(true);
    const toastId = toast.loading("در حال تولید گزارش لاگ سرور…");
    try {
      const result = await generateServerLogReportPDF();
      if (result.success) {
        toast.success(result.message, { id: toastId });
      } else {
        toast.message(result.message, { id: toastId });
      }
    } catch (error) {
      console.error("Failed to generate server log report:", error);
      toast.error("تولید گزارش لاگ سرور ناموفق بود.", { id: toastId });
    } finally {
      setIsGeneratingServerLogReport(false);
    }
  };

  const handleAddTodo = (url: string, strategy: string) => {
    setUrl(url); // Changed from setTodoUrl
    setStrategy(strategy); // Changed from setTodoStrategy
    openModal();
  };

  // OPEN Configurations FILE USING NATIVE TEXT EDITOR
  async function handleOpenConfigFile() {
    try {
      await invoke("open_configs_with_native_editor");
      console.log("Config file opened successfuylly");
    } catch (error) {
      console.error("failed to open the file", error);
      // TODO: Implement better UI error handling
    }
  }

  // Sync with localstorage to avoid double click
  useEffect(() => {
    // Sync with localStorage on mount
    const savedValue = localStorage.getItem("onboarding") === "true";
    if (savedValue !== completed) {
      useOnboardingStore.setState({ completed: savedValue });
    }

    // Listen for storage events (changes from other tabs)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "onboarding") {
        useOnboardingStore.setState({ completed: e.newValue === "true" });
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  // Handles the click on the menu
  const handleOnboarding = () => {
    // Get current state directly from the store
    const currentState = useOnboardingStore.getState().completed;

    // Calculate new value
    const newValue = !currentState;

    // Update both localStorage and Zustand store
    localStorage.setItem("onboarding", String(newValue));
    useOnboardingStore.setState({ completed: newValue });
  };

  // handle the click to openm the settings folder
  const handleOpenSettingsFolder = useCallback(async () => {
    try {
      await invoke("open_config_folder_command");
      console.log("Settings folder opened successfully");
    } catch (error) {
      console.error("Failed to open the settings folder", error);
    }
  }, []);

  return (
    <>
      {/* Panes Insights Modal */}
      <Modal
        opened={openedPanes}
        closeOnEscape
        closeOnClickOutside
        onClose={closePanes}
        title="تغییر وضعیت پنل‌ها"
        centered
      >
        <WindowToggler />
      </Modal>

      {/* PageSpeed Insights Modal */}
      <Modal
        opened={openedPageSpeed}
        closeOnEscape
        closeOnClickOutside
        onClose={closePageSpeed}
        title="API key مربوط به Page Speed Insights"
        centered
      >
        <PageSpeedInsigthsApi close={closePageSpeed} />
      </Modal>

      {/* MS CLARITY MODAL */}
      <Modal
        opened={openedMSClarity}
        closeOnEscape
        closeOnClickOutside
        onClose={closeMSClarity}
        title="کانکتور Microsoft Clarity"
        centered
      >
        <MSClarity close={closeMSClarity} />
      </Modal>

      {/* MS  Power BI MODAL */}
      <Modal
        opened={openedPowerBi}
        closeOnEscape
        closeOnClickOutside
        onClose={closePowerBi}
        title="کانکتور Microsoft Power BI"
        centered
      >
        <PowerBi close={closePowerBi} />
      </Modal>

      {/* Todo Modal */}
      <Modal
        opened={openedModal}
        closeOnEscape
        closeOnClickOutside
        onClose={closeModal}
        title=""
        centered
      >
        <Todo url={url} close={closeModal} strategy={strategy} />
      </Modal>

      {/* Ollama Model */}
      <Modal
        opened={openedOllama}
        closeOnEscape
        closeOnClickOutside
        onClose={closeOllama}
        title="انتخاب‌گر مدل Ollama"
        centered
        size={"500px"}
      >
        <OllamaSelect closeOllama={closeOllama} />
      </Modal>

      {/* Gemini Model */}
      <Modal
        opened={openedGemini}
        closeOnEscape
        closeOnClickOutside
        onClose={closeGemini}
        centered
        size={"500px"}
        padding={0}
        radius="lg"
        withCloseButton={false}
        styles={{
          content: { background: "transparent" },
        }}
      >
        <GeminiSelector closeGemini={closeGemini} />
      </Modal>

      {/* About Section */}
      <Modal
        opened={openedAbout}
        closeOnEscape
        closeOnClickOutside
        onClose={closeAbout}
        centered
        size={"500px"}
        padding={0}
        radius="lg"
        withCloseButton={false}
        styles={{
          content: {
            background: "transparent",
            border: "none",
            boxShadow: "none",
          },
        }}
      >
        <About close={closeAbout} />
      </Modal>

      <Modal
        opened={openedCrawlConfig}
        onClose={closeCrawlConfig}
        title="Crawl Config"
        centered
        size="820px"
        padding={0}
        radius="md"
        zIndex={9999999}
      >
        <CrawlConfig onClose={closeCrawlConfig} />
      </Modal>

      {/* Drawer */}
      <Drawer
        offset={8}
        radius="md"
        opened={openedDrawer}
        onClose={closeDrawer}
        title=""
        size="sm"
        position="left"
        shadow="xl"
        style={{ paddingTop: "5rem" }}
        closeOnEscape
        closeOnClickOutside
      >
        <TodoItems url={url} strategy={strategy} />
      </Drawer>

      {/* GOOGLE SEARCH CONSOLE MODAL */}
      <Modal
        opened={openedSearchConsole}
        onClose={closeSearchConsole}
        withCloseButton={false}
        padding={0}
        radius="xl"
        centered
        size="lg"
        styles={{
          content: {
            backgroundColor: "transparent",
            boxShadow: "none",
            border: "none",
          },
          body: {
            padding: 0,
            backgroundColor: "transparent",
          },
          inner: {
            padding: 0,
          },
          root: {
            zIndex: 9999999999,
          },
        }}
        overlayProps={{ backgroundOpacity: 0.01, blur: 0 }}
      >
        <GSCConnectionWizard
          onComplete={closeSearchConsole}
          onClose={closeSearchConsole}
        />
      </Modal>

      {/* GOOGLE Analytics Modal */}
      <Modal
        opened={openedGoogleAnalytics}
        onClose={closeGoogleAnalytics}
        withCloseButton={false}
        padding={0}
        radius="xl"
        centered
        size="lg"
        styles={{
          content: {
            backgroundColor: "transparent",
            boxShadow: "none",
            border: "none",
          },
          body: {
            padding: 0,
            backgroundColor: "transparent",
          },
          inner: {
            padding: 0,
          },
          root: {
            zIndex: 9999999999,
          },
        }}
        overlayProps={{ backgroundOpacity: 0.01, blur: 0 }}
      >
        <GA4ConnectionWizard
          onComplete={closeGoogleAnalytics}
          onClose={closeGoogleAnalytics}
        />
      </Modal>

      {/* Configurations Modal */}
      <Modal
        size={"850px"}
        opened={openedConfs}
        onClose={closeConfs}
        centered
        padding={0}
        radius="lg"
        withCloseButton={false}
        styles={{
          content: { background: "transparent" },
        }}
      >
        <Configurations close={closeConfs} />
      </Modal>

      {/* Settings (GUI) Modal */}
      <Modal
        size={"1050px"}
        opened={openedSettings}
        onClose={closeSettings}
        centered
        padding={0}
        radius="lg"
        withCloseButton={false}
        styles={{
          content: { background: "transparent" },
        }}
      >
        <SettingsModal close={closeSettings} />
      </Modal>

      {/* Native-like Diff Checker Modal */}
      <Modal
        opened={openedDiffChecker}
        onClose={closeDiffChecker}
        title="بررسی تفاوت کراول‌ها"
        size="60%"
        overlayProps={{
          backgroundOpacity: 0.55,
          blur: 3,
          zIndex: 20,
        }}
        transitionProps={{
          transition: "fade",
          duration: 200,
          timingFunction: "ease",
        }}
        styles={{
          header: {
            backgroundColor: isDarkMode ? "#171717" : "#f8f9fa",
            borderBottom: isDarkMode
              ? "1px solid #2d3748"
              : "1px solid #e2e8f0",
            padding: "0.2rem",
          },
          content: {
            backgroundColor: isDarkMode ? "#171717" : "#ffffff",
            border: isDarkMode ? "1px solid #2d3748" : "1px solid #e2e8f0",
            borderRadius: "0.5rem",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.15)",
            maxHeight: "100%",
            padding: 0,
            marginTop: "10rem",
            height: "37rem",
            overflow: "hidden",
          },
          body: {
            padding: 0,
            height: "100%",
          },
        }}
        closeButtonProps={{
          color: isDarkMode ? "gray" : "dark",
          size: "md",
          right: 10,
        }}
      >
        <DiffChecker />
      </Modal>

      {/* Visualisations Hub */}
      <VisualisationsModal
        opened={openedVisualisations}
        onClose={closeVisualisations}
      />

      {/* Custom Search rule manager */}
      <Modal
        opened={visibility.customSearch}
        closeOnEscape
        closeOnClickOutside
        onClose={hideCustomSearch}
        centered
        size={"640px"}
        padding={0}
        radius="lg"
        withCloseButton={false}
        styles={{
          content: {
            background: "transparent",
            border: "none",
            boxShadow: "none",
          },
        }}
      >
        <CustomSearchSelector close={hideCustomSearch} />
      </Modal>

      <Menubar className="hidden fixed w-full top-0 z-[999999999] p-0 pl-0 dark:bg-brand-darker dark:text-white/50 text-black/70 bg-white dark:border-b-brand-dark border-b pb-1 font-mono font-light">
        <section className="flex w-full justify-end -ml-3 space-x-1 cursor-pointer">
          <MenubarMenu>
            <MenubarTrigger className="ml-4 text-xs">فایل</MenubarTrigger>
            <MenubarContent className="z-[999999999999999]">
              <MenubarItem onClick={handleOpenCrawl}>
                <FiFile className="mr-2" />
                Open Crawl…
              </MenubarItem>
              <MenubarItem onClick={handleSaveCrawl}>
                <FiFile className="mr-2" />
                Save Crawl…
              </MenubarItem>
              <MenubarSeparator />
              <MenubarItem onClick={handleOpenSettingsFolder}>
                <CiFolderOn
                  className=" text-sm mr-1.5 "
                  style={{ marginLeft: "-1px" }}
                />
                Open Settings Folder
              </MenubarItem>
              {/* NOTE: ONly stays here for dev purposes */}
              {/* <MenubarItem onClick={handleOpenConfigFile}> */}
              {/*   <CiSettings */}
              {/*     className=" text-sm mr-1.5 " */}
              {/*     style={{ marginLeft: "-1px" }} */}
              {/*   /> */}
              {/*   Crawler settings (TOML) */}
              {/* </MenubarItem> */}
              <MenubarItem onClick={openSettings}>
                <CiSettings
                  className=" text-sm mr-1.5 "
                  style={{ marginLeft: "-1px" }}
                />
                Settings (GUI)
              </MenubarItem>
              <MenubarItem onClick={() => getCurrentWindow().close()}>
                <FiLogOut className="mr-2" />
                Exit
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="ml-4 text-xs">نما</MenubarTrigger>
            <MenubarContent className="z-[999999999999999]">
              <MenubarItem
                disabled={pathname === "/global"}
                onClick={openPanes}
              >
                <FiEye className="mr-2" />
                Panels
              </MenubarItem>
              <MenubarSeparator />
              <MenubarItem onClick={toggleDarkMode}>
                {isDarkMode ? (
                  <>
                    <FaRegLightbulb className="mr-2" /> حالت روشن
                  </>
                ) : (
                  <>
                    <FaRegMoon className="mr-2" /> حالت تیره
                  </>
                )}
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="ml-3">وظایف</MenubarTrigger>
            <MenubarContent className="z-[999999999999999]">
              <MenubarItem onClick={openModal}>
                <FiCheckSquare className="mr-2" />
                New task
                <MenubarShortcut>⌘T</MenubarShortcut>
              </MenubarItem>
              <MenubarSeparator />
              <MenubarItem onClick={openDrawer}>
                <LuPanelRight className="mr-2" />
                View all tasks
                <MenubarShortcut>
                  <LuPanelRight />
                </MenubarShortcut>
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="ml-3 text-xs">Bulk Export</MenubarTrigger>
            <MenubarContent className="z-[999999999999999]">
              <BulkExportMenu />
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="ml-3 text-xs">گزارش‌ها</MenubarTrigger>
            <MenubarContent className="z-[999999999999999]">
              <MenubarItem
                onClick={handleGenerateReport}
                disabled={isGeneratingReport}
              >
                <FiFileText className="mr-2" />
                {isGeneratingReport
                  ? "Generating report…"
                  : "Generate Crawl Report (PDF)"}
              </MenubarItem>
              <MenubarItem
                onClick={handleGenerateServerLogReport}
                disabled={isGeneratingServerLogReport}
              >
                <FiFileText className="mr-2" />
                {isGeneratingServerLogReport
                  ? "Generating report…"
                  : "Server Log Report"}
              </MenubarItem>

              {/* Screaming Frog's Reports menu — each one exports a CSV slice
                  of the current crawl. */}
              <ReportsMenu />
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="ml-3 text-xs">ابزارها</MenubarTrigger>
            <MenubarContent className="z-[999999999999999]">
              <MenubarItem onClick={() => router.push("/images")}>
                <FiTool className="mr-2" />
                Image Converter
              </MenubarItem>
              {/* <MenubarItem onClick={showSerpKeywords}> */}
              {/*   <FiTool className="mr-2" /> */}
              {/*   Headings SERP */}
              {/* </MenubarItem> */}
              <MenubarItem onClick={() => router.push("/ppc")}>
                <FiTool className="mr-2" />
                Google Ads Sim.
              </MenubarItem>
              <MenubarItem onClick={showUrlChecker}>
                <MdOutlineHttps className="mr-2 font-semibold" />
                HTTP Checker
              </MenubarItem>
              <MenubarSeparator />
              <MenubarItem
                disabled={pathname !== "/global"}
                onClick={openDiffChecker}
              >
                <GoFileDiff className="mr-2 font-semibold" />
                Crawl Diff
              </MenubarItem>
              <MenubarSeparator />
              <MenubarItem onClick={() => router.push("/serverlogs")}>
                <GoFileDiff className="mr-2 font-semibold" />
                تحلیلگر لاگ
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="ml-3 text-xs">اتصال‌ها</MenubarTrigger>
            <MenubarContent className="z-[999999999999999]">
              <MenubarItem onClick={openMSClarity}>
                <FiZap className="mr-2" />
                Microsoft Clarity
              </MenubarItem>
              <MenubarItem onClick={openPowerBi}>
                <FiZap className="mr-2" />
                MS Power BI
              </MenubarItem>
              <MenubarSeparator />
              <MenubarItem onClick={openPageSpeed}>
                <FiZap className="mr-2" />
                PageSpeed Insights
              </MenubarItem>
              <MenubarItem onClick={openGoogleAnalytics}>
                <FiZap className="mr-2" />
                Google Analytics
              </MenubarItem>
              <MenubarItem onClick={openSearchConsole}>
                <FiZap className="mr-2" />
                Search Console
              </MenubarItem>
              <MenubarSeparator />
              <MenubarItem className="flex items-center" onClick={openOllama}>
                <FiZap className="mr-2" />
                Ollama{" "}
                <span className="text-[10px] dark:text-gray-300/50 text-black/50 mt-[2px] ml-1">
                  (AI Models)
                </span>
              </MenubarItem>
              <MenubarItem className="flex items-center" onClick={openGemini}>
                <FiZap className="mr-2" />
                Google Gemini
              </MenubarItem>
              <MenubarSeparator />
              <MenubarItem onClick={openConfs}>
                <FiTool className="mr-2" />
                تنظیمات اتصال
              </MenubarItem>
              <MenubarItem onClick={openCrawlConfig}>
                <FaGear className="mr-2" />
                Crawl Config
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="ml-3 text-xs">Crawlerها</MenubarTrigger>
            <MenubarContent className="z-[999999999999999]">
              <MenubarItem onClick={() => router.push("/")}>
                <GiSpiderBot className="mr-2" />
                Crawler سطحی
              </MenubarItem>
              <MenubarItem onClick={() => router.push("/global")}>
                <GiSpiderBot className="mr-2" />
                Crawler عمیق
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="ml-3 text-xs">استخراج‌کننده‌ها</MenubarTrigger>
            <MenubarContent className="z-[999999999999999]">
              <MenubarItem
                className={`mr-2 ${pathname !== "/global" ? "text-gray-400 pointer-events-none w-full" : "w-full"}`}
                onClick={showCustomSearch}
                disabled={pathname !== "/global"}
              >
                <GiRobotGrab className="mr-2" />
                جستجوی سفارشی
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>

          {/* VISUALISATIONS */}

          <MenubarMenu>
            <MenubarTrigger className="ml-3 text-xs">
              نمودارها
            </MenubarTrigger>
            <MenubarContent className="z-[999999999999999]">
              <MenubarItem
                className={`mr-2 ${pathname !== "/global" ? "text-gray-400 pointer-events-none w-full" : "w-full"}`}
                onClick={openVisualisations}
                disabled={pathname !== "/global"}
              >
                <FiBarChart2 className="mr-2" />
                Crawl Visualisations
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="ml-3 text-xs">راهنما</MenubarTrigger>
            <MenubarContent className="z-[999999999999999]">
              {/* <MenubarItem */}
              {/*   onClick={() => */}
              {/*     openBrowserWindow("https://github.com/mascanho/Ruddit-Client") */}
              {/*   } */}
              {/* > */}
              {/*   <FiHelpCircle className="mr-2" /> */}
              {/*   Atalaia */}
              {/* </MenubarItem> */}
              {/* <MenubarSeparator /> */}
              <MenubarItem onClick={handleOnboarding}>
                <BiDoorOpen className="mr-2" />
                راهنمای شروع
              </MenubarItem>
              <MenubarItem onClick={showChangelog}>
                <BiLogoSlackOld className="mr-2" />
                تغییرات
              </MenubarItem>
              <MenubarItem onClick={openAbout}>
                <FiHelpCircle className="mr-2" />
                About
              </MenubarItem>
              {/* "Send a Suggestion" removed: it POSTed the text you typed to
                  a third-party Supabase project. */}
            </MenubarContent>
          </MenubarMenu>
        </section>
      </Menubar>
    </>
  );
};

export default TopMenuBar;
