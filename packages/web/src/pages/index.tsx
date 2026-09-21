import { SiteHeader } from "../components/layout/site-header";
import { SiteFooter } from "../components/layout/site-footer";
import { Hero } from "../components/landing/hero";
import { HostMarquee } from "../components/landing/host-marquee";
import { Workflow } from "../components/landing/workflow";
import { Faq } from "../components/landing/faq";
import { ClosingCta } from "../components/landing/closing-cta";
export function Landing() {
  return (
    <div className="editorial-site kernal-site">
      <SiteHeader landing />
      <main id="main">
        <Hero />
        <HostMarquee />
        <Workflow />
        <Faq />
        <ClosingCta />
      </main>
      <SiteFooter />
    </div>
  );
}
