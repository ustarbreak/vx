import React from 'react';
import Navigation from '../components/landing/Navigation';
import HeroSection from '../components/landing/HeroSection';
import PlatformPillars from '../components/landing/PlatformPillars';
import ServicesGrid from '../components/landing/ServicesGrid';
import ClientsSection from '../components/landing/ClientsSection';
import PartnersSection from '../components/landing/PartnersSection';
import MSSPSection from '../components/landing/MSSPSection';
import PricingSection from '../components/landing/PricingSection';
import AcademySection from '../components/landing/AcademySection';
import Footer from '../components/landing/Footer';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white overflow-x-hidden">
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
