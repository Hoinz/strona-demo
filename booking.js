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
  var takenSlots = {};
  var scheduleOverrides = {};
  var selectedDoctor = null;   // { id, name, specialty }
  var doctors = [];
  var unsubscribeSlots = null;
  var unsubscribeSchedule = null;

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
  var offlineNotice = document.getElementById('offline-notice');
  var serviceSelect = document.getElementById('field-service');
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

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── INIT ──
  function init() {
    var now = new Date();
    currentMonth = now.getMonth();
    currentYear = now.getFullYear();

    // Pre-select service from URL param
    var params = new URLSearchParams(window.location.search);
    var svc = params.get('service');
    if (svc && serviceSelect) {
      serviceSelect.value = svc;
    }

    btnPrev.addEventListener('click', function() { changeMonth(-1); });
    btnNext.addEventListener('click', function() { changeMonth(1); });
    bookingForm.addEventListener('submit', handleSubmit);

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
    takenSlots = {};
    doctorGrid.querySelectorAll('.doctor-card').forEach(function(b) { b.classList.remove('selected'); });
    btn.classList.add('selected');
    if (calendarSection) calendarSection.style.display = '';
    timeSlotsSection.classList.remove('visible');
    formSection.classList.remove('visible');
    messageEl.classList.remove('visible');
    loadMonthData();
  }

  // ── LOAD DATA FROM FIRESTORE (real-time listeners) ──
  function loadMonthData() {
    var db = window.PawsomeDB;

    // Tear down previous listeners before setting up new ones
    if (unsubscribeSlots) { unsubscribeSlots(); unsubscribeSlots = null; }
    if (unsubscribeSchedule) { unsubscribeSchedule(); unsubscribeSchedule = null; }

    if (!db || !selectedDoctor) { renderCalendar(); return; }

    var startDate = formatDate(currentYear, currentMonth, 1);
    var lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();
    var endDate = formatDate(currentYear, currentMonth, lastDay);

    // Local caches for each listener; merged in applyData()
    var slotsCache = [];
    var overridesCache = {};
    var slotsReady = false;
    var scheduleReady = false;

    function applyData() {
      if (!slotsReady || !scheduleReady) return;

      // Rebuild takenSlots from live slot documents
      var monthTaken = {};
      slotsCache.forEach(function(d) {
        var duration = d.duration || SLOT_DURATION;
        var startMins = timeToMins(d.time);
        for (var m = startMins; m < startMins + duration; m += SLOT_DURATION) {
          var hh = String(Math.floor(m / 60)).padStart(2, '0');
          var mm = String(m % 60).padStart(2, '0');
          var t = hh + ':' + mm;
          if (!monthTaken[d.date]) monthTaken[d.date] = [];
          if (!monthTaken[d.date].includes(t)) monthTaken[d.date].push(t);
        }
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
          var nowTaken = takenSlots[selectedDate] || [];
          if (nowTaken.includes(selectedTime)) {
            // Slot just got taken by someone else — clear selection
            selectedTime = null;
            formSection.classList.remove('visible');
          } else {
            // Re-apply the selected highlight lost during re-render
            timeSlotsGrid.querySelectorAll('.time-slot').forEach(function(b) {
              if (b.textContent === selectedTime) b.classList.add('selected');
            });
          }
        }
      }
    }

    unsubscribeSlots = db.collection('slots')
      .where('date', '>=', startDate)
      .where('date', '<=', endDate)
      .where('doctorId', '==', selectedDoctor.id)
      .onSnapshot(function(snapshot) {
        slotsCache = [];
        snapshot.forEach(function(doc) { slotsCache.push(doc.data()); });
        slotsReady = true;
        applyData();
      }, function() {
        slotsReady = true;
        applyData();
      });

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

      var totalSlots = generateTimeSlots(date.getDay(), override).length;
      var taken = (takenSlots[dateStr] || []).length;
      var availableSlots = totalSlots - taken;

      if (isPast || isClosed) {
        btn.classList.add('disabled');
        btn.disabled = true;
      } else if (availableSlots <= 0 && totalSlots > 0) {
        btn.classList.add('fully-booked');
        btn.disabled = true;
      } else if (totalSlots > 0) {
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
  function generateTimeSlots(dayOfWeek, override) {
    if (override && override.closed) return [];

    var hours = override
      ? { open: override.openTime || CLINIC_HOURS[dayOfWeek].open, close: override.closeTime || CLINIC_HOURS[dayOfWeek].close }
      : CLINIC_HOURS[dayOfWeek];

    var blocked = (override && override.blockedSlots) || [];
    var slots = [];
    var startParts = hours.open.split(':');
    var endParts = hours.close.split(':');
    var mins = parseInt(startParts[0]) * 60 + parseInt(startParts[1]);
    var endMins = parseInt(endParts[0]) * 60 + parseInt(endParts[1]);

    while (mins + SLOT_DURATION <= endMins) {
      var hh = String(Math.floor(mins / 60)).padStart(2, '0');
      var mm = String(mins % 60).padStart(2, '0');
      var timeStr = hh + ':' + mm;
      if (!blocked.includes(timeStr)) {
        slots.push(timeStr);
      }
      mins += SLOT_DURATION;
    }
    return slots;
  }

  // ── RENDER TIME SLOTS ──
  function renderTimeSlots(dateStr, dayOfWeek) {
    var override = scheduleOverrides[dateStr];
    var slots = generateTimeSlots(dayOfWeek, override);
    var taken = takenSlots[dateStr] || [];

    var now = new Date();
    var todayStr = formatDate(now.getFullYear(), now.getMonth(), now.getDate());
    var currentMinutes = now.getHours() * 60 + now.getMinutes();

    timeSlotsDate.textContent = formatDateDisplay(dateStr);
    timeSlotsGrid.innerHTML = '';

    // Group available slots by hour
    var groups = {};
    var groupOrder = [];
    slots.forEach(function(time) {
      var slotMins = timeToMins(time);
      if (taken.includes(time) || (dateStr === todayStr && slotMins <= currentMinutes)) return;
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
    var svc = serviceSelect.value;
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

    var submitBtn = bookingForm.querySelector('.btn-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Rezerwuję...';

    var patientName = document.getElementById('field-name').value.trim();
    var petName = document.getElementById('field-pet').value.trim();
    var phone = document.getElementById('field-phone').value.trim();
    var email = document.getElementById('field-email').value.trim();
    var service = serviceSelect.value;

    var capturedDate = selectedDate;
    var capturedTime = selectedTime;
    var capturedDoctorId = selectedDoctor.id;
    var capturedDoctorName = selectedDoctor.name;
    var capturedDuration = SERVICE_DURATIONS[service] || SLOT_DURATION;

    // Use a transaction to prevent double-booking
    var slotRef = db.collection('slots').doc();
    var slotId = slotRef.id;

    db.runTransaction(function(transaction) {
      // Fetch all slots for this doctor/date to check for overlap
      return db.collection('slots')
        .where('date', '==', capturedDate)
        .where('doctorId', '==', capturedDoctorId)
        .get()
        .then(function(snapshot) {
          var newStart = timeToMins(capturedTime);
          var newEnd = newStart + capturedDuration;
          snapshot.forEach(function(doc) {
            var d = doc.data();
            var existStart = timeToMins(d.time);
            var existEnd = existStart + (d.duration || SLOT_DURATION);
            if (newStart < existEnd && newEnd > existStart) {
              throw { code: 'slot-taken' };
            }
          });

          // Create both docs in the transaction
          var appointmentRef = db.collection('appointments').doc(slotId);
          transaction.set(slotRef, {
            date: capturedDate,
            time: capturedTime,
            doctorId: capturedDoctorId,
            duration: capturedDuration
          });
          transaction.set(appointmentRef, {
            slotId: slotId,
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
            doctorName: capturedDoctorName
          });
        });
    })
    .then(function() {
      showMessage('success', 'Wizyta zarezerwowana!', 'Twoja wizyta oczekuje na potwierdzenie. Skontaktujemy się z Tobą wkrótce.');
      // Expand local takenSlots by duration so UI stays accurate
      if (!takenSlots[capturedDate]) takenSlots[capturedDate] = [];
      var startMins = timeToMins(capturedTime);
      for (var m = startMins; m < startMins + capturedDuration; m += SLOT_DURATION) {
        var hh = String(Math.floor(m / 60)).padStart(2, '0');
        var mm = String(m % 60).padStart(2, '0');
        takenSlots[capturedDate].push(hh + ':' + mm);
      }
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
    var icon = type === 'success' ? '✅' : '❌';
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
  window.PawsomeBooking = {
    CLINIC_HOURS: CLINIC_HOURS,
    SERVICES: SERVICES,
    SERVICE_DURATIONS: SERVICE_DURATIONS,
    generateTimeSlots: generateTimeSlots,
    getNextFreeTerm: function(callback) {
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
        db.collection('doctors').get()
      ]).then(function(results) {
        // Count taken slots per date|time key across all doctors
        var slotCounts = {};
        results[0].forEach(function(doc) {
          var d = doc.data();
          var key = d.date + '|' + d.time;
          slotCounts[key] = (slotCounts[key] || 0) + 1;
        });
        var overrides = {};
        results[1].forEach(function(doc) {
          overrides[doc.id] = doc.data();
        });
        var doctorCount = results[2].size;
        if (doctorCount === 0) { callback(null); return; }

        var currentMinutes = now.getHours() * 60 + now.getMinutes();

        for (var i = 0; i <= 14; i++) {
          var checkDate = new Date(now);
          checkDate.setDate(checkDate.getDate() + i);
          var dateStr = formatDate(checkDate.getFullYear(), checkDate.getMonth(), checkDate.getDate());
          var override = overrides[dateStr];

          if (override && override.closed) continue;

          var allSlots = generateTimeSlots(checkDate.getDay(), override);

          for (var j = 0; j < allSlots.length; j++) {
            var time = allSlots[j];
            if ((slotCounts[dateStr + '|' + time] || 0) >= doctorCount) continue;
            if (i === 0) {
              var parts = time.split(':');
              var slotMins = parseInt(parts[0]) * 60 + parseInt(parts[1]);
              if (slotMins <= currentMinutes) continue;
            }
            var label;
            if (i === 0) label = 'Dziś, ' + time;
            else if (i === 1) label = 'Jutro, ' + time;
            else {
              var dayNames = ['Nd','Pn','Wt','Śr','Cz','Pt','Sb'];
              label = dayNames[checkDate.getDay()] + ' ' +
                      checkDate.getDate() + '.' + String(checkDate.getMonth()+1).padStart(2,'0') +
                      ', ' + time;
            }
            callback(label);
            return;
          }
        }
        callback(null);
      }).catch(function() {
        callback(null);
      });
    }
  };

  // Listen for service select changes to update summary
  if (serviceSelect) {
    serviceSelect.addEventListener('change', updateSummary);
  }

  // Start only on the booking page
  if (calendarDays) {
    init();
  }
})();
