const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app');
require('firebase/compat/firestore');

const REPO = path.join(__dirname, '..');
const rules = fs.readFileSync(path.join(REPO, 'firestore.rules'), 'utf8');
const adminSrc = fs.readFileSync(path.join(REPO, 'admin.js'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert(start >= 0, 'missing ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}
function extractVar(src, name) {
  const m = src.match(new RegExp('var ' + name + ' = [^;]+;'));
  assert(m, 'missing var ' + name);
  return m[0];
}

const DOC = 'doc1', DATE = '2027-01-11', SVC = 'chirurgia';
const cellId = (t, doc = DOC, date = DATE) => `${doc}_${date}_${t}`;
const mins = t => +t.slice(0, 2) * 60 + +t.slice(3);
const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const cellsFor = (time, dur) => { const out = []; for (let m = mins(time); m < mins(time) + dur; m += 10) out.push(hhmm(m)); return out; };

function apptData(time, dur, extra = {}) {
  return Object.assign({
    slotId: cellId(time), date: DATE, time, patientName: 'Jan', petName: 'Burek',
    phone: '501234567', email: 'a@b.pl', service: SVC, duration: dur, status: 'pending',
    createdAt: firebase.firestore.FieldValue.serverTimestamp(), doctorId: DOC, doctorName: 'Dr X'
  }, extra);
}
function book(db, time, dur, opts = {}) {
  const batch = db.batch();
  const apptRef = db.collection('appointments').doc();
  (opts.cells || cellsFor(time, dur)).forEach(t => {
    const cell = { date: DATE, time: t, doctorId: DOC, duration: 10, appointmentId: apptRef.id };
    if (opts.noOwner) delete cell.appointmentId;
    batch.set(db.collection('slots').doc(cellId(t)), cell);
  });
  if (!opts.noAppt) batch.set(apptRef, apptData(time, dur, opts.appt));
  return { commit: batch.commit(), id: apptRef.id };
}

(async () => {
  const env = await initializeTestEnvironment({
    projectId: 'demo-vet', firestore: { rules, host: '127.0.0.1', port: 8181 }
  });
  const results = [];
  async function check(name, fn) {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      await db.collection('doctors').doc(DOC).set({ name: 'Dr X' });
      await db.collection('roles').doc('staff1').set({ role: 'admin' });
      await db.collection('roles').doc(DOC).set({ role: 'doctor' });
    });
    try { await fn(); results.push('PASS ' + name); }
    catch (e) { results.push('FAIL ' + name + ' :: ' + e.message); }
  }
  const anonDb = env.unauthenticatedContext().firestore();
  const anon = () => anonDb;

  await check('public booking of 90 min (9 cells) succeeds', () => assertSucceeds(book(anon(), '10:00', 90).commit));
// The emulator does not enforce the 20-read limit, so this only shows the rules
// accept 18 cells. The 180-minute cap is what keeps production under it.
  await check('public booking of 180 min (18 cells) is accepted', () => assertSucceeds(book(anon(), '08:00', 180).commit));
  await check('public booking over 180 min is denied', () => assertFails(book(anon(), '08:00', 190).commit));
  await check('orphan cell with no appointment is denied', () => assertFails(book(anon(), '10:00', 10, { noAppt: true }).commit));
  await check('cell without appointmentId is denied', () => assertFails(book(anon(), '10:00', 10, { noOwner: true }).commit));
  await check('cell outside its appointment range is denied', () =>
    assertFails(book(anon(), '10:00', 20, { cells: ['10:00', '10:10', '14:00'] }).commit));
  await check('off-grid appointment time is denied', () =>
    assertFails(book(anon(), '10:05', 20, { cells: ['10:00', '10:10'], appt: { slotId: cellId('10:00') } }).commit));
  await check('slotId not matching the appointment time is denied', () =>
    assertFails(book(anon(), '10:00', 20, { appt: { slotId: cellId('10:10') } }).commit));
  await check('new cells cannot be attached to an existing appointment', async () => {
    const first = book(anon(), '10:00', 20);
    await assertSucceeds(first.commit);
    await assertFails(anon().collection('slots').doc(cellId('15:00')).set(
      { date: DATE, time: '15:00', doctorId: DOC, duration: 10, appointmentId: first.id }));
  });
  await check('taking an already booked cell is denied', async () => {
    await assertSucceeds(book(anon(), '10:00', 30).commit);
    await assertFails(book(anon(), '10:20', 20).commit);
  });

  const harness = [
    extractVar(adminSrc, 'SLOT_CELL_MIN'), extractVar(adminSrc, 'SLOT_CELL_ID_RE'),
    extractFn(adminSrc, 'timeToMins'), extractFn(adminSrc, 'minsToTime'),
    extractFn(adminSrc, 'visitCellTimes'), extractFn(adminSrc, 'slotCellId'),
    'var servicesBySlug = {};', extractFn(adminSrc, 'visitDuration'),
    extractFn(adminSrc, 'changeVisit'), 'return changeVisit;'
  ].join('\n');
  const staffDb = env.authenticatedContext('staff1').firestore();
  const staffChangeVisit = () => {
    const window = { PawsomeDB: staffDb };
    return new Function('window', harness)(window);
  };
  const cellOwners = async () => {
    const out = {};
    await env.withSecurityRulesDisabled(async ctx => {
      const snap = await ctx.firestore().collection('slots').get();
      snap.forEach(d => { out[d.data().time] = d.data().appointmentId; });
    });
    return out;
  };

  await check('rejecting a forged long visit keeps other visits cells', async () => {
    const real = book(anon(), '10:00', 30); await real.commit;
    const forged = book(anon(), '09:00', 180, { cells: ['09:00'] }); await forged.commit;
    await staffChangeVisit()(forged.id, { status: 'rejected' });
    const owners = await cellOwners();
    assert.deepStrictEqual(Object.keys(owners).sort(), ['10:00', '10:10', '10:20']);
    assert(Object.values(owners).every(o => o === real.id), 'real visit still owns its cells');
  });
  await check('accepting a visit that overlaps another visits cells fails', async () => {
    await book(anon(), '10:00', 30).commit;
    const forged = book(anon(), '09:00', 180, { cells: ['09:00'] }); await forged.commit;
    await assert.rejects(staffChangeVisit()(forged.id, { status: 'accepted' }), e => e.code === 'slot-taken');
  });
  await check('moving a visit releases its own cells and claims new ones', async () => {
    const v = book(anon(), '10:00', 20); await v.commit;
    await staffChangeVisit()(v.id, { time: '12:00' });
    assert.deepStrictEqual(await cellOwners(), { '12:00': v.id, '12:10': v.id });
  });
  await check('rejecting a normal visit frees its cells', async () => {
    const v = book(anon(), '10:00', 20); await v.commit;
    await staffChangeVisit()(v.id, { status: 'rejected' });
    assert.deepStrictEqual(await cellOwners(), {});
  });

  const userDbs = {};
  const asUser = uid => userDbs[uid] || (userDbs[uid] = env.authenticatedContext(uid).firestore());
  const seededVisit = async () => {
    const v = book(anon(), '10:00', 20); await v.commit; return v.id;
  };

  await check('anonymous visitors cannot read visits', async () => {
    const id = await seededVisit();
    await assertFails(anon().collection('appointments').doc(id).get());
    await assertFails(anon().collection('appointments').get());
  });
  await check('signed-in users without a role cannot read visits', async () => {
    const id = await seededVisit();
    await assertFails(asUser('stranger').collection('appointments').doc(id).get());
  });
  await check('a public visit must be pending', () =>
    assertFails(book(anon(), '10:00', 20, { appt: { status: 'accepted' } }).commit));
  await check('a public visit needs an existing doctor', async () => {
    const db = anon();
    const batch = db.batch();
    const ref = db.collection('appointments').doc();
    batch.set(db.collection('slots').doc(cellId('10:00', 'ghost')),
      { date: DATE, time: '10:00', doctorId: 'ghost', duration: 10, appointmentId: ref.id });
    batch.set(ref, apptData('10:00', 10, { doctorId: 'ghost', slotId: cellId('10:00', 'ghost') }));
    await assertFails(batch.commit());
  });
  await check('a public visit with an invalid phone is denied', () =>
    assertFails(book(anon(), '10:00', 20, { appt: { phone: '12345' } }).commit));
  await check('a public visit with extra fields is denied', () =>
    assertFails(book(anon(), '10:00', 20, { appt: { notes: 'x' } }).commit));
  await check('anonymous visitors cannot write roles, doctors or schedules', async () => {
    await assertFails(anon().collection('roles').doc('x').set({ role: 'admin' }));
    await assertFails(anon().collection('doctors').doc('x').set({ name: 'x' }));
    await assertFails(anon().collection('doctorSchedules').doc(DOC).set({ days: {} }));
  });
  await check('a signed-in user cannot grant themselves a role', () =>
    assertFails(asUser('stranger').collection('roles').doc('stranger').set({ role: 'admin' })));
  await check('a doctor edits only their own schedule', async () => {
    await assertSucceeds(asUser(DOC).collection('doctorSchedules').doc(DOC).set({ days: {} }));
    await assertFails(asUser(DOC).collection('doctorSchedules').doc('doc2').set({ days: {} }));
  });
  await check('staff cannot move a visit to another doctor', async () => {
    const id = await seededVisit();
    await assertFails(asUser(DOC).collection('appointments').doc(id).update({ doctorId: 'doc2' }));
    await assertSucceeds(asUser(DOC).collection('appointments').doc(id).update({ notes: 'ok' }));
  });
  await check('an admin adds and removes a doctor in one batch each', async () => {
    const db = asUser('staff1');
    const add = db.batch();
    add.set(db.collection('doctors').doc('doc2'), { name: 'Dr Y', specialty: '' });
    add.set(db.collection('roles').doc('doc2'), { role: 'doctor' });
    await assertSucceeds(add.commit());
    const remove = db.batch();
    remove.delete(db.collection('roles').doc('doc2'));
    remove.delete(db.collection('doctorSchedules').doc('doc2'));
    remove.delete(db.collection('doctors').doc('doc2'));
    await assertSucceeds(remove.commit());
  });

  await env.cleanup();
  console.log(results.join('\n'));
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
