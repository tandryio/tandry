import { i18nProvider, uiTranslations } from "fumadocs-ui/i18n";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { Brand } from "../../components/layout/brand";
import { REPO_URL } from "../../components/layout/site-header";
import { m } from "../../paraglide/messages";
import { setLocale } from "../../paraglide/runtime";
import { docsI18n } from "./i18n";

/** Fumadocs UI strings; English is the built-in default. */
export const docsTranslations = docsI18n
  .translations()
  .extend(uiTranslations())
  .add({
    en: { displayName: "English" },
    zh: {
      displayName: "简体中文",
      "Search(search dialog)": "搜索文档",
      "Search(search trigger)": "搜索",
      "No results found(search dialog)": "没有找到结果",
      "On this page(table of contents)": "本页内容",
      "No Headings(table of contents)": "本页没有标题",
      "Table of Contents(inline table of contents)": "目录",
      "Next Page(pagination)": "下一页",
      "Previous Page(pagination)": "上一页",
      "Last updated on(page footer)": "最后更新于",
      "Edit on GitHub(edit page)": "在 GitHub 上编辑",
      "Copy Markdown(page actions)": "复制 Markdown",
      "View as Markdown(page actions)": "查看 Markdown",
      "Open(page actions)": "打开",
      "Open in GitHub(page actions)": "在 GitHub 中打开",
      "Choose a language(language switcher)": "选择语言",
      "Page Not Found(404 page)": "页面不存在",
      "Back to Home(404 page)": "返回首页",
      "Show Sidebar(sidebar)": "显示侧栏",
      "Hide Sidebar(sidebar)": "隐藏侧栏",
      "Copied Text(code block)(aria-label)": "已复制",
      "Copy Text(code block)(aria-label)": "复制",
      "Toggle Menu(mobile menu)(aria-label)": "切换菜单",
      "Open Search(search trigger)(aria-label)": "打开搜索",
      "Close Search(search dialog)(aria-label)": "关闭搜索",
    },
  });

/** Provider props for the current site locale, wired to the site's cookie switch. */
export function docsProviderProps(locale: string) {
  return {
    ...i18nProvider(docsTranslations, locale),
    onLocaleChange: (value: string) => setLocale(value === "zh" ? "zh" : "en"),
  };
}

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <Brand className="[&_.brand-mark]:size-7 [&_.brand-wordmark]:text-[21px]" />
      ),
      url: "/",
    },
    githubUrl: REPO_URL,
    themeSwitch: { enabled: false },
    links: [
      { text: m.nav_my_rooms(), url: "/rooms" },
      { text: m.nav_privacy(), url: "/privacy" },
    ],
  };
}
