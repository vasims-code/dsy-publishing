import { cn } from "@/lib/utils";
import { Icon } from "@/ui/Icon";

const VARIANTS = {
  primary: "bg-primary text-primary-foreground hover:brightness-110 disabled:opacity-40",
  secondary: "border border-border bg-card text-foreground hover:bg-muted disabled:opacity-40",
  ghost: "text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40",
  danger: "bg-status-red text-white hover:brightness-110 disabled:opacity-40",
  outlineDanger: "border border-status-red/40 text-status-red hover:bg-status-red/10 disabled:opacity-40",
};
const SIZES = {
  sm: "h-8 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
  lg: "h-10 px-4 text-sm gap-2",
};

export function Button({ variant = "secondary", size = "md", icon, iconRight, className, children, ...props }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium transition-all disabled:pointer-events-none whitespace-nowrap",
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...props}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 14 : 16} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === "sm" ? 14 : 16} />}
    </button>
  );
}

export function LinkButton({ className, children, ...props }) {
  return (
    <button
      type="button"
      className={cn("text-xs font-medium text-primary hover:underline", className)}
      {...props}
    >
      {children}
    </button>
  );
}
