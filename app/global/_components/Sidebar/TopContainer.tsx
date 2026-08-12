// @ts-nocheck
import { Tabs } from "@mantine/core";

// Import components directly
import GeneralTopSideBarContainer from "./General/GeneralTopSideBarContainer";
import IssuesContainer from "./Issues/IssuesContainer";
import OverviewTree from "./OverviewTree/OverviewTree";
import IssuesPane from "./IssuesPane/IssuesPane";
import SiteStructure from "./SiteStructure/SiteStructure";
import RankingInfo from "@/app/global/_components/Sidebar/GSCRankingInfo/RankingInfo";
import ConsoleLog from "./ConsoleLog/ConsoleLog";
import URLTreeContainer from "../URLTree/URLTreeContainer";
import { useVisibilityStore } from "@/store/VisibilityStore";
import useRankinInfoStore from "@/store/RankingInfoStore";

const TopContainer = () => {
  const { showSidebar } = useVisibilityStore();
  const { activeSidebarTab, setActiveSidebarTab } = useRankinInfoStore();

  return (
    // `flex` belongs in the base classes, not opposite `block` in the ternary:
    // that left two display utilities settling the column layout on nothing
    // sturdier than their order in the generated stylesheet.
    <div
      className={`h-full w-full overflow-hidden flex flex-col ${showSidebar ? "" : "hidden"}`}
    >
      <Tabs
        value={activeSidebarTab}
        onChange={setActiveSidebarTab}
        keepMounted={false}
        className="flex flex-col flex-1 min-h-0 overflow-hidden"
      >
        {/* Pinned track. SidebarContainer measures this pane once on mount and
            never again, so a shrinking window keeps handing the column less
            room than it captured. An auto-height strip loses that squeeze to
            the panel and the two swap rows; a height that cannot shrink means
            the strip always keeps its line and the panel absorbs the loss. */}
        <Tabs.List className="tab-strip dark:text-white text-xs border-0 h-[30px] shrink-0">
          <Tabs.Tab value="overview">نمای کلی</Tabs.Tab>
          <Tabs.Tab value="issues">مشکلات</Tabs.Tab>
          <Tabs.Tab value="structure">ساختار سایت</Tabs.Tab>
          <Tabs.Tab value="first">جزئیات</Tabs.Tab>
          <Tabs.Tab value="queries">Queryها</Tabs.Tab>
          <Tabs.Tab value="status">وضعیت</Tabs.Tab>
        </Tabs.List>

        {/* Every panel is the same kind of flex child: it takes the leftover
            height, may shrink past its content (min-h-0) and keeps its
            scrolling to itself. `h-full` is deliberately gone — 100% of the
            Tabs root is the strip's row plus the panel's, so a panel that asks
            for it overruns the pane by exactly the height of the strip. */}
        <Tabs.Panel
          value="overview"
          className="flex-1 min-h-0 overflow-hidden flex flex-col"
        >
          <OverviewTree />
        </Tabs.Panel>

        <Tabs.Panel
          value="structure"
          className="flex-1 min-h-0 overflow-hidden flex flex-col"
        >
          <SiteStructure />
        </Tabs.Panel>

        <Tabs.Panel
          value="first"
          className="flex-1 min-h-0 overflow-hidden flex flex-col"
        >
          <GeneralTopSideBarContainer />
        </Tabs.Panel>

        <Tabs.Panel
          value="issues"
          className="flex-1 min-h-0 overflow-hidden flex flex-col"
        >
          <IssuesPane />
        </Tabs.Panel>

        <Tabs.Panel
          value="issuesLegacy"
          className="flex-1 min-h-0 overflow-y-auto"
        >
          <IssuesContainer />
        </Tabs.Panel>

        <Tabs.Panel value="queries" className="flex-1 min-h-0 overflow-y-auto">
          <RankingInfo />
        </Tabs.Panel>

        <Tabs.Panel
          value="status"
          className="flex-1 min-h-0 overflow-hidden flex flex-col"
        >
          <ConsoleLog />
        </Tabs.Panel>


      </Tabs>
    </div>
  );
};

export default TopContainer;
