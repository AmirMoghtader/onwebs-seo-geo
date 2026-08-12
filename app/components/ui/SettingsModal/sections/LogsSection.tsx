// @ts-nocheck
"use client";

import React from "react";
import { AppSettings } from "../useSettings";
import {
    SettingField,
    NumberInput,
    SectionHeader,
    ArrayInput,
} from "../fields/SettingFields";
import { ScrollText, Upload, Bot, Database } from "lucide-react";
import { RiRobot3Line } from "react-icons/ri";

const INDEXING_BOTS_SUGGESTIONS = [
    "Google Bot", "Bing", "Yandex", "Baidu", "DuckDuckGo", "Sogou",
    "Exabot", "PetalBot", "Naver Yeti", "Seznam Bot", "CocCoc Bot",
    "Mail.RU Bot", "Qwantify", "MojeekBot", "Alexa Crawler",
    "Archive.org Bot", "CommonCrawl", "Sogou News Spider", "Daumua",
    "AppleBot", "GPTBot", "OpenAI SearchBot",
];

const RETRIEVAL_AGENTS_SUGGESTIONS = [
    "GPTBot", "OAI-SearchBot", "ChatGPT-User", "OAI-AdsBot",
    "ClaudeBot", "Claude-User", "anthropic-ai",
    "Google-Extended", "Google-NotebookLM", "Google-CloudVertexBot",
    "PerplexityBot", "Perplexity-Comet", "DuckAssistBot",
    "Meta-ExternalAgent", "Bytespider", "GrokBot", "xAI-Grok",
    "CCBot", "Firecrawl", "Kadoa", "Exabot", "Tavily",
];

const AGENTIC_BOTS_SUGGESTIONS = [
    "Perplexity-Comet", "OAI-DeepResearch", "YouBot-ARI", "Grok-DeepSearch",
    "Claude-Researcher", "DuckAssistBot", "ChatGPT-User", "Claude-User",
    "Gemini-Live-Bot", "Tavily", "Search1api", "JinaBot",
    "Firecrawl", "Kadoa", "Google-CloudVertexBot", "LangChain-Agent",
    "AutoGPT-Retrieval",
];

interface Props {
    settings: AppSettings;
    onUpdate: (key: string, value: any) => void;
}

const LogsSection = ({ settings, onUpdate }: Props) => (
    <div className="space-y-0.5">
        <SectionHeader
            title="پردازش لاگ"
            icon={<ScrollText className="w-3.5 h-3.5" />}
        />

        <SettingField
            label="اندازه دسته لاگ"
            description="Logs processed per batch"
        >
            <NumberInput
                value={settings.log_batchsize}
                onChange={(v) => onUpdate("log_batchsize", v)}
                min={1}
                max={100}
            />
        </SettingField>

        <SettingField
            label="اندازه تکه لاگ"
            description="Lines per log chunk"
        >
            <NumberInput
                value={settings.log_chunk_size}
                onChange={(v) => onUpdate("log_chunk_size", v)}
                min={1000}
                max={5000000}
            />
        </SettingField>

        <SettingField
            label="وقفه Stream"
            description="Duration between stream iterations"
        >
            <NumberInput
                value={settings.log_sleep_stream_duration}
                onChange={(v) => onUpdate("log_sleep_stream_duration", v)}
                min={0}
                max={60}
                unit="s"
            />
        </SettingField>

        <SettingField
            label="ظرفیت لاگ"
            description="Buffer capacity for logs"
        >
            <NumberInput
                value={settings.log_capacity}
                onChange={(v) => onUpdate("log_capacity", v)}
                min={1}
                max={100}
            />
        </SettingField>

        <SettingField
            label="اندازه تکه پروژه"
            description="Chunk size for log projects"
        >
            <NumberInput
                value={settings.log_project_chunk_size}
                onChange={(v) => onUpdate("log_chunk_size_project", v)}
                min={1}
                max={100}
            />
        </SettingField>

        <SectionHeader
            title="بارگذاری فایل"
            icon={<Upload className="w-3.5 h-3.5" />}
        />

        <SettingField
            label="حداکثر حجم آپلود"
            description="Maximum log file upload size"
        >
            <NumberInput
                value={settings.log_file_upload_size}
                onChange={(v) => onUpdate("log_file_upload_size", v)}
                min={1}
                max={500}
                unit="MB"
            />
        </SettingField>

        <SectionHeader
            title="ربات‌های Indexing"
            icon={<Bot className="w-3.5 h-3.5" />}
        />

        <SettingField
            label="ربات‌های Indexing"
            description="Bots that index your site (Google, Bing, etc.)"
        >
            <ArrayInput
                value={settings.indexing_bots || []}
                onChange={(v) => onUpdate("indexing_bots", v)}
                placeholder="جستجوی ربات‌ها..."
                suggestions={INDEXING_BOTS_SUGGESTIONS}
                compact
            />
        </SettingField>

        <SectionHeader
            title="Retrieval Agentها"
            icon={<Database className="w-3.5 h-3.5" />}
        />

        <SettingField
            label="Retrieval Agentها"
            description="Bots that consume content for LLMs"
        >
            <ArrayInput
                value={settings.retrieval_agents || []}
                onChange={(v) => onUpdate("retrieval_agents", v)}
                placeholder="جستجوی agentها..."
                suggestions={RETRIEVAL_AGENTS_SUGGESTIONS}
                compact
            />
        </SettingField>

        <SectionHeader
            title="ربات‌های Agentic"
            icon={<RiRobot3Line className="w-3.5 h-3.5" />}
        />

        <SettingField
            label="ربات‌های Agentic"
            description="AI agents that perform tasks"
        >
            <ArrayInput
                value={settings.agentic_bots || []}
                onChange={(v) => onUpdate("agentic_bots", v)}
                placeholder="جستجوی ربات‌ها..."
                suggestions={AGENTIC_BOTS_SUGGESTIONS}
                compact
            />
        </SettingField>
    </div>
);

export default LogsSection;
