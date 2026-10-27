// ---------------------------------------------------------------------------
// LANDING PAGE composition — cinematic order follows the maquette reference:
// header → hero (Centre.png) → trust/metrics → SOC → architecture → workflow
// → services pillars → online/onsite + partner program → pricing → academy →
// testimonials (ClientsSection, approved content preserved) → final CTA → footer.
// landing.css scopes the dark cyber identity to .ic-landing only; the app
// theme system (themes.css) stays untouched for the product itself.
// ---------------------------------------------------------------------------
import React from 'react';
import Navigation from './landing/Navigation';
import HeroSection from './landing/HeroSection';
import TrustSection from './landing/TrustSection';
import SOCSection from './landing/SOCSection';
import PlatformArchitecture from './landing/PlatformArchitecture';
import SecurityWorkflow from './landing/SecurityWorkflow';
import PlatformPillars from './landing/PlatformPillars';
import ServicesGrid from './landing/ServicesGrid';
import PartnerProgramSection from './landing/PartnerProgramSection';
import PricingSection from './landing/PricingSection';
import AcademySection from './landing/AcademySection';
import ClientsSection from './landing/ClientsSection';
import FinalCTA from './landing/FinalCTA';
import Footer from './landing/Footer';
import './landing/landing.css';

export default function LandingPage() {
  return (
    <div className="ic-landing min-h-screen overflow-x-hidden">
      <Navigation />
      <main>
        <HeroSection />
        <TrustSection />
        <SOCSection />
        <PlatformArchitecture />
        <SecurityWorkflow />
        <PlatformPillars />
        <ServicesGrid />
        <PartnerProgramSection />
        <PricingSection />
        <AcademySection />
        <ClientsSection />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
