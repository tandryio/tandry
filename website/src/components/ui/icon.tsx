import {
  Archive,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  Code,
  Copy,
  CreditCard,
  Globe,
  Info,
  LayoutGrid,
  Link2,
  LogOut,
  Monitor,
  Plus,
  Search,
  User,
  type LucideProps,
} from "lucide-react";
import { cn } from "../../lib/cn";

/** Semantic icon names used by the workspace; each maps to a Lucide glyph. */
const icons = {
  arrow: ArrowUpRight,
  chevron: ChevronDown,
  check: Check,
  plus: Plus,
  rooms: LayoutGrid,
  user: User,
  globe: Globe,
  copy: Copy,
  archive: Archive,
  link: Link2,
  monitor: Monitor,
  code: Code,
  info: Info,
  search: Search,
  logout: LogOut,
  book: BookOpen,
  credit: CreditCard,
} as const;

export type IconName = keyof typeof icons;

export function Icon({
  name,
  className,
  ...props
}: { name: IconName } & Omit<LucideProps, "ref">) {
  const Glyph = icons[name];
  return (
    <Glyph
      strokeWidth={1.6}
      aria-hidden="true"
      {...props}
      className={cn("ui-icon", className)}
    />
  );
}
