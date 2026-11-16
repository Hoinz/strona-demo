// Booking system for Pawsome Vet
(function() {
  'use strict';

  // ── CONFIG ──
  var CLINIC_HOURS = {
    1: { open: '08:00', close: '20:00' }, // Monday
    2: { open: '08:00', close: '20:00' },
    3: { open: '08:00', close: '20:00' },
    4: { open: '08:00', close: '20:00' },
    5: { open: '08:00', close: '20:00' },
    6: { open: '08:00', close: '20:00' }, // Saturday
    0: { open: '09:00', close: '17:00' }  // Sunday
  };
  var SLOT_DURATION = 10; // minutes

  var SERVICES = {
    'badania-profilaktyczne': 'Badania profilaktyczne',
    'szczepienia': 'Szczepienia',
    'stomatologia': 'Stomatologia',
    'chirurgia': 'Chirurgia',
    'diagnostyka': 'Diagnostyka',
    'plany-zywieniowe': 'Plany żywieniowe'
  };

  // Default visit duration in minutes per service
  var SERVICE_DURATIONS = {
    'badania-profilaktyczne': 20,
    'szczepienia': 20,
    'stomatologia': 60,
    'chirurgia': 90,
    'diagnostyka': 30,
    'plany-zywieniowe': 30
  };

  var MONTH_NAMES = [
    'Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec',
    'Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'
  ];

  // ── STATE ──
  var currentMonth, currentYear;
  var selectedDate = null;
  var selectedTime = null;
  var selectedService = null;
  var urlService = null;
  var takenSlots = {};         // dateStr → [{ start, end }] in minutes, for the selected doctor
  var scheduleOverrides = {};
  var selectedDoctor = null;   // { id, name, specialty }
  var doctors = [];
  var unsubscribeSlots = null;
  var unsubscribeSchedule = null;
  var monthDataGen = 0;        // bumped on every month-listener teardown; stale callbacks compare against it
  var doctorScheduleData = null;
  var doctorScheduleLoaded = false; // false until the selected doctor's schedule listener answered
  var unsubscribeDoctorSchedule = null;

  // ── DOM ──
  var calendarDays = document.getElementById('calendar-days');
  var calendarTitle = document.getElementById('calendar-title');
  var btnPrev = document.getElementById('cal-prev');
  var btnNext = document.getElementById('cal-next');
  var timeSlotsSection = document.getElementById('time-slots-section');
  var timeSlotsGrid = document.getElementById('time-slots-grid');
  var timeSlotsDate = document.getElementById('time-slots-date');
  var formSection = document.getElementById('booking-form-section');
  var bookingForm = document.getElementById('booking-form');
  var summaryEl = document.getElementById('booking-summary');
  var messageEl = document.getElementById('booking-message');
  var successOverlay = document.getElementById('booking-success-overlay');
  if (successOverlay) {
    document.getElementById('booking-popup-close').addEventListener('click', function() {
      successOverlay.classList.remove('visible');
    });
    successOverlay.addEventListener('click', function(e) {
      if (e.target === successOverlay) successOverlay.classList.remove('visible');
    });
  }
  var offlineNotice = document.getElementById('offline-notice');
  var servicePickerSection = document.getElementById('service-picker-section');
  var doctorGrid = document.getElementById('doctor-grid');
  var calendarSection = document.querySelector('.calendar');

  // ── HELPERS ──
  function formatDate(year, month, day) {
    return year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }

  function formatDateDisplay(dateStr) {
    var parts = dateStr.split('-');
    return parts[2] + '.' + parts[1] + '.' + parts[0];
  }

  function timeToMins(time) {
    var parts = time.split(':');
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  }

  function minsToTime(mins) {
    return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
  }

  // True when [start, end) overlaps any taken range of a day
  function overlapsTaken(ranges, start, end) {
    for (var i = 0; i < ranges.length; i++) {
      if (start < ranges[i].end && end > ranges[i].start) return true;
    }
    return false;
  }

  // Grid cells (start minutes) occupied by a visit: every SLOT_DURATION cell
  // overlapping [start, start + duration). Each cell is one lock document in
  // `slots` — the same contract is used by admin.js.
  function visitCells(startMins, duration) {
    var cells = [];
    var from = Math.floor(startMins / SLOT_DURATION) * SLOT_DURATION;
    var to = Math.ceil((startMins + duration) / SLOT_DURATION) * SLOT_DURATION;
    for (var m = from; m < to; m += SLOT_DURATION) cells.push(m);
    return cells;
  }

  function slotCellId(doctorId, dateStr, cellMins) {
    return doctorId + '_' + dateStr + '_' + minsToTime(cellMins);
  }

  // True once the doctor has ever saved working hours: per-day entries, a
  // weekly template, or `lastWeek` (the hours last entered in "Ustal grafik",
  // which survives the pruning of old per-day entries).
  function hasWorkingHours(sched) {
    if (!sched) return false;
    if (sched.lastWeek || sched.defaultWeek || sched.weeklyHours) return true; // lastWeek is null until hours are applied
    return !!sched.days && Object.keys(sched.days).length > 0;
  }

  // Doctor's config for a date: per-day entry > weekly template (only inside
  // its validity period). Returns undefined when the doctor has nothing set
  // for that date: a doctor who never set working hours then gets clinic
  // hours, one who did is simply not bookable that day.
  function resolveDoctorDay(sched, dayOfWeek, dateStr) {
    if (!sched) return undefined;
    var day = sched.days && dateStr && sched.days[dateStr];
    if (day) return day;
    if (dateStr) {
      if (sched.validFrom && dateStr < sched.validFrom) return undefined;
      if (sched.validUntil && dateStr > sched.validUntil) return undefined;
    }
    var dow = String(dayOfWeek);
    return (sched.defaultWeek && sched.defaultWeek[dow]) ||
           (sched.weeklyHours && sched.weeklyHours[dow]) || undefined;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── PHONE VALIDATION ──
  var MOBILE_PREFIXES = ['45','50','51','53','57','60','66','69','72','73','78','79','88'];

  function normalizePhone(raw) {
    var s = String(raw || '').replace(/[\s\-().]/g, '');
    if (s.charAt(0) === '+') s = s.slice(1);
    if (s.startsWith('48') && s.length === 11) s = s.slice(2);
    else if (s.charAt(0) === '0') s = s.slice(1);
    return s;
  }

  function isValidPolishMobile(raw) {
    var num = normalizePhone(raw);
    return /^\d{9}$/.test(num) && MOBILE_PREFIXES.indexOf(num.slice(0, 2)) !== -1;
  }

  // ── LOAD SERVICES FROM FIRESTORE ──
  function loadServicesFromFirestore(callback) {
    var db = window.PawsomeDB;
    if (!db) { callback(); return; }
    db.collection('services').where('active', '==', true).orderBy('displayOrder').get()
      .then(function(snapshot) {
        if (snapshot.empty) { callback(); return; }
        var newServices = {};
        var newDurations = {};
        snapshot.forEach(function(doc) {
          var d = doc.data();
          newServices[d.slug] = d.name;
          newDurations[d.slug] = d.duration || 30;
        });
        SERVICES = newServices;
        SERVICE_DURATIONS = newDurations;
        callback();
      })
      .catch(function() { callback(); });
  }

  function renderServicePicker() {
    if (!servicePickerSection) return;
    var grid = servicePickerSection.querySelector('.doctor-grid');
    if (!grid) return;
    grid.innerHTML = '';
    var keys = Object.keys(SERVICES);
    keys.forEach(function(key) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'doctor-card';
      btn.dataset.service = key;
      btn.innerHTML =
        '<div class="doctor-card-name">' + escapeHtml(SERVICES[key]) + '</div>' +
        '<div class="doctor-card-specialty">' + (SERVICE_DURATIONS[key] || 30) + ' min</div>';
      btn.addEventListener('click', function() { selectService(key, btn); });
      grid.appendChild(btn);
    });
  }

  // ── INIT ──
  function init() {
    var now = new Date();
    currentMonth = now.getMonth();
    currentYear = now.getFullYear();

    // Store URL service param — auto-applied after doctor is chosen
    var params = new URLSearchParams(window.location.search);
    urlService = params.get('service');

    btnPrev.addEventListener('click', function() { changeMonth(-1); });
    btnNext.addEventListener('click', function() { changeMonth(1); });
    bookingForm.addEventListener('submit', handleSubmit);

    var phoneField = document.getElementById('field-phone');
    if (phoneField) {
      phoneField.addEventListener('input', function() {
        var err = document.getElementById('phone-error');
        if (err) err.classList.remove('visible');
      });
    }

    // Render service picker dynamically
    renderServicePicker();

    if (!navigator.onLine) {
      offlineNotice.classList.add('visible');
    }
    window.addEventListener('online', function() { offlineNotice.classList.remove('visible'); });
    window.addEventListener('offline', function() { offlineNotice.classList.add('visible'); });

    if (calendarSection) calendarSection.style.display = 'none';
    loadDoctors(); // calendar shown only after doctor selection
  }

  // ── MONTH NAVIGATION ──
  function changeMonth(delta) {
    currentMonth += delta;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    loadMonthData();
  }

  // ── LOAD DOCTORS ──
  function loadDoctors() {
    var db = window.PawsomeDB;
    if (!db) { doctorGrid.innerHTML = '<div class="doctor-loading">Błąd połączenia</div>'; return; }
    db.collection('doctors').get().then(function(snapshot) {
      doctors = [];
      snapshot.forEach(function(doc) {
        doctors.push({ id: doc.id, name: doc.data().name, specialty: doc.data().specialty });
      });
      renderDoctors();
    }).catch(function() {
      doctorGrid.innerHTML = '<div class="doctor-loading">Nie można załadować lekarzy</div>';
    });
  }

  function renderDoctors() {
    if (doctors.length === 0) {
      doctorGrid.innerHTML = '<div class="doctor-loading">Brak dostępnych lekarzy</div>';
      return;
    }
    doctorGrid.innerHTML = '';
    doctors.forEach(function(doctor) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'doctor-card';
      btn.innerHTML =
        '<div class="doctor-card-name">' + escapeHtml(doctor.name) + '</div>' +
        '<div class="doctor-card-specialty">' + escapeHtml(doctor.specialty) + '</div>';
      btn.addEventListener('click', function() { selectDoctor(doctor, btn); });
      doctorGrid.appendChild(btn);
    });
  }

  function selectDoctor(doctor, btn) {
    selectedDoctor = doctor;
    selectedDate = null;
    selectedTime = null;
    selectedService = null;
    takenSlots = {};
    doctorGrid.querySelectorAll('.doctor-card').forEach(function(b) { b.classList.remove('selected'); });
    btn.classList.add('selected');
    if (calendarSection) calendarSection.style.display = 'none';
    timeSlotsSection.classList.remove('visible');
    formSection.classList.remove('visible');
    messageEl.classList.remove('visible');
    if (servicePickerSection) {
      servicePickerSection.style.display = '';
      servicePickerSection.querySelectorAll('.doctor-card').forEach(function(c) { c.classList.remove('selected'); });
    }
    // The calendar is hidden until a service is picked; stop the previous
    // doctor's month listeners so they cannot write into takenSlots meanwhile
    teardownMonthListeners();
    // Set up per-doctor schedule listener
    if (unsubscribeDoctorSchedule) { unsubscribeDoctorSchedule(); unsubscribeDoctorSchedule = null; }
    doctorScheduleData = null;
    doctorScheduleLoaded = false;
    if (window.PawsomeDB) {
      var reloadCalendar = function() {
        doctorScheduleLoaded = true;
        if (selectedService && calendarSection && calendarSection.style.display !== 'none') {
          loadMonthData();
        }
      };
      unsubscribeDoctorSchedule = window.PawsomeDB.collection('doctorSchedules').doc(doctor.id)
        .onSnapshot(function(doc) {
          doctorScheduleData = doc.exists ? doc.data() : null;
          reloadCalendar();
        }, function() {
          doctorScheduleData = null;
          reloadCalendar();
        });
    }

    // Auto-apply URL service param once
    if (urlService && servicePickerSection) {
      var match = servicePickerSection.querySelector('[data-service="' + urlService + '"]');
      urlService = null;
      if (match) { selectService(match.dataset.service, match); return; }
    }
  }

  function selectService(serviceKey, btn) {
    selectedService = serviceKey;
    selectedDate = null;
    selectedTime = null;
    if (servicePickerSection) {
      servicePickerSection.querySelectorAll('.doctor-card').forEach(function(c) { c.classList.remove('selected'); });
    }
    btn.classList.add('selected');
    if (calendarSection) calendarSection.style.display = '';
    timeSlotsSection.classList.remove('visible');
    formSection.classList.remove('visible');
    loadMonthData();
  }

  // ── LOAD DATA FROM FIRESTORE (real-time listeners) ──
  function teardownMonthListeners() {
    monthDataGen++;
    if (unsubscribeSlots) { unsubscribeSlots(); unsubscribeSlots = null; }
    if (unsubscribeSchedule) { unsubscribeSchedule(); unsubscribeSchedule = null; }
  }

  function loadMonthData() {
    var db = window.PawsomeDB;

    // Tear down previous listeners before setting up new ones
    teardownMonthListeners();

    if (!db || !selectedDoctor) { renderCalendar(); return; }

    var gen = monthDataGen;
    var doctorId = selectedDoctor.id;
    var startDate = formatDate(currentYear, currentMonth, 1);
    var lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();
    var endDate = formatDate(currentYear, currentMonth, lastDay);

    // Local caches for each listener; merged in applyData()
    var slotsCache = [];
    var overridesCache = {};
    var slotsReady = false;
    var scheduleReady = false;

    function applyData() {
      if (gen !== monthDataGen) return; // listeners were replaced (month or doctor change)
      // Wait for the doctor's own schedule too: rendering without it would
      // briefly offer clinic hours on days the doctor does not work
      if (!slotsReady || !scheduleReady || !doctorScheduleLoaded) return;

      // Rebuild takenSlots from live slot documents
      var monthTaken = {};
      slotsCache.forEach(function(d) {
        var startMins = timeToMins(d.time);
        if (!monthTaken[d.date]) monthTaken[d.date] = [];
        monthTaken[d.date].push({ start: startMins, end: startMins + (d.duration || SLOT_DURATION) });
      });

      // Clear this month's stale entries then apply fresh data
      Object.keys(takenSlots).forEach(function(k) {
        if (k >= startDate && k <= endDate) delete takenSlots[k];
      });
      Object.keys(scheduleOverrides).forEach(function(k) {
        if (k >= startDate && k <= endDate) delete scheduleOverrides[k];
      });
      Object.keys(monthTaken).forEach(function(k) { takenSlots[k] = monthTaken[k]; });
      Object.keys(overridesCache).forEach(function(k) { scheduleOverrides[k] = overridesCache[k]; });

      renderCalendar();

      // Re-render open time slots panel if it's showing a date in this month
      if (selectedDate && selectedDate >= startDate && selectedDate <= endDate) {
        var parts = selectedDate.split('-');
        var dow = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])).getDay();
        renderTimeSlots(selectedDate, dow);

        if (selectedTime) {
          // Re-apply the selected highlight lost during re-render
          var stillOffered = false;
          timeSlotsGrid.querySelectorAll('.time-slot').forEach(function(b) {
            if (b.textContent === selectedTime) { b.classList.add('selected'); stillOffered = true; }
          });
          if (!stillOffered) {
            // Slot just got taken by someone else (or the schedule changed) — clear selection
            selectedTime = null;
            formSection.classList.remove('visible');
          }
        }
      }
    }

    // Slots of the selected doctor only, filtered on the server. That query
    // needs the composite index (doctorId ASC, date ASC); until it is deployed
    // Firestore rejects it with failed-precondition and we fall back once to
    // the date-range-only query, filtering by doctor in the browser.
    function listenSlots(byDoctor) {
      var query = db.collection('slots');
      if (byDoctor) query = query.where('doctorId', '==', doctorId);
      unsubscribeSlots = query
        .where('date', '>=', startDate)
        .where('date', '<=', endDate)
        .onSnapshot(function(snapshot) {
          if (gen !== monthDataGen) return;
          slotsCache = [];
          snapshot.forEach(function(doc) {
            var d = doc.data();
            if (d.doctorId === doctorId) slotsCache.push(d);
          });
          slotsReady = true;
          applyData();
        }, function(err) {
          // Month or doctor changed in the meantime — never re-attach for the old one
          if (gen !== monthDataGen) return;
          if (byDoctor && err && err.code === 'failed-precondition') {
            console.warn('Slots index missing, falling back to client-side doctor filter');
            listenSlots(false);
            return;
          }
          console.error('Slots listener failed:', err);
          slotsReady = true;
          applyData();
        });
    }
    listenSlots(true);

    unsubscribeSchedule = db.collection('schedule')
      .where(firebase.firestore.FieldPath.documentId(), '>=', startDate)
      .where(firebase.firestore.FieldPath.documentId(), '<=', endDate)
      .onSnapshot(function(snapshot) {
        overridesCache = {};
        snapshot.forEach(function(doc) { overridesCache[doc.id] = doc.data(); });
        scheduleReady = true;
        applyData();
      }, function() {
        scheduleReady = true;
        applyData();
      });
  }

  // ── RENDER CALENDAR ──
  function renderCalendar() {
    calendarTitle.textContent = MONTH_NAMES[currentMonth] + ' ' + currentYear;
    calendarDays.innerHTML = '';

    var firstDay = new Date(currentYear, currentMonth, 1).getDay();
    var startOffset = (firstDay === 0 ? 6 : firstDay - 1);
    var daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    for (var i = 0; i < startOffset; i++) {
      var empty = document.createElement('button');
      empty.className = 'calendar-day empty';
      empty.disabled = true;
      calendarDays.appendChild(empty);
    }

    for (var day = 1; day <= daysInMonth; day++) {
      var btn = document.createElement('button');
      btn.className = 'calendar-day';
      btn.textContent = day;

      var date = new Date(currentYear, currentMonth, day);
      var dateStr = formatDate(currentYear, currentMonth, day);
      var isPast = date < today;
      var override = scheduleOverrides[dateStr];
      var isClosed = override && override.closed;

      var daySlots = generateTimeSlots(date.getDay(), override, dateStr, doctorScheduleData);
      var totalSlots = daySlots.length;
      var dayTaken = takenSlots[dateStr] || [];
      var availableSlots = 0;
      for (var s = 0; s < daySlots.length; s++) {
        var slotStart = timeToMins(daySlots[s]);
        if (!overlapsTaken(dayTaken, slotStart, slotStart + SLOT_DURATION)) availableSlots++;
      }

      if (isPast || isClosed || totalSlots === 0) {
        // Past, clinic closed, or the doctor does not work that day
        btn.classList.add('disabled');
        btn.disabled = true;
      } else if (availableSlots === 0) {
        btn.classList.add('fully-booked');
        btn.disabled = true;
      } else {
        btn.classList.add('has-slots');
      }

      if (date.getTime() === today.getTime()) {
        btn.classList.add('today');
      }

      if (selectedDate === dateStr) {
        btn.classList.add('selected');
      }

      if (!btn.disabled) {
        (function(ds, dow) {
          btn.addEventListener('click', function() { selectDate(ds, dow); });
        })(dateStr, date.getDay());
      }

      calendarDays.appendChild(btn);
    }
  }

  // ── SELECT DATE ──
  function selectDate(dateStr, dayOfWeek) {
    selectedDate = dateStr;
    selectedTime = null;

    calendarDays.querySelectorAll('.calendar-day').forEach(function(b) { b.classList.remove('selected'); });
    var dayNum = parseInt(dateStr.split('-')[2]);
    calendarDays.querySelectorAll('.calendar-day:not(.empty)').forEach(function(b) {
      if (parseInt(b.textContent) === dayNum) b.classList.add('selected');
    });

    renderTimeSlots(dateStr, dayOfWeek);
    formSection.classList.remove('visible');
    messageEl.classList.remove('visible');
  }

  // ── GENERATE TIME SLOTS ──
  // Bookable 10-min cells for one doctor on one day. `sched` is that doctor's
  // doctorSchedules document (or null when they have none).
  function generateTimeSlots(dayOfWeek, override, dateStr, sched) {
    if (override && override.closed) return [];

    var doctorDay = resolveDoctorDay(sched, dayOfWeek, dateStr);

    // A doctor who has set working hours is bookable only on days those hours
    // cover. The clinic-hours fallback below is for doctors who never set any
    // (no schedule document, or one holding nothing but time blocks).
    if (!doctorDay && hasWorkingHours(sched)) return [];
    if (doctorDay && !doctorDay.active) return [];

    var hours;
    if (doctorDay && doctorDay.active) {
      hours = { open: doctorDay.start, close: doctorDay.end };
    } else if (override) {
      hours = { open: override.openTime || CLINIC_HOURS[dayOfWeek].open, close: override.closeTime || CLINIC_HOURS[dayOfWeek].close };
    } else {
      hours = CLINIC_HOURS[dayOfWeek];
    }
    if (!hours) return [];

    var blocked = (override && override.blockedSlots) ? override.blockedSlots.slice() : [];

    // Pauses and the doctor's blocked time ranges, in minutes
    var pauses = (doctorDay && doctorDay.pauses) || [];
    var blockedRanges = pauses.map(function(p) {
      return { start: timeToMins(p.start), end: timeToMins(p.end) };
    });
    if (sched && sched.busyBlocks && dateStr) {
      sched.busyBlocks.forEach(function(bb) {
        if (bb.date !== dateStr) return;
        blockedRanges.push({ start: timeToMins(bb.startTime), end: timeToMins(bb.endTime) });
      });
    }

    var slots = [];
    var mins = timeToMins(hours.open);
    var endMins = timeToMins(hours.close);

    while (mins + SLOT_DURATION <= endMins) {
      var timeStr = minsToTime(mins);
      if (!blocked.includes(timeStr) && !overlapsTaken(blockedRanges, mins, mins + SLOT_DURATION)) {
        slots.push(timeStr);
      }
      mins += SLOT_DURATION;
    }
    return slots;
  }

  // ── RENDER TIME SLOTS ──
  function renderTimeSlots(dateStr, dayOfWeek) {
    var override = scheduleOverrides[dateStr];
    var slots = generateTimeSlots(dayOfWeek, override, dateStr, doctorScheduleData);
    var taken = takenSlots[dateStr] || [];
    var workable = {};
    slots.forEach(function(time) { workable[time] = true; });

    var now = new Date();
    var todayStr = formatDate(now.getFullYear(), now.getMonth(), now.getDate());
    var currentMinutes = now.getHours() * 60 + now.getMinutes();

    timeSlotsDate.textContent = formatDateDisplay(dateStr);
    timeSlotsGrid.innerHTML = '';

    var serviceDur = SERVICE_DURATIONS[selectedService] || SLOT_DURATION;

    // Group available slots by hour
    var groups = {};
    var groupOrder = [];
    slots.forEach(function(time) {
      var slotMins = timeToMins(time);
      if (dateStr === todayStr && slotMins <= currentMinutes) return;
      // The whole visit must fall on workable cells: inside working hours and
      // clear of the doctor's pauses and blocked time
      for (var m = slotMins; m < slotMins + serviceDur; m += SLOT_DURATION) {
        if (!workable[minsToTime(m)]) return;
      }
      // ...and must not overlap an existing booking
      if (overlapsTaken(taken, slotMins, slotMins + serviceDur)) return;
      var hour = time.split(':')[0];
      if (!groups[hour]) { groups[hour] = []; groupOrder.push(hour); }
      groups[hour].push(time);
    });

    if (groupOrder.length === 0) {
      var msg = document.createElement('p');
      msg.className = 'no-slots';
      msg.textContent = 'Brak dostępnych terminów w tym dniu.';
      timeSlotsGrid.appendChild(msg);
    } else {
      groupOrder.forEach(function(hour) {
        var groupEl = document.createElement('div');
        groupEl.className = 'time-slots-group';

        var labelEl = document.createElement('div');
        labelEl.className = 'time-slots-hour';
        labelEl.textContent = hour + ':00';
        groupEl.appendChild(labelEl);

        var rowEl = document.createElement('div');
        rowEl.className = 'time-slots-row';

        groups[hour].forEach(function(time) {
          var btn = document.createElement('button');
          btn.className = 'time-slot';
          btn.textContent = time;
          (function(t, b) {
            b.addEventListener('click', function() { selectTime(t, b); });
          })(time, btn);
          rowEl.appendChild(btn);
        });

        groupEl.appendChild(rowEl);
        timeSlotsGrid.appendChild(groupEl);
      });
    }

    timeSlotsSection.classList.add('visible');
  }

  // ── SELECT TIME ──
  function selectTime(time, btn) {
    selectedTime = time;
    timeSlotsGrid.querySelectorAll('.time-slot').forEach(function(b) { b.classList.remove('selected'); });
    btn.classList.add('selected');

    formSection.classList.add('visible');
    updateSummary();
    formSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── UPDATE SUMMARY ──
  function updateSummary() {
    if (!selectedDate || !selectedTime) return;
    var svc = selectedService || '';
    var svcName = SERVICES[svc] || '';
    summaryEl.textContent = '';
    var html =
      '<strong>Data:</strong> ' + escapeHtml(formatDateDisplay(selectedDate)) +
      ' \u00a0|\u00a0 <strong>Godzina:</strong> ' + escapeHtml(selectedTime);
    if (svcName) {
      html += ' \u00a0|\u00a0 <strong>Usługa:</strong> ' + escapeHtml(svcName);
      var dur = SERVICE_DURATIONS[svc];
      if (dur) html += ' <span style="color:#999;font-size:0.85em">(' + dur + '\u00a0min)</span>';
    }
    if (selectedDoctor) {
      html += ' \u00a0|\u00a0 <strong>Lekarz:</strong> ' + escapeHtml(selectedDoctor.name);
    }
    summaryEl.innerHTML = html;
  }

  // ── HANDLE SUBMIT ──
  function handleSubmit(e) {
    e.preventDefault();
    var db = window.PawsomeDB;
    if (!db || !selectedDate || !selectedTime || !selectedDoctor) return;

    var patientName = document.getElementById('field-name').value.trim();
    var petName = document.getElementById('field-pet').value.trim();
    var phone = document.getElementById('field-phone').value.trim();
    var email = document.getElementById('field-email').value.trim();
    var service = selectedService || '';
    var commentEl = document.getElementById('field-comment');
    var comment = commentEl ? commentEl.value.trim() : '';

    var phoneErrorEl = document.getElementById('phone-error');
    if (phoneErrorEl) phoneErrorEl.classList.remove('visible');
    if (!isValidPolishMobile(phone)) {
      if (phoneErrorEl) {
        phoneErrorEl.textContent = 'Podaj polski numer komórkowy (np. 501 234 567)';
        phoneErrorEl.classList.add('visible');
      }
      return;
    }
    phone = normalizePhone(phone);

    var submitBtn = bookingForm.querySelector('.btn-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Rezerwuję...';

    var capturedDate = selectedDate;
    var capturedTime = selectedTime;
    var capturedDoctorId = selectedDoctor.id;
    var capturedDoctorName = selectedDoctor.name;
    var capturedDuration = SERVICE_DURATIONS[service] || SLOT_DURATION;

    // Double-booking protection: the visit claims one lock document per
    // 10-minute cell, with a deterministic id, so two concurrent bookings of
    // the same cell collide inside the transaction.
    var newStart = timeToMins(capturedTime);
    var newEnd = newStart + capturedDuration;
    var cells = visitCells(newStart, capturedDuration);
    var cellRefs = cells.map(function(cellMins) {
      return db.collection('slots').doc(slotCellId(capturedDoctorId, capturedDate, cellMins));
    });
    var appointmentRef = db.collection('appointments').doc();

    db.runTransaction(function(transaction) {
      // Guard for legacy slot docs (random id, whole-visit duration) and
      // off-grid visits, which the cell ids cannot catch. A query is not part
      // of the transaction, but it is re-run on every retry.
      // (Two equality filters — no composite index needed.)
      return db.collection('slots')
        .where('doctorId', '==', capturedDoctorId)
        .where('date', '==', capturedDate)
        .get()
        .then(function(snapshot) {
          snapshot.forEach(function(doc) {
            var d = doc.data();
            if (d.doctorId !== capturedDoctorId || !d.time) return;
            var existStart = timeToMins(d.time);
            var existEnd = existStart + (d.duration || SLOT_DURATION);
            if (newStart < existEnd && newEnd > existStart) {
              throw { code: 'slot-taken' };
            }
          });

          // Transactional part: read every cell first (Firestore requires all
          // reads before any write)...
          return Promise.all(cellRefs.map(function(ref) { return transaction.get(ref); }));
        })
        .then(function(cellDocs) {
          for (var i = 0; i < cellDocs.length; i++) {
            if (cellDocs[i].exists) throw { code: 'slot-taken' };
          }

          // ...then claim the cells and create the appointment
          cellRefs.forEach(function(ref, idx) {
            transaction.set(ref, {
              date: capturedDate,
              time: minsToTime(cells[idx]),
              doctorId: capturedDoctorId,
              duration: SLOT_DURATION
            });
          });
          transaction.set(appointmentRef, {
            slotId: cellRefs[0].id,
            date: capturedDate,
            time: capturedTime,
            patientName: patientName,
            petName: petName,
            phone: phone,
            email: email,
            service: service,
            duration: capturedDuration,
            status: 'pending',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            doctorId: capturedDoctorId,
            doctorName: capturedDoctorName,
            comment: comment
          });
        });
    })
    .then(function() {
      showMessage('success', 'Wizyta zarezerwowana!', 'Twoja wizyta oczekuje na potwierdzenie. Skontaktujemy się z Tobą wkrótce.');
      // Mark the booked cells locally so the UI stays accurate until the listener fires
      if (selectedDoctor && selectedDoctor.id === capturedDoctorId) {
        if (!takenSlots[capturedDate]) takenSlots[capturedDate] = [];
        takenSlots[capturedDate].push({
          start: cells[0],
          end: cells[cells.length - 1] + SLOT_DURATION
        });
      }
      selectedTime = null;
    })
    .catch(function(err) {
      if (err && err.code === 'slot-taken') {
        showMessage('error', 'Termin zajęty', 'Niestety, ktoś właśnie zarezerwował ten termin. Wybierz inny.');
      } else {
        showMessage('error', 'Błąd', 'Nie udało się zarezerwować wizyty. Spróbuj ponownie lub zadzwoń do nas.');
      }
    })
    .finally(function() {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Zarezerwuj wizytę';
    });
  }

  // ── SHOW MESSAGE ──
  function showMessage(type, title, text) {
    if (type === 'success' && successOverlay) {
      formSection.classList.remove('visible');
      timeSlotsSection.classList.remove('visible');
      successOverlay.classList.add('visible');
      return;
    }
    var icon = '❌';
    messageEl.innerHTML =
      '<span class="msg-icon">' + icon + '</span>' +
      '<h3>' + escapeHtml(title) + '</h3>' +
      '<p>' + escapeHtml(text) + '</p>';
    messageEl.classList.add('visible');
    formSection.classList.remove('visible');
    timeSlotsSection.classList.remove('visible');
    messageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ── NEXT FREE TERM (exported for homepage) ──
  // The badge costs four Firestore queries, so the label is kept in
  // sessionStorage for a few minutes. Storage access can throw (private mode,
  // blocked site data) — the badge must work without it.
  var NEXT_TERM_CACHE_KEY = 'pawsomeNextFreeTerm';
  var NEXT_TERM_CACHE_TTL = 5 * 60 * 1000;

  function readCachedNextTerm() {
    try {
      var cached = JSON.parse(window.sessionStorage.getItem(NEXT_TERM_CACHE_KEY));
      if (!cached || typeof cached.label !== 'string' || !cached.label || typeof cached.ts !== 'number') return null;
      var age = Date.now() - cached.ts;
      if (age < 0 || age >= NEXT_TERM_CACHE_TTL) return null;
      // "Dziś"/"Jutro" labels are relative to the day they were computed on
      if (new Date(cached.ts).toDateString() !== new Date().toDateString()) return null;
      return cached.label;
    } catch (e) {
      return null;
    }
  }

  function cacheNextTerm(label) {
    try {
      window.sessionStorage.setItem(NEXT_TERM_CACHE_KEY, JSON.stringify({ label: label, ts: Date.now() }));
    } catch (e) { /* cache is optional */ }
  }

  window.PawsomeBooking = {
    getNextFreeTerm: function(callback) {
      var cachedLabel = readCachedNextTerm();
      if (cachedLabel) { callback(cachedLabel); return; }

      var db = window.PawsomeDB;
      if (!db) { callback(null); return; }

      var now = new Date();
      var todayStr = formatDate(now.getFullYear(), now.getMonth(), now.getDate());
      var futureDate = new Date(now);
      futureDate.setDate(futureDate.getDate() + 14);
      var futureStr = formatDate(futureDate.getFullYear(), futureDate.getMonth(), futureDate.getDate());

      Promise.all([
        db.collection('slots')
          .where('date', '>=', todayStr)
          .where('date', '<=', futureStr)
          .get(),
        db.collection('schedule')
          .where(firebase.firestore.FieldPath.documentId(), '>=', todayStr)
          .where(firebase.firestore.FieldPath.documentId(), '<=', futureStr)
          .get(),
        db.collection('doctors').get(),
        db.collection('doctorSchedules').get()
      ]).then(function(results) {
        // Booked minute ranges per doctor and date
        var taken = {};
        results[0].forEach(function(doc) {
          var d = doc.data();
          if (!d.doctorId || !d.date || !d.time) return;
          var start = timeToMins(d.time);
          var byDate = taken[d.doctorId] || (taken[d.doctorId] = {});
          (byDate[d.date] || (byDate[d.date] = [])).push({ start: start, end: start + (d.duration || SLOT_DURATION) });
        });
        var overrides = {};
        results[1].forEach(function(doc) {
          overrides[doc.id] = doc.data();
        });
        var doctorIds = [];
        results[2].forEach(function(doc) { doctorIds.push(doc.id); });
        if (doctorIds.length === 0) { callback(null); return; }

        var schedules = {};
        results[3].forEach(function(doc) { schedules[doc.id] = doc.data(); });

        var currentMinutes = now.getHours() * 60 + now.getMinutes();
        var dayNames = ['Nd','Pn','Wt','Śr','Cz','Pt','Sb'];

        for (var i = 0; i <= 14; i++) {
          var checkDate = new Date(now);
          checkDate.setDate(checkDate.getDate() + i);
          var dateStr = formatDate(checkDate.getFullYear(), checkDate.getMonth(), checkDate.getDate());
          var override = overrides[dateStr];

          if (override && override.closed) continue;

          // Earliest free cell that day across doctors, each checked against
          // their own schedule and their own bookings
          var earliest = null;
          for (var d = 0; d < doctorIds.length; d++) {
            var id = doctorIds[d];
            var docSlots = generateTimeSlots(checkDate.getDay(), override, dateStr, schedules[id] || null);
            var docTaken = (taken[id] && taken[id][dateStr]) || [];
            for (var s = 0; s < docSlots.length; s++) {
              var slotMins = timeToMins(docSlots[s]);
              if (i === 0 && slotMins <= currentMinutes) continue;
              if (overlapsTaken(docTaken, slotMins, slotMins + SLOT_DURATION)) continue;
              if (earliest === null || slotMins < earliest) earliest = slotMins;
              break; // slots are ascending — the first free one is this doctor's earliest
            }
          }
          if (earliest === null) continue;

          var time = minsToTime(earliest);
          var label;
          if (i === 0) label = 'Dziś, ' + time;
          else if (i === 1) label = 'Jutro, ' + time;
          else {
            label = dayNames[checkDate.getDay()] + ' ' +
                    checkDate.getDate() + '.' + String(checkDate.getMonth()+1).padStart(2,'0') +
                    ', ' + time;
          }
          cacheNextTerm(label);
          callback(label);
          return;
        }
        callback(null);
      }).catch(function() {
        callback(null);
      });
    }
  };

  // Start only on the booking page
  if (calendarDays) {
    loadServicesFromFirestore(function() {
      init();
    });
  }
})();
