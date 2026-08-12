// @ts-nocheck
import React, {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
} from "react";
import { debounce, throttle } from "lodash";
import TableCrawl from "./components/TableCrawl";
import InternalTable from "./InternalTable/InternalTable";
import TabContextMenu from "./TabContextMenu";
import { useTabStripScroll } from "./useTabStripScroll";
import FilteredTab from "./FilteredTabs/FilteredTab";
import { useTabOrder } from "./useTabOrder";
import { FILTER_SETS } from "./FilteredTabs/filterSets";
import { buildInternalRows } from "./InternalTable/buildInternalRows";
import TableCrawlJs from "./JavascriptTable/TableCrawlJs";
import ImagesCrawlTable from "./ImagesTable/ImagesCrawlTable";
import UrlDetailsPane from "./SubTables/DetailsTable/UrlDetailsPane";
import SerpSnippet from "./SubTables/SerpSnippet/SerpSnippet";
import InlinksSubTable from "./SubTables/LinksSubtable/InlinksSubTable";
import OutlinksSubTable from "./SubTables/LinksSubtable/OutlinksSubTable";
import ImagesTable from "./SubTables/ImagesTable/ImagesTable";
import SchemaSubTable from "./SubTables/SchemaSubTable/SchemaSubTable";
import ResizableDivider from "./components/ResizableDivider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useVisibilityStore } from "@/store/VisibilityStore";
import useGlobalCrawlStore, {
  useDataActions,
} from "@/store/GlobalCrawlDataStore";
import ResponseHeaders from "./SubTables/Headers/ResponseHeaders";
import TableCrawlCSS from "../Sidebar/CSSTable/TableCrawlCSS";
import LinksTable from "./LinksTable/LinksTable";
import KeywordsTable from "./KeywordsTable/KeywordsTable";
import CoreWebVitalsTable from "./CoreWebVitalsTable/CoreWebVitalsTable";
import InnerLinksDetailsTable from "./SubTables/InnerLinksTable/InnerLinksDetailsTable";

import { shallow } from "zustand/shallow";
import OuterLinksSubTable from "./SubTables/OuterLinksSubTable/OuterLinksSubTable";
import RedirectsTable from "./RedirectsTable/RedirectsTable";
import FilesTable from "./FilesTable/FilesTable";
import OpenGraphPreview from "./SubTables/OpenGraphPreview/OpenGraphPreview";
import PageInternalSubTable from "./SubTables/PageLinksSubTable/PageInternalSubTable";
import PageExternalSubTable from "./SubTables/PageLinksSubTable/PageExternalSubTable";
import TableCustomSearch from "./CustomSearchTable/TableCustomSearch";
import { useCustomSearchRules } from "@/app/components/ui/Extractors/useCustomSearchRules";
import { invoke } from "@tauri-apps/api/core";

const EMPTY_ARRAY: any[] = [];
const DEFAULT_LIVE_DATA_LIMIT = 5000;


const BottomTableContent = ({ children, height }) => (
  <div
    style={{
      height: `${height - 34}px`,
      minHeight: "100px",
      overflowY: "auto",
      marginBottom: "0px", // Reduced from 60px
    }}
  >
    {children}
  </div>
);

export default function Home() {
  const [containerHeight, setContainerHeight] = useState(770);
  const [bottomTableHeight, setBottomTableHeight] = useState(218);
  const inlinksTableRef = useRef(null);
  const outlinksTableRef = useRef(null);
  const pageInternalTableRef = useRef(null);
  const pageExternalTableRef = useRef(null);
  const [activeBottomTab, setActiveBottomTab] = useState("details");
  const containerRef = useRef<HTMLDivElement>(null);

  const { visibility } = useVisibilityStore();

  // Consolidated selector: subscribe to all needed data slices in one call.
  // This means only ONE subscription fires per store update, and `shallow`
  // prevents re-renders when unrelated slices change.
  const {
    selectedTableURL,
    issuesView,
    issuesData,
    inlinks,
    outlinks,
    storeDeepCrawlTab,
    isFinishedDeepCrawl,
  } = useGlobalCrawlStore(
    (state) => ({
      selectedTableURL: state.selectedTableURL,
      issuesView: state.issuesView,
      issuesData: state.issuesData,
      inlinks: state.inlinks,
      outlinks: state.outlinks,
      storeDeepCrawlTab: state.deepCrawlTab,
      isFinishedDeepCrawl: state.isFinishedDeepCrawl,
    }),
    shallow,
  );

  // Consolidated selector for actions — these are stable function references
  // so this selector effectively never triggers a re-render.
  const { setIssuesView, setGenericChart, setDeepCrawlTab } =
    useGlobalCrawlStore(
      (state) => ({
        setIssuesView: state.setIssuesView,
        setGenericChart: state.setGenericChart,
        setDeepCrawlTab: state.setDeepCrawlTab,
      }),
      shallow,
    );
  // Screaming Frog opens on Internal — every internal URL in one list — so we do too.
  const [activeTab, setActiveTab] = useState("internal");

  // Tabs hidden via the right-click menu. Nothing is destroyed — a hidden tab
  // is simply not rendered in the bar and comes back from Configure Tabs.
  const [hiddenTabs, setHiddenTabs] = useState<string[]>([]);

  // Wheel-to-horizontal on the tab strips, and keep the active tab in view.
  useTabStripScroll(activeTab);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("onwebs.hiddenTabs") || "[]");
      if (Array.isArray(saved)) setHiddenTabs(saved);
    } catch {
      /* default to showing everything */
    }
  }, []);

  const applyHiddenTabs = useCallback(
    (next: string[]) => {
      setHiddenTabs(next);
      try {
        localStorage.setItem("onwebs.hiddenTabs", JSON.stringify(next));
      } catch {
        /* the choice just won't persist */
      }
      // Never leave the pane pointing at a tab that is no longer in the bar.
      if (next.includes(activeTab)) {
        const firstVisible = mainTabOrder.find((k: string) => !next.includes(k));
        if (firstVisible) setActiveTab(firstVisible);
      }
    },
    [activeTab],
  );

  useEffect(() => {
    if (storeDeepCrawlTab && storeDeepCrawlTab !== activeTab) {
      setActiveTab(storeDeepCrawlTab);
    }
  }, [storeDeepCrawlTab]);

  // Sync `activeTab` with `issuesView` when `issuesView` changes
  useEffect(() => {
    if (issuesView) {
      setActiveTab(issuesView);
    }
  }, [issuesView]);

  useEffect(() => {
    if (activeTab === "crawledPages") {
      setGenericChart("general");
    }

    if (activeTab === "Duplicated Titles") {
      setGenericChart("");
    }

    if (activeTab === "404 Response") {
      setGenericChart("");
    }
  }, [activeTab, issuesView]);

  const updateHeight = useCallback(() => {
    const windowHeight = window.innerHeight;
    const newContainerHeight = windowHeight - 144;
    setContainerHeight(newContainerHeight);
    setBottomTableHeight(Math.floor(newContainerHeight / 3));
  }, []);

  const debouncedUpdateHeight = useMemo(
    () => debounce(updateHeight, 100),
    [updateHeight],
  );

  useEffect(() => {
    debouncedUpdateHeight();
    window.addEventListener("resize", debouncedUpdateHeight);
    return () => {
      window.removeEventListener("resize", debouncedUpdateHeight);
      debouncedUpdateHeight.cancel();
    };
  }, [debouncedUpdateHeight]);

  const handleResize = useMemo(
    () =>
      throttle((newBottomHeight: number) => {
        setBottomTableHeight(newBottomHeight);
      }, 16),
    [],
  );

  // Scale-aware version subscription: once the crawl exceeds max_urls_stored rows,
  // return a stable sentinel (-1) so Zustand stops re-rendering this component on
  // every new URL. The component refreshes naturally when isFinishedDeepCrawl flips.
  const crawlDataVersion = useGlobalCrawlStore((state) => {
    const limit = state.maxUrlsStored || DEFAULT_LIVE_DATA_LIMIT;
    if (!state.isFinishedDeepCrawl && state.streamedCrawledPages > limit) {
      return -1;
    }
    return state.crawlDataVersion;
  });

  // Fetch aggregated data when tab changes
  const { setAggregatedData, appendAggregatedData } = useDataActions();
  const aggregatedData = useGlobalCrawlStore(
    (state) => state.aggregatedData,
    shallow,
  );

  // THIS HANDLES THE DATA FETCHING FROM THE DATABSE TO NO OVERWHELM THE MEMORY.
  // ON TAB CLICK IT SHOULD LOAD THE DATA INTO THE RESPECTIVE TAB.
  // TODO: Make this better in the future as it might still be too when crawling is on.
  useEffect(() => {
    let isSubscribed = true;

    const fetchData = async () => {
      const fetchForTab = async () => {
        try {
          if (activeTab === "internal") {
            // The Internal view needs every asset list at once, not just the
            // one matching a single tab.
            const [images, scripts, css, files] = await Promise.all([
              invoke("get_aggregated_crawl_data_command", { dataType: "images" }),
              invoke("get_aggregated_crawl_data_command", { dataType: "scripts" }),
              invoke("get_aggregated_crawl_data_command", { dataType: "stylesheets" }),
              invoke("get_aggregated_crawl_data_command", { dataType: "files" }).catch(
                () => [],
              ),
            ]);
            if (isSubscribed)
              setAggregatedData({
                images: images || [],
                scripts: scripts || [],
                css: css || [],
                files: files || [],
              });
          } else if (activeTab === "images") {
            const res = await invoke("get_aggregated_crawl_data_command", {
              dataType: "images",
            });
            if (isSubscribed) setAggregatedData({ images: res || [] });
          } else if (activeTab === "javascript") {
            const res = await invoke("get_aggregated_crawl_data_command", {
              dataType: "scripts",
            });
            if (isSubscribed) setAggregatedData({ scripts: res || [] });
          } else if (activeTab === "css") {
            const res = await invoke("get_aggregated_crawl_data_command", {
              dataType: "stylesheets",
            });
            if (isSubscribed) setAggregatedData({ css: res || [] });
          } else if (activeTab === "internalLinks") {
            const PAGE_SIZE = 5000;
            const first = (await invoke("get_links_page_command", {
              dataType: "internal_links",
              limit: PAGE_SIZE,
              offset: 0,
            })) as any[];
            if (isSubscribed) setAggregatedData({ internalLinks: first || [] });
            if ((first?.length ?? 0) === PAGE_SIZE) {
              const rest = (await invoke("get_links_page_command", {
                dataType: "internal_links",
                limit: 0,
                offset: PAGE_SIZE,
              })) as any[];
              if (isSubscribed && rest?.length)
                appendAggregatedData({ internalLinks: rest });
            }
          } else if (activeTab === "externalLinks") {
            const PAGE_SIZE = 5000;
            const first = (await invoke("get_links_page_command", {
              dataType: "external_links",
              limit: PAGE_SIZE,
              offset: 0,
            })) as any[];
            if (isSubscribed) setAggregatedData({ externalLinks: first || [] });
            if ((first?.length ?? 0) === PAGE_SIZE) {
              const rest = (await invoke("get_links_page_command", {
                dataType: "external_links",
                limit: 0,
                offset: PAGE_SIZE,
              })) as any[];
              if (isSubscribed && rest?.length)
                appendAggregatedData({ externalLinks: rest });
            }
          } else if (activeTab === "keywords") {
            const res = await invoke("get_aggregated_crawl_data_command", {
              dataType: "keywords",
            });
            if (isSubscribed) setAggregatedData({ keywords: res || [] });
          } else if (activeTab === "redirects") {
            const res = await invoke("get_aggregated_crawl_data_command", {
              dataType: "redirects",
            });
            if (isSubscribed) setAggregatedData({ redirects: res || [] });
          } else if (activeTab === "cwv") {
            const res = await invoke("get_aggregated_crawl_data_command", {
              dataType: "cwv",
            });
            if (isSubscribed) setAggregatedData({ cwv: res || [] });
          } else if (activeTab === "files") {
            const res = await invoke("get_aggregated_crawl_data_command", {
              dataType: "files",
            });
            if (isSubscribed) setAggregatedData({ files: res || [] });
          } else if (activeTab === "search") {
            const res = await invoke("get_aggregated_crawl_data_command", {
              dataType: "custom_search",
            });
            if (isSubscribed) setAggregatedData({ customSearch: res || [] });
          }
        } catch (e) {
          console.error("Error fetching aggregated data:", e);
        }
      };

      // Immediate fetch check This is important to avoid unnecessary re-renders
      let shouldFetchImmediate = false;
      const currentData = useGlobalCrawlStore.getState().aggregatedData;

      if (
        activeTab === "images" &&
        (!currentData.images || currentData.images.length === 0)
      )
        shouldFetchImmediate = true;
      else if (
        activeTab === "javascript" &&
        (!currentData.scripts || currentData.scripts.length === 0)
      )
        shouldFetchImmediate = true;
      else if (
        activeTab === "css" &&
        (!currentData.css || currentData.css.length === 0)
      )
        shouldFetchImmediate = true;
      else if (
        activeTab === "internalLinks" &&
        (!currentData.internalLinks || currentData.internalLinks.length === 0)
      )
        shouldFetchImmediate = true;
      else if (
        activeTab === "externalLinks" &&
        (!currentData.externalLinks || currentData.externalLinks.length === 0)
      )
        shouldFetchImmediate = true;
      else if (
        activeTab === "keywords" &&
        (!currentData.keywords || currentData.keywords.length === 0)
      )
        shouldFetchImmediate = true;
      else if (
        activeTab === "redirects" &&
        (!currentData.redirects || currentData.redirects.length === 0)
      )
        shouldFetchImmediate = true;
      else if (
        activeTab === "files" &&
        (!currentData.files || currentData.files.length === 0)
      )
        shouldFetchImmediate = true;
      else if (
        activeTab === "cwv" &&
        (!currentData.cwv || currentData.cwv.length === 0)
      )
        shouldFetchImmediate = true;
      else if (
        activeTab === "search" &&
        (!currentData.customSearch || currentData.customSearch.length === 0)
      )
        shouldFetchImmediate = true;

      const totalUrlsCrawled =
        useGlobalCrawlStore.getState().streamedCrawledPages;
      // Prevent massive JSON payloads crossing the IPC bridge during large crawls
      const isScaleTooLargeForLive = totalUrlsCrawled > 2000;

      if (
        shouldFetchImmediate ||
        (!isFinishedDeepCrawl && !isScaleTooLargeForLive)
      ) {
        await fetchForTab();
      }
    };

    fetchData();

    // Set up polling if crawl is active
    let intervalId = null;
    if (!isFinishedDeepCrawl) {
      intervalId = setInterval(fetchData, 10000); // Poll every 10 seconds to reduce IPC bottleneck
    }

    return () => {
      isSubscribed = false;
      if (intervalId) clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isFinishedDeepCrawl, setAggregatedData]);

  // Filteres all the JS
  const filteredJsArr = useMemo(() => {
    if (activeTab !== "javascript") return EMPTY_ARRAY;
    // Use fetched data
    return (aggregatedData.scripts || []).map((url, index) => ({
      index: index + 1,
      url,
    }));
  }, [aggregatedData.scripts, activeTab]);

  // Filters all the CSS
  const filteredCssArr = useMemo(() => {
    if (activeTab !== "css") return EMPTY_ARRAY;
    return (aggregatedData.css || []).map((url, index) => ({
      index: index + 1,
      url,
    }));
  }, [aggregatedData.css, activeTab]);

  // Filters all the images
  const filteredImagesArr = useMemo(() => {
    if (activeTab !== "images") return EMPTY_ARRAY;
    return aggregatedData.images || [];
  }, [aggregatedData.images, activeTab]);

  // Filters all the Internal links
  const filteredInternalLinks = useMemo(() => {
    if (activeTab !== "internalLinks") return EMPTY_ARRAY;
    // The structure returned by backend is generic JSON link objects, map to what Table expects
    // { link, anchor, status, error, page }
    return (aggregatedData.internalLinks || []).map((link) => ({
      link: link.url,
      anchor: link.anchor_text || "",
      rel: link.rel || "",
      title: link.title || "",
      target: link.target || "",
      status: link.status || null,
      error: link.error || null,
      page: link.page || "",
      linkScore: link.link_score ?? null,
    }));
  }, [aggregatedData.internalLinks, activeTab]);

  // Filters all the External links
  const filteredExternalLinks = useMemo(() => {
    if (activeTab !== "externalLinks") return EMPTY_ARRAY;
    return (aggregatedData.externalLinks || []).map((link) => ({
      link: link.url,
      anchor: link.anchor_text || "",
      rel: link.rel || "",
      title: link.title || "",
      target: link.target || "",
      status: link.status || null,
      error: link.error || null,
      page: link.page || "",
      linkScore: link.link_score ?? null,
    }));
  }, [aggregatedData.externalLinks, activeTab]);

  // FILTER THE KEYWORDS, make them as value and the url as key
  const filteredKeywords = useMemo(() => {
    if (activeTab !== "keywords") return EMPTY_ARRAY;
    // The structure returned by backend is { url, keywords: [] }
    return aggregatedData.keywords || [];
  }, [aggregatedData.keywords, activeTab]);

  // Sourced from the DB-backed "custom_search" aggregation (same mechanism as
  // keywords/redirects) rather than the in-memory crawlData ring buffer, so
  // results are durable across tab switches and reopened crawl sessions, and
  // reflect every enabled rule instead of a single hardcoded boolean.
  const filteredCustomSearch = useMemo(() => {
    if (activeTab !== "search") return EMPTY_ARRAY;
    return aggregatedData.customSearch || [];
  }, [aggregatedData.customSearch, activeTab]);
  const { rules: customSearchRules } = useCustomSearchRules();

  const cwvRows = useMemo(() => {
    if (activeTab !== "cwv") return EMPTY_ARRAY;
    if (aggregatedData?.cwv?.length > 0) return aggregatedData.cwv;
    const state = useGlobalCrawlStore.getState();
    const data = state.crawlData || [];
    return data;
  }, [aggregatedData.cwv, crawlDataVersion, activeTab, isFinishedDeepCrawl]);

  // Every tab built on page data needs this, not just the old "crawledPages"
  // tab — which no longer exists, since HTML became a filter inside Internal.
  // Gating on that dead tab name is what left the Internal view showing only
  // assets: the page rows were being replaced with an empty array.
  const PAGE_DATA_TABS = useMemo(
    () => new Set(["internal", "crawledPages", ...FILTER_SETS.map((f) => f.key)]),
    [],
  );

  const allCrawlData = useMemo(() => {
    if (!PAGE_DATA_TABS.has(activeTab)) return EMPTY_ARRAY;
    const state = useGlobalCrawlStore.getState();
    return state.crawlData || [];
  }, [crawlDataVersion, activeTab, isFinishedDeepCrawl, PAGE_DATA_TABS]);

  // One list of every internal URL — pages plus their images, scripts,
  // stylesheets and documents — which is what Screaming Frog's Internal tab
  // shows. Built from data the crawler already returns; no backend change.
  // Tab labels live in one map so the drag-reorder hook can work purely with
  // keys — the rendered order comes from the hook, not from JSX order.
  const MAIN_TAB_LABELS: Record<string, string> = useMemo(
    () => ({
      internal: "داخلی",
      ...Object.fromEntries(FILTER_SETS.map((fs) => [fs.key, fs.label])),
      // HTML / CSS / Javascript removed: they are filter options inside the
      // Internal tab now, exactly as Screaming Frog arranges them.
      internalLinks: "لینک‌های داخلی",
      externalLinks: "خارجی",
      images: "تصاویر",
      keywords: "کلمات کلیدی",
      cwv: "Core Web Vitals",
      search: "جستجوی سفارشی",
      redirects: "Redirectها",
      files: "فایل‌ها",
    }),
    [],
  );

  const BOTTOM_TAB_LABELS: Record<string, string> = useMemo(
    () => ({
      details: "URL Details",
      inlinks: "Inlinks",
      outlinks: "Outlinks",
      images: "تصاویر",
      schema: "Schema",
      headers: "Headers",
      opengraph: "OpenGraph",
      serp: "SERP Snippet",
      pageInternal: "داخلی صفحه",
      pageExternal: "خارجی صفحه",
    }),
    [],
  );

  const defaultBottomOrder = useMemo(
    () => Object.keys(BOTTOM_TAB_LABELS),
    [BOTTOM_TAB_LABELS],
  );
  const { order: bottomTabOrder, dragProps: bottomTabDrag } = useTabOrder(
    "onwebs.tabOrder.bottom",
    defaultBottomOrder,
  );

  const defaultMainOrder = useMemo(
    () => Object.keys(MAIN_TAB_LABELS),
    [MAIN_TAB_LABELS],
  );
  const { order: mainTabOrder, dragProps: mainTabDrag } = useTabOrder(
    "onwebs.tabOrder.main",
    defaultMainOrder,
  );

  const internalRows = useMemo(() => {
    if (activeTab !== "internal") return EMPTY_ARRAY;
    return buildInternalRows(allCrawlData || [], aggregatedData || {});
  }, [allCrawlData, aggregatedData, activeTab]);


  // Filters all files
  const filteredFilesArr = useMemo(() => {
    if (activeTab !== "files") return EMPTY_ARRAY;
    // Structure: { url, found_at: page }
    // We need to derive 'filetype' from url
    return (aggregatedData.files || [])
      .map((f, index) => {
        const ext =
          f.url.split(".").pop()?.split(/[?#]/)[0]?.toUpperCase() || "UNKNOWN";

        // Only include PDF files
        if (ext !== "PDF") {
          return null;
        }

        return {
          id: index + 1,
          url: f.url,
          filetype: ext,
          found_at: f.found_at || f.page || "",
        };
      })
      .filter(Boolean);
  }, [aggregatedData.files, activeTab]);

  // Redirects logic - new
  const filteredRedirects = useMemo(() => {
    if (activeTab !== "redirects") return EMPTY_ARRAY;
    return aggregatedData.redirects || [];
  }, [aggregatedData.redirects, activeTab]);

  const renderIssuesViewContent = () => {
    switch (issuesView) {
      case "Duplicated Titles":
        return;
      case "404 response":
        return <div>محتوای مربوط به پاسخ 404</div>;
      // Add more cases as needed
      default:
        return <div>محتوای پیش‌فرض</div>;
    }
  };

  const handleTabChange = (value) => {
    setActiveTab(value);
    setDeepCrawlTab(value);
    if (value === issuesView) {
      // If the tab is the issuesView tab, ensure issuesView is updated
      setIssuesView(value);
    }
  };

  return (
    <div
      className={`mx-0 mt-[2rem] h-screen dark:bg-brand-darker ${visibility.sidebar ? "w-[calc(100vw-26rem)]" : ""}`}
    >
      <div
        ref={containerRef}
        className="bg-white rounded-md"
        style={{ height: `${containerHeight}px` }}
      >
        <div
          style={{
            height: `${containerHeight - bottomTableHeight}px`,
            minHeight: "100px",
          }}
        >
          <Tabs
            value={activeTab}
            onValueChange={handleTabChange}
            className="h-full flex dark:bg-brand-darker flex-col"
          >
            <TabsList className="tab-strip w-full justify-start dark:bg-brand-darker dark:border-brand-dark border-t-0 -mb-1.5 bg-gray-50 rounded-none">
              {mainTabOrder.map((key) => {
                const label = MAIN_TAB_LABELS[key];
                if (!label || hiddenTabs.includes(key)) return null;
                const allTabs = mainTabOrder
                  .filter((k: string) => MAIN_TAB_LABELS[k])
                  .map((k: string) => ({ key: k, label: MAIN_TAB_LABELS[k] }));
                return (
                  <TabContextMenu
                    key={key}
                    tabKey={key}
                    allTabs={allTabs}
                    hidden={hiddenTabs}
                    onHiddenChange={applyHiddenTabs}
                    onReset={() => applyHiddenTabs([])}
                  >
                    <TabsTrigger
                      value={key}
                      className="rounded-t-md shrink-0"
                      title="کلیک راست برای تنظیم تب‌ها — کشیدن برای جابه‌جایی"
                      {...mainTabDrag(key)}
                    >
                      {label}
                    </TabsTrigger>
                  </TabContextMenu>
                );
              })}
              {issuesView && (
                <TabsTrigger value={issuesView} className="rounded-t-md shrink-0">
                  {issuesView}
                </TabsTrigger>
              )}
            </TabsList>
            {FILTER_SETS.some((fs) => fs.key === activeTab) && (
              <div className="flex-1 min-h-0 h-full overflow-hidden">
                <FilteredTab tabKey={activeTab} rows={allCrawlData} />
              </div>
            )}
            {activeTab === "internal" && (
              <div className="flex-1 min-h-0 h-full overflow-hidden">
                <InternalTable rows={internalRows} />
              </div>
            )}
            {activeTab === "crawledPages" && (
              <div className="flex-1 min-h-0 h-full overflow-hidden">
                <TableCrawl tabName={"AllData"} rows={allCrawlData} />
              </div>
            )}
            {activeTab === "css" && (
              <div className="flex-1 min-h-0 h-full overflow-hidden">
                <TableCrawlCSS rows={filteredCssArr} tabName={"All CSS "} />
              </div>
            )}
            {activeTab === "javascript" && (
              <div className="flex-1 min-h-0 h-full overflow-hidden">
                <TableCrawlJs tabName={"Javascript"} rows={filteredJsArr} />
              </div>
            )}
            {activeTab === "internalLinks" && (
              <div className="flex-1 min-h-0 h-full overflow-hidden">
                <LinksTable
                  tabName={"Internal Links"}
                  rows={filteredInternalLinks}
                />
              </div>
            )}
            {activeTab === "externalLinks" && (
              <div className="flex-1 min-h-0 h-full overflow-hidden">
                <LinksTable
                  tabName={"External Links"}
                  rows={filteredExternalLinks}
                />
              </div>
            )}
            {activeTab === "images" && (
              <div className="flex-1 min-h-0 h-full overflow-hidden">
                <ImagesCrawlTable
                  tabName={"All Images"}
                  rows={filteredImagesArr}
                />
              </div>
            )}
            {activeTab === "keywords" && (
              <div className="flex-1 min-h-0 h-full overflow-hidden">
                <KeywordsTable rows={filteredKeywords} tabName="All Keywords" />
              </div>
            )}
            {activeTab === "cwv" && (
              <div className="flex-1 min-h-0 h-full overflow-hidden">
                <CoreWebVitalsTable tabName={"CoreWebVitals"} rows={cwvRows} />
              </div>
            )}
            {activeTab === "search" && (
              <div className="flex-1 min-h-0 h-full overflow-hidden">
                <TableCustomSearch
                  rows={filteredCustomSearch}
                  rules={customSearchRules}
                />
              </div>
            )}
            {activeTab === "redirects" && (
              <div className="flex-1 min-h-0 h-full overflow-hidden">
                <RedirectsTable
                  tabName={"Redirects"}
                  rows={filteredRedirects}
                />
              </div>
            )}
            {activeTab === "files" && (
              <div className="flex-1 min-h-0 h-full overflow-hidden">
                <FilesTable tabName={"All Files"} rows={filteredFilesArr} />
              </div>
            )}
            {activeTab === issuesView && issuesView && (
              <div className="flex-1 min-h-0 h-full overflow-hidden">
                <TableCrawl tabName={issuesView} rows={issuesData || []} />
              </div>
            )}
          </Tabs>
        </div>
        <ResizableDivider onResize={handleResize} containerRef={containerRef} />
        <div
          className="dark:bg-brand-darker h-auto relative"
          style={{
            height: `${bottomTableHeight}px`,
            minHeight: "100px",
            overflow: "hidden",
          }}
        >
          <Tabs
            value={activeBottomTab}
            onValueChange={setActiveBottomTab}
            className="h-full flex flex-col"
          >
            <div className="relative">
              <TabsList className="tab-strip w-full justify-start dark:bg-brand-darker dark:border-brand-dark border-t bg-slate-50 rounded-none">
                {bottomTabOrder.map((key) => {
                  const label = BOTTOM_TAB_LABELS[key];
                  if (!label) return null;
                  return (
                    <TabsTrigger
                      key={key}
                      value={key}
                      className="rounded-t-md cursor-grab active:cursor-grabbing"
                      title="برای جابه‌جایی، تب را بکشید"
                      {...bottomTabDrag(key)}
                    >
                      {label}
                    </TabsTrigger>
                  );
                })}
                {/* Export button for Inlinks tab */}
                {activeBottomTab === "inlinks" && (
                  <button
                    onClick={() => inlinksTableRef.current?.exportCSV?.()}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs border border-brand-bright dark:border-brand-bright px-2 py-0.5 rounded-sm hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors dark:text-white/80 bg-white dark:bg-brand-dark shadow-sm"
                  >
                    خروجی
                  </button>
                )}

                {/* Export button for Outlinks tab */}
                {activeBottomTab === "outlinks" && (
                  <button
                    onClick={() => outlinksTableRef.current?.exportCSV?.()}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs border border-brand-bright dark:border-brand-bright px-2 py-0.5 rounded-sm hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors dark:text-white/80 bg-white dark:bg-brand-dark shadow-sm"
                  >
                    خروجی
                  </button>
                )}

                {/* Export button for Page Internal tab */}
                {activeBottomTab === "pageInternal" && (
                  <button
                    onClick={() => pageInternalTableRef.current?.exportCSV?.()}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs border border-brand-bright dark:border-brand-bright px-2 py-0.5 rounded-sm hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors dark:text-white/80 bg-white dark:bg-brand-dark shadow-sm"
                  >
                    خروجی
                  </button>
                )}

                {/* Export button for Page External tab */}
                {activeBottomTab === "pageExternal" && (
                  <button
                    onClick={() => pageExternalTableRef.current?.exportCSV?.()}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs border border-brand-bright dark:border-brand-bright px-2 py-0.5 rounded-sm hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors dark:text-white/80 bg-white dark:bg-brand-dark shadow-sm"
                  >
                    خروجی
                  </button>
                )}
              </TabsList>
            </div>

            {activeBottomTab === "serp" && (
              <div className="flex-1 min-h-0 mt-0 overflow-hidden">
                <SerpSnippet data={selectedTableURL} />
              </div>
            )}
            {activeBottomTab === "details" && (
              <div className="flex-1 min-h-0 mt-0 overflow-hidden">
                <UrlDetailsPane
                  data={selectedTableURL}
                  height={bottomTableHeight}
                />
              </div>
            )}
            {activeBottomTab === "inlinks" && (
              <div className="flex-1 min-h-0 mt-0 overflow-hidden">
                <InnerLinksDetailsTable
                  ref={inlinksTableRef}
                  data={inlinks}
                  height={bottomTableHeight}
                />
              </div>
            )}
            {activeBottomTab === "outlinks" && (
              <div className="flex-1 min-h-0 mt-0 overflow-hidden">
                <OuterLinksSubTable
                  ref={outlinksTableRef}
                  data={outlinks}
                  height={bottomTableHeight}
                />
              </div>
            )}
            {activeBottomTab === "images" && (
              <div className="flex-1 min-h-0 mt-0 overflow-hidden">
                <ImagesTable height={bottomTableHeight} />
              </div>
            )}
            {activeBottomTab === "schema" && (
              <div className="flex-1 min-h-0 mt-0 overflow-hidden">
                <SchemaSubTable height={bottomTableHeight} />
              </div>
            )}
            {activeBottomTab === "headers" && (
              <div className="flex-1 min-h-0 mt-0 overflow-hidden">
                <ResponseHeaders
                  data={selectedTableURL}
                  height={bottomTableHeight}
                />
              </div>
            )}
            {activeBottomTab === "opengraph" && (
              <div className="flex-1 min-h-0 mt-0 overflow-hidden">
                <OpenGraphPreview height={bottomTableHeight} />
              </div>
            )}
            {activeBottomTab === "pageInternal" && (
              <div className="flex-1 min-h-0 mt-0 overflow-hidden">
                <PageInternalSubTable
                  ref={pageInternalTableRef}
                  data={selectedTableURL}
                  height={bottomTableHeight}
                />
              </div>
            )}
            {activeBottomTab === "pageExternal" && (
              <div className="flex-1 min-h-0 mt-0 overflow-hidden">
                <PageExternalSubTable
                  ref={pageExternalTableRef}
                  data={selectedTableURL}
                  height={bottomTableHeight}
                />
              </div>
            )}

            <TabsContent
              value="innerLinks"
              className="relative z-0"
            ></TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
