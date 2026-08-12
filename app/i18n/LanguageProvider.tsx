// @ts-nocheck
"use client";

// Switches the whole interface between Persian and English.
//
// The Persian strings were substituted directly into the JSX, so there is no
// message catalogue to swap — the English originals only survive as the
// reverse of the translation glossary. This walks the rendered text nodes and
// puts the English back, and toggles a class that undoes the right-to-left
// rules in globals.css.
//
// Translating the DOM is not how one would build this from scratch, but it is
// what the existing code allows without touching two hundred files again, and
// it is exact: every replacement comes from the same table that produced the
// Persian in the first place.

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import FA2EN from "./fa2en.json";

type Lang = "fa" | "en";

const LanguageContext = createContext<{
  lang: Lang;
  setLang: (l: Lang) => void;
}>({ lang: "fa", setLang: () => {} });

export const useLanguage = () => useContext(LanguageContext);

const STORAGE_KEY = "onwebs.lang";

// The dictionary is keyed by the EXACT Persian string a label was translated
// to, and lookups are whole-string only.
//
// Substring replacement was tried first and produced nonsense: "جزئیات" is a
// standalone label meaning "Details", but it also occurs inside the sentence
// "برای دیدن جزئیات، یک URL انتخاب کنید", which came out as "برای دیدن
// Details، یک URL From جدول High انتخاب کنید" — a word-by-word mangling of
// two languages. Every entry in this table came from translating one complete
// label, so matching complete labels is both the safe rule and the correct one.
const TABLE = new Map<string, string>(
  Object.entries(FA2EN as Record<string, string>),
);

const PERSIAN = /[؀-ۿ]/;

/** Skips nodes whose text is not ours to touch. */
function shouldSkip(node: Node): boolean {
  const parent = (node as any).parentElement as HTMLElement | null;
  if (!parent) return true;
  const tag = parent.tagName;
  if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA") return true;
  // Crawl results are the user's data, not our interface.
  if (parent.closest("[data-no-translate]")) return true;
  return false;
}

/**
 * Looks up one whole string. JSX often leaves surrounding whitespace and
 * Prettier wraps long labels across lines, so the key is matched on collapsed
 * whitespace and the original spacing is put back around the answer.
 */
function lookup(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || !PERSIAN.test(trimmed)) return null;

  const direct = TABLE.get(trimmed);
  if (direct) return direct;

  const collapsed = trimmed.replace(/\s+/g, " ");
  const viaCollapsed = TABLE.get(collapsed);
  if (viaCollapsed) return viaCollapsed;

  // A trailing colon or ellipsis is punctuation the label carries, not part
  // of the phrase that was translated.
  const stripped = collapsed.replace(/[:：…]+$/, "").trim();
  if (stripped !== collapsed) {
    const viaStripped = TABLE.get(stripped);
    if (viaStripped) {
      const tail = collapsed.slice(stripped.length);
      return viaStripped + tail;
    }
  }

  return null;
}

function translateTextNode(node: Text) {
  const original = node.nodeValue || "";
  const replacement = lookup(original);
  if (replacement === null) return;

  // Preserve the original leading/trailing whitespace so JSX layout that
  // depends on it does not collapse.
  const lead = original.slice(0, original.length - original.trimStart().length);
  const trail = original.slice(original.trimEnd().length);
  node.nodeValue = `${lead}${replacement}${trail}`;
}

function translateAttributes(el: Element) {
  for (const attr of ["placeholder", "title", "aria-label", "alt"]) {
    const v = el.getAttribute(attr);
    if (!v) continue;
    const replacement = lookup(v);
    if (replacement !== null) el.setAttribute(attr, replacement);
  }
}

function translateTree(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (!shouldSkip(n)) nodes.push(n as Text);
  }
  nodes.forEach(translateTextNode);

  if (root instanceof Element) translateAttributes(root);
  (root as Element)
    .querySelectorAll?.("[placeholder],[title],[aria-label],[alt]")
    .forEach(translateAttributes);
}

export const LanguageProvider = ({ children }: { children: React.ReactNode }) => {
  const [lang, setLangState] = useState<Lang>("fa");

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* the choice just won't persist */
    }
    // A reload is the honest way to get Persian back: the substitution is
    // one-way in the DOM, so re-rendering from source is the only exact undo.
    if (next === "fa") window.location.reload();
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Lang | null;
      if (saved === "en") setLangState("en");
    } catch {
      /* default to Persian */
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (lang !== "en") {
      root.classList.remove("lang-en");
      return;
    }

    // `lang-en` switches off the right-to-left rules in globals.css.
    root.classList.add("lang-en");
    root.setAttribute("lang", "en");

    translateTree(document.body);

    // React re-renders bring Persian back with them, so new nodes are
    // translated as they arrive.
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            if (!shouldSkip(node)) translateTextNode(node as Text);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            translateTree(node);
          }
        });
        if (m.type === "characterData" && m.target.nodeType === Node.TEXT_NODE) {
          if (!shouldSkip(m.target)) translateTextNode(m.target as Text);
        }
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  );
};

export default LanguageProvider;
