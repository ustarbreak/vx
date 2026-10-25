import React from 'react';
import Navigation from './landing/Navigation';
import HeroSection from './landing/HeroSection';
import PlatformPillars from './landing/PlatformPillars';
import ServicesGrid from './landing/ServicesGrid';
import ClientsSection from './landing/ClientsSection';
import PartnersSection from './landing/PartnersSection';
import MSSPSection from './landing/MSSPSection';
import PricingSection from './landing/PricingSection';
import AcademySection from './landing/AcademySection';
import Footer from './landing/Footer';

export default function LandingPage() {
  return (
    <div className="min-h-screen ic-page ic-heading overflow-x-hidden">
      <Navigation />
      <HeroSection />
      <PlatformPillars />
      <ServicesGrid />
      <ClientsSection />
      <PartnersSection />
      <MSSPSection />
      <PricingSection />
      <AcademySection />
      <Footer />
    </div>
  );
}
