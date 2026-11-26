// Clinic services, in display order. The booking page offers the active ones;
// the admin panel uses names and durations to show visits. Durations are in
// minutes, at most 180 (firestore.rules caps a public booking there). Each
// service also has its own page, <slug>.html, and a card on index.html.
window.PawsomeServices = [
  { slug: 'badania-profilaktyczne', name: 'Badania profilaktyczne', duration: 20, active: true },
  { slug: 'szczepienia', name: 'Szczepienia', duration: 20, active: true },
  { slug: 'stomatologia', name: 'Stomatologia', duration: 60, active: false },
  { slug: 'diagnostyka', name: 'Diagnostyka', duration: 30, active: true },
  { slug: 'chirurgia', name: 'Chirurgia', duration: 90, active: true },
  { slug: 'plany-zywieniowe', name: 'Plany żywieniowe', duration: 30, active: true }
];
