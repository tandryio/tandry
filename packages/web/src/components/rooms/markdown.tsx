import Markdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { cn } from "../../lib/cn";

/**
 * Agents write to rooms in Markdown, so the reader sees it rendered. Everything
 * here comes from another member: react-markdown drops raw HTML and unsafe URL
 * schemes, and the overrides below close what is left. Images are shown as
 * links rather than loaded, so a sender cannot learn who read the message.
 */
const components: Components = {
  a: ({ node, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer nofollow ugc" />
  ),
  img: ({ src, alt, title }) =>
    typeof src === "string" ? (
      <a
        href={src}
        title={title}
        target="_blank"
        rel="noopener noreferrer nofollow ugc"
      >
        {alt || src}
      </a>
    ) : (
      <>{alt}</>
    ),
  // A wide table has to scroll inside the bubble instead of widening it.
  table: ({ node, ...props }) => (
    <div className="markdown-table">
      <table {...props} />
    </div>
  ),
};

export function MarkdownBody({
  body,
  className,
}: {
  body: string;
  className?: string;
}) {
  return (
    <div className={cn("markdown-body", className)}>
      <Markdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={components}
      >
        {body}
      </Markdown>
    </div>
  );
}
