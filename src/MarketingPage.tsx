import { useAuth } from "./AuthContext";

export default function MarketingPage() {
  const auth = useAuth();

  const openReferenceCity = async () => {
    await auth.saveProfile({
      city: "Fishers",
      state: "IN",
      vendor: "civicclerk",
      slug: "fishersin",
      isReference: true,
      meetingsIngested: 184,
      sourcesVerified: 3,
      address: "",
    });
    window.location.assign("/dashboard");
  };

  return <div className="marketing-page">
    <header className="marketing-header">
      <a className="marketing-wordmark" href="/">SENTINEL</a>
      <nav aria-label="Account"><a href="/auth">Sign in</a><a className="marketing-start" href="/auth">Get started</a></nav>
    </header>
    <main>
      <section className="marketing-hero">
        <p className="resident-kicker">LOCAL CIVIC INTELLIGENCE · ANY CITY</p>
        <h1>The intelligence developers pay lobbyists for — free, for the residents they’re building next to.</h1>
        <p className="marketing-subhead">Choose a city. Sentinel finds its official public records, verifies the sources live, and turns them into a cited local intelligence feed.</p>
        <div className="marketing-actions"><a className="marketing-primary" href="/auth">Get started</a><button type="button" onClick={() => void openReferenceCity()}>See the reference city →</button></div>
      </section>
      <p className="marketing-proof"><strong>REFERENCE CITY PROOF</strong><span>184 meetings</span><span>167 documents · 20.4M characters</span><span>100 videos · 72,063 transcript cues</span><span>38,915 parcels</span></p>
      <section className="marketing-systems">
        <p className="resident-kicker">WORKS IN ANY CITY</p>
        <h2>Built around the systems local government already uses.</h2>
        <div><article><strong>Meetings</strong><p>CivicClerk, Granicus/Legistar, PrimeGov, and NovusAgenda</p></article><article><strong>Land</strong><p>Esri ArcGIS parcel and zoning services</p></article><article><strong>Video</strong><p>Public YouTube meetings and transcript cues</p></article></div>
      </section>
      <section className="marketing-why">
        <p className="resident-kicker">WHY NOT JUST ASK CHATGPT?</p>
        <h2>Public records beat plausible answers.</h2>
        <ul><li>General chatbots do not carry the complete local record or its source locators.</li><li>Sentinel’s displayed claims resolve to ingested documents or timestamped public meeting video.</li><li>The source boundary is visible: if an official endpoint cannot be verified, Sentinel says so.</li></ul>
      </section>
    </main>
  </div>;
}
