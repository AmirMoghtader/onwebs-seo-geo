// @ts-nocheck
"use client";

// Right-click menu on a tab, matching Screaming Frog's:
//   Close · Close Others · Close All · Configure Tabs · Reset Tabs
//
// "Closing" a tab here means hiding it from the bar, not destroying anything —
// the data is still crawled, so a hidden tab reappears the moment it is ticked
// again in Configure Tabs.

import React from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuCheckboxItem,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "@/components/ui/context-menu";
import { Settings, RotateCcw, X } from "lucide-react";

interface Props {
  children: React.ReactNode;
  /** key of the tab this menu belongs to */
  tabKey: string;
  /** every tab, in display order: { key, label } */
  allTabs: { key: string; label: string }[];
  /** which tab keys are currently visible */
  hidden: string[];
  onHiddenChange: (next: string[]) => void;
  onReset: () => void;
}

const TabContextMenu = ({
  children,
  tabKey,
  allTabs,
  hidden,
  onHiddenChange,
  onReset,
}: Props) => {
  const isHidden = (k: string) => hidden.includes(k);
  const visibleCount = allTabs.filter((t) => !isHidden(t.key)).length;

  const close = () => {
    // Refuse to hide the last visible tab — an empty tab bar would leave the
    // pane with nothing to render and no way back except Reset.
    if (visibleCount <= 1) return;
    onHiddenChange([...new Set([...hidden, tabKey])]);
  };

  const closeOthers = () =>
    onHiddenChange(allTabs.map((t) => t.key).filter((k) => k !== tabKey));

  const closeAll = () => {
    // "All" still keeps the clicked tab, for the same reason as above.
    onHiddenChange(allTabs.map((t) => t.key).filter((k) => k !== tabKey));
  };

  const toggle = (k: string, checked: boolean) =>
    onHiddenChange(
      checked ? hidden.filter((h) => h !== k) : [...new Set([...hidden, k])],
    );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="z-[999999999999] min-w-[190px]">
        <ContextMenuItem onClick={close} disabled={visibleCount <= 1}>
          <X className="w-3 h-3 mr-2" />
          Close
        </ContextMenuItem>
        <ContextMenuItem onClick={closeOthers} disabled={visibleCount <= 1}>
          Close Others
        </ContextMenuItem>
        <ContextMenuItem onClick={closeAll} disabled={visibleCount <= 1}>
          Close All
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Settings className="w-3 h-3 mr-2" />
            Configure Tabs
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="z-[9999999999999] max-h-[420px] overflow-y-auto">
            {allTabs.map((t) => (
              <ContextMenuCheckboxItem
                key={t.key}
                checked={!isHidden(t.key)}
                onCheckedChange={(c) => toggle(t.key, Boolean(c))}
                onSelect={(e) => e.preventDefault()}
              >
                {t.label}
              </ContextMenuCheckboxItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuItem onClick={onReset}>
          <RotateCcw className="w-3 h-3 mr-2" />
          Reset Tabs
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

export default TabContextMenu;
