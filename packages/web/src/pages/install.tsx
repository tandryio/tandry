import { SiteHeader } from "../components/layout/site-header";
import { SiteFooter } from "../components/layout/site-footer";
import { Installation } from "../components/landing/installation";
export function Install() {
  return (
    <div className="editorial-site kernal-site install-page">
      <SiteHeader />
      <main id="main">
        <Installation />
      </main>
      <SiteFooter />
    </div>
  );
}
