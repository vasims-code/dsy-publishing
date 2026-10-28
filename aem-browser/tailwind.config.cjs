/** Rebuilt from the Emergent prototype's compiled CSS: shadcn-style tokens plus
 * the panel/surface/toolbar, status and server colours it adds. */
const tokens = (names) => Object.fromEntries(names.map((n) => [n, `hsl(var(--${n}))`]));
const pair = (name) => ({
  DEFAULT: `hsl(var(--${name}))`,
  foreground: `hsl(var(--${name}-foreground))`,
});

module.exports = {
  // `overline` is a Tailwind utility; without this a label class of that name gets a line drawn above it.
  blocklist: ["overline"],
  darkMode: ["class"],
  content: ["./renderer/index.html", "./renderer/src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        ...tokens(["border", "input", "ring", "background", "foreground", "panel", "surface", "toolbar"]),
        primary: pair("primary"),
        secondary: pair("secondary"),
        destructive: pair("destructive"),
        muted: pair("muted"),
        accent: pair("accent"),
        popover: pair("popover"),
        card: pair("card"),
        status: {
          green: "hsl(var(--status-green))",
          amber: "hsl(var(--status-amber))",
          red: "hsl(var(--status-red))",
          blue: "hsl(var(--status-blue))",
          grey: "hsl(var(--status-grey))",
        },
        server: {
          eu: "hsl(var(--server-eu))",
          asia: "hsl(var(--server-asia))",
          unknown: "hsl(var(--server-unknown))",
        },
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
