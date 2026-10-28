import { cn } from "@/lib/utils";
import { Icon } from "@/ui/Icon";

// Toolbar / tab-strip icon button with a visible focus state.
export function IconButton({ icon, label, active, disabled, className, size = 34, iconSize = 17, ...props }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      data-testid={props["data-testid"] || `icon-btn-${label?.toLowerCase().replace(/\s+/g, "-")}`}
      className={cn(
        "inline-flex items-center justify-center rounded-md text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:pointer-events-none",
        active && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary",
        className
      )}
      style={{ height: size, width: size }}
      {...props}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
}
