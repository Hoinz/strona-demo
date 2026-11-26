const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

const sandbox = { window: {} };
vm.runInNewContext(read('services.js'), sandbox);
const services = sandbox.window.PawsomeServices;
const servicePages = services.map(s => s.slug + '.html');
const publicPages = ['index.html', 'umow-wizyte.html', ...servicePages];

const swAssets = vm.runInNewContext(read('sw.js').match(/const ASSETS = (\[[^\]]*\]);/)[1]);
for (const asset of swAssets) {
  check(asset === './' || fs.existsSync(path.join(ROOT, asset)), `sw.js ASSETS lists missing file ${asset}`);
}

const index = read('index.html');
for (const svc of services) {
  const page = svc.slug + '.html';
  check(fs.existsSync(path.join(ROOT, page)), `${svc.slug} has no ${page}`);
  check(swAssets.includes(page), `${page} is not in sw.js ASSETS`);
  check(svc.duration % 10 === 0 && svc.duration <= 180, `${svc.slug} duration ${svc.duration} is not a multiple of 10 up to 180`);

  const card = index.match(new RegExp(`<a href="${page}" class="([^"]*)">`));
  check(card, `index.html has no service card for ${page}`);
  if (card) check(card[1].includes('inactive') === !svc.active, `index.html card for ${svc.slug} disagrees with active=${svc.active}`);

  if (fs.existsSync(path.join(ROOT, page))) {
    const html = read(page);
    check(html.includes('service-unavailable-banner">') === !svc.active, `${page} unavailable banner disagrees with active=${svc.active}`);
    check(html.includes('class="service-cta"') === svc.active, `${page} booking button disagrees with active=${svc.active}`);
  }
}

const expectedFooter = services.map(s => s.slug + '.html');
for (const page of publicPages) {
  if (!fs.existsSync(path.join(ROOT, page))) continue;
  const html = read(page);
  const column = html.match(/<h4>Usługi<\/h4>([\s\S]*?)<\/div>/);
  const links = column ? [...column[1].matchAll(/href="([^"]+)"/g)].map(m => m[1]) : [];
  check(JSON.stringify(links) === JSON.stringify(expectedFooter), `${page} footer services ${links.join(',')} differ from services.js`);

  const phones = new Set([...html.matchAll(/href="tel:([^"]+)"/g)].map(m => m[1]));
  const emails = new Set([...html.matchAll(/href="mailto:([^"?]+)/g)].map(m => m[1]));
  check([...phones].every(p => p === '+48225557799'), `${page} links a different phone number: ${[...phones]}`);
  check([...emails].every(e => e === 'hello@pawsomevet.pl'), `${page} links a different email: ${[...emails]}`);
}

const clinicHours = file => read(file).match(/var CLINIC_HOURS = (\{[\s\S]*?\n {2}\});/)[1].replace(/\/\/.*$/gm, '').replace(/\s+/g, '');
check(clinicHours('booking.js') === clinicHours('admin.js'), 'CLINIC_HOURS differs between booking.js and admin.js');

const cellSize = (file, name) => Number(read(file).match(new RegExp(`var ${name} = (\\d+);`))[1]);
const rules = read('firestore.rules');
check(cellSize('booking.js', 'SLOT_DURATION') === 10 && cellSize('admin.js', 'SLOT_CELL_MIN') === 10,
  'booking.js and admin.js must both use 10-minute cells, as firestore.rules does');
check(rules.includes('cell.duration == 10') && rules.includes('duration <= 180'),
  'firestore.rules no longer pins 10-minute cells and the 180-minute cap');

if (failures.length) {
  console.error(failures.map(f => 'FAIL ' + f).join('\n'));
  process.exit(1);
}
console.log(`PASS site consistency (${services.length} services, ${publicPages.length} pages, ${swAssets.length} cached assets)`);
