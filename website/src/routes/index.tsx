import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "../components/layout/site-header";
import { SiteFooter } from "../components/layout/site-footer";
import { Aurora } from "../components/motion/aurora";
import { Hero } from "../components/landing/hero";
import { HostMarquee } from "../components/landing/host-marquee";
import { Features } from "../components/landing/features";
import { Workflow } from "../components/landing/workflow";
import { Installation } from "../components/landing/installation";
import { Faq } from "../components/landing/faq";
import { ClosingCta } from "../components/landing/closing-cta";

export const Route = createFileRoute("/")({ component: Landing });

function Landing() {
  return (
    <>
      <Aurora />
      <div className="relative z-10">
        <SiteHeader landing />
        <main id="main">
          <Hero />
          <HostMarquee />
          <Features />
          <Workflow />
          <Installation />
          <Faq />
          <ClosingCta />
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
