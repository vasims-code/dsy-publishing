import { cn } from "@/lib/utils";

const DOT = { eu: "bg-server-eu", asia: "bg-server-asia", unknown: "bg-server-unknown" };

export function ServerDot({ region = "unknown", className, size = "sm" }) {
  const s = size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5";
  return <span className={cn("inline-block rounded-full", s, DOT[region] || DOT.unknown, className)} />;
}
