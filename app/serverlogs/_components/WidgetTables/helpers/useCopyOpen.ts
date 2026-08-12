// @ts-nocheck
import openBrowserWindow from "@/app/Hooks/OpenBrowserWindow";
import { toast } from "sonner";

function handleURLClick(url, click) {
  click.preventDefault();
  click.stopPropagation();

  if (!url) {
    toast.error("امکان باز کردن URL وجود ندارد.", { description: "URL is missing." });
    return;
  }

  const domain = localStorage.getItem("domain");

  if (click.button === 0) { // Left click
    if (domain && domain.trim() !== "") {
        let fullUrl;
        if (url.startsWith('http://') || url.startsWith('https://')) {
            fullUrl = url;
        } else {
            fullUrl = `https://${domain.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
        }
        
        try {
            // Validate URL format before passing to Tauri
            new URL(fullUrl);
            openBrowserWindow(fullUrl);
        } catch (e) {
            toast.error("فرمت URL نامعتبر است.", { description: fullUrl });
        }
    } else {
        toast.error("دامنه‌ای برای باز کردن URL تنظیم نشده است.", { description: "Please set a domain in settings." });
    }
  }

  if (click.button === 2) { // Right click
    let textToCopy = url;
    if (domain && domain.trim() !== "") {
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            textToCopy = `https://${domain.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
        }
    }
    
    if (textToCopy) {
        navigator.clipboard.writeText(textToCopy);
        toast.success("URL در کلیپ‌بورد کپی شد!");
    }
  }
}

function handleCopyClick(text, click, name) {
  click.preventDefault();
  click.stopPropagation();

  if (!text) return;

  const domain = localStorage.getItem("domain");

  let textToCopy = text;
  if (name === "URL / PATH") {
    if (domain && domain.trim() !== "") {
        if (!text.startsWith('http://') && !text.startsWith('https://')) {
            textToCopy = `https://${domain.replace(/\/$/, '')}/${text.replace(/^\//, '')}`;
        }
    }
  }

  navigator.clipboard.writeText(textToCopy);
  toast.success(`${name} copied to clipboard!`);
}

export { handleURLClick, handleCopyClick };
