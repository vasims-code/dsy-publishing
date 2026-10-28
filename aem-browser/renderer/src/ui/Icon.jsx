import * as Lucide from "lucide-react";

export function Icon({ name, ...props }) {
  const C = Lucide[name] || Lucide.Square;
  return <C {...props} />;
}
