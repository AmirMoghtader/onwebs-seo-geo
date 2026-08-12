import { Tabs } from "@mantine/core";
import HistoryDomainCrawls from "./BottomContainer/HistoryDomainCrawls";
import OverviewBottomSidePanel from "./BottomContainer/OverviewBottomSidePanel";
import RobotsDomain from "./BottomContainer/RobotsDomain";
import SitemapReview from "./BottomContainer/SitemapReview";
import FixesContainer from "./BottomContainer/Fixes/FixesContainer";

const BottomContainer = () => {
  return (
    <div className="relative h-full flex flex-col dark:bg-gray-900 bg-slate-100">
      <Tabs defaultValue="overview" className="overflow-hidden h-full w-full flex flex-col">
        {/* This row is the only way back to the other panels, so it must never
            be what gives way when the user drags the divider up. */}
        <Tabs.List
          justify="center"
          grow
          className="dark:text-white text-xs bg-slate-100 dark:bg-gray-900 shrink-0"
        >
          <Tabs.Tab value="overview">نمای کلی</Tabs.Tab>
          {/* <Tabs.Tab value="robotsTab">اصلاحات</Tabs.Tab> */}
          <Tabs.Tab value="sitemaps">سایت‌مپ</Tabs.Tab>
          <Tabs.Tab value="fixes">اصلاحات</Tabs.Tab>
          <Tabs.Tab value="history">تاریخچه</Tabs.Tab>
          <Tabs.Tab value="robots">Robots</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel
          value="overview"
          className="flex-1 min-h-0 overflow-auto flex flex-col justify-between relative dark:bg-gray-900"
        >
          <OverviewBottomSidePanel />
        </Tabs.Panel>

        <Tabs.Panel
          value="sitemaps"
          className="flex-1 min-h-0 overflow-hidden flex flex-col dark:bg-gray-900"
        >
          <SitemapReview />
        </Tabs.Panel>

        <Tabs.Panel value="fixes" className="flex-1 min-h-0 overflow-auto">
          <div className="flex flex-col gap-y-2 dark:bg-gray-900">
            <FixesContainer />
          </div>
        </Tabs.Panel>
        <Tabs.Panel value="history" className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <div className="flex-1 min-h-0 flex flex-col dark:bg-gray-900">
            <HistoryDomainCrawls />
          </div>
        </Tabs.Panel>
        <Tabs.Panel value="robots" className="flex-1 w-full min-h-0 relative p-0 overflow-hidden">
          <RobotsDomain />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
};

export default BottomContainer;
