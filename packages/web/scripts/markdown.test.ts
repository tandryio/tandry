import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownBody } from "../src/components/rooms/markdown";

const render = (body: string) =>
  renderToStaticMarkup(createElement(MarkdownBody, { body }));

test("message bodies render as GitHub-flavoured Markdown", () => {
  const html = render(
    "**bold** and `code`\nsecond line\n\n- one\n- [x] two\n\n| a | b |\n| - | - |\n| 1 | 2 |",
  );
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  // remark-breaks keeps the single newline a chat author meant as a new line.
  assert.match(html, /<br\/?>\s*second line/);
  assert.match(html, /<input[^>]*type="checkbox"[^>]*checked/);
  assert.match(html, /<div class="markdown-table"><table>/);
});

test("a message cannot inject markup, scripts or tracking pixels", () => {
  const html = render(
    '<img src=x onerror="alert(1)"><script>alert(1)</script>\n\n' +
      "[click](javascript:alert(1)) and ![pixel](https://tracker.test/p.gif)",
  );
  // Raw HTML arrives as the text it was written as, never as live markup.
  assert.doesNotMatch(html, /<script|<img|onerror="/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<a href=""[^>]*>click<\/a>/);
  // Remote images become links, so reading a message never calls the sender.
  assert.match(html, /<a href="https:\/\/tracker.test\/p.gif"[^>]*>pixel<\/a>/);
  assert.match(html, /rel="noopener noreferrer nofollow ugc"/);
});
