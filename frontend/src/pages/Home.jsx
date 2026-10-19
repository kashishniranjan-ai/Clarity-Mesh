import Hero from '../components/Hero';
import AnalyzeSection from '../components/AnalyzeSection';
import HowItWorks from '../components/HowItWorks';
import EnterpriseCommandCenter from '../components/EnterpriseCommandCenter';

export default function Home() {
  return (
    <>
      <Hero />
      <EnterpriseCommandCenter />
      <AnalyzeSection />
      <HowItWorks />
    </>
  );
}
