"use client";

import { useState, useEffect } from "react";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import Image from "next/image";
import { useData } from "@/context/DataContext";

export function TopBar() {
  const { theme, setTheme } = useTheme();
  const { fileName } = useData();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <header className="sticky top-0 z-[60] flex h-16 items-center justify-between border-b bg-white/80 dark:bg-[rgba(7,13,18,0.80)] backdrop-blur-xl border-border/40 dark:border-white/6 px-4 sm:px-6">
      {/* Left: logo + file name */}
      <div className="flex items-center gap-6">
        <Image src="/SVG Lgo.svg" alt="Logo" width={120} height={28} className="h-7 w-auto flex-shrink-0" priority />
        {fileName && (
          <span className="hidden sm:inline text-sm text-muted-foreground truncate max-w-[500px]">
            {fileName}
          </span>
        )}
      </div>

      {/* Right: theme toggle */}
      <div className="flex items-center gap-2">

        {mounted ? (
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="rounded-full p-2 text-muted-foreground hover:bg-muted dark:hover:bg-white/8 hover:text-foreground transition-all duration-[200ms] ease-[cubic-bezier(0.2,0,0,1)]"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )}
          </button>
        ) : (
          <div className="h-9 w-9" />
        )}
      </div>
    </header>
  );
}
