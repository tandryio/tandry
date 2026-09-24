import {
  Archive,
  Ellipsis,
  RefreshCw,
  Trash2,
  X,
  ArrowUp,
  ArrowUpRight,
  AtSign,
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  Code,
  Copy,
  CreditCard,
  Globe,
  Info,
  Link2,
  Lock,
  LogOut,
  CornerUpLeft,
  MessagesSquare,
  Maximize2,
  Minimize2,
  Monitor,
  PenLine,
  Plus,
  Search,
  User,
  type LucideProps,
} from "lucide-react";
import { cn } from "../../lib/cn";

/** Semantic icon names used by the workspace; each maps to a Lucide glyph. */
const icons = {
  more: Ellipsis,
  refresh: RefreshCw,
  trash: Trash2,
  arrow: ArrowUpRight,
  close: X,
  chevron: ChevronDown,
  check: Check,
  plus: Plus,
  rooms: MessagesSquare,
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
  edit: PenLine,
  camera: Camera,
  maximize: Maximize2,
  minimize: Minimize2,
  send: ArrowUp,
  mention: AtSign,
  lock: Lock,
  reply: CornerUpLeft,
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
