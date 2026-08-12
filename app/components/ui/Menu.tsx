"use client";
import { Menu, Text, rem } from "@mantine/core";
import {
  IconSettings,
  IconSearch,
  IconPhoto,
  IconMessageCircle,
  IconTrash,
  IconArrowsLeftRight,
} from "@tabler/icons-react";
import { IoCreateOutline } from "react-icons/io5";

import { HiOutlineDocumentReport } from "react-icons/hi";

import { Tooltip } from "@mantine/core";

function MenuEl() {
  return (
    <Menu shadow="md" width={200} zIndex={0}>
      <Tooltip
        label="تولید گزارش‌های خارجی"
        position="left-start"
        offset={5}
      >
        <Menu.Target>
          <button
            className="px-3 active:scale-95 items-center flex space-x-1 py-1 rounded-md border border-apple-silver bg-apple-blue text-white"
            type="button"
          >
            <HiOutlineDocumentReport className="text-xl mr-1" />
            Reporting
          </button>
        </Menu.Target>
      </Tooltip>

      <Menu.Dropdown className="relative">
        <div className="w-3 h-3 border-l border-t rotate-45 absolute left-24 -top-2 bg-white -z-10" />
        <Menu.Label>برنامه</Menu.Label>
        <Menu.Item
          leftSection={
            <IoCreateOutline style={{ width: rem(14), height: rem(14) }} />
          }
        >
          تنظیمات
        </Menu.Item>
        <Menu.Item
          leftSection={
            <IconMessageCircle style={{ width: rem(14), height: rem(14) }} />
          }
        >
          Messages
        </Menu.Item>
        <Menu.Item
          leftSection={
            <IconPhoto style={{ width: rem(14), height: rem(14) }} />
          }
        >
          Gallery
        </Menu.Item>
        <Menu.Item
          leftSection={
            <IconSearch style={{ width: rem(14), height: rem(14) }} />
          }
          rightSection={
            <Text size="xs" c="dimmed">
              ⌘K
            </Text>
          }
        >
          جستجو
        </Menu.Item>

        <Menu.Divider />

        <Menu.Label>منطقه خطر</Menu.Label>
        <Menu.Item
          leftSection={
            <IconArrowsLeftRight style={{ width: rem(14), height: rem(14) }} />
          }
        >
          Transfer my data
        </Menu.Item>
        <Menu.Item
          color="red"
          leftSection={
            <IconTrash style={{ width: rem(14), height: rem(14) }} />
          }
        >
          Delete my account
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

export default MenuEl;
