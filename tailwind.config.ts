import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "IRANSansX",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
      colors: {
        "custom-base-red": "#ff2f23",
        "custom-light-red": "#fb4a40",
        "custom-white": "#fefcfb",
        "custom-dark-gray": "#5f5f6c",
        "custom-light-gray": "#f7f7f7",
        "custom-border-gray": "#eeeeee",
        "custom-footer-bg": "#1d2124",
        "sky-lightest": "#CDF5FD",
        "sky-lighter": "#A0E9FF",
        "sky-light": "#89CFF3",
        "sky-bright": "#00A9FF",
        "sky-dark": "#2463EB",
        brand: {
          normal: "#F5F5F5",
          highlight: "#B2C3F8",
          bright: "#2B6CC4",
          background: "#ecf8f8",
          gradient: "linear-gradient(180deg, #D7B590 40%, #C4E1FF 100%)",
          dark: "#39393a",
          darker: "#171717",
        },
        apple: {
          blue: "#0070CD",
          silver: "#D3D3D3",
          spaceGray: "#333333",
          gold: "#D7B590",
          white: "#FFFFFF",
        },
        // globals.css has defined these since the project was scaffolded, but
        // only `sidebar` was ever mapped here — so `bg-popover`, `bg-accent`
        // and friends compiled to nothing and every shadcn primitive rendered
        // with no background. The column picker was the visible symptom: a
        // menu you could read the table rows straight through.
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
