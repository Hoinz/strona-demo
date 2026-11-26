(function() {
  'use strict';

  var CLINIC_HOURS = {
    1: { open: '08:00', close: '20:00' },
    2: { open: '08:00', close: '20:00' },
    3: { open: '08:00', close: '20:00' },
    4: { open: '08:00', close: '20:00' },
    5: { open: '08:00', close: '20:00' },
    6: { open: '08:00', close: '20:00' },
    0: { open: '09:00', close: '17:00' }
  };
  var SLOT_DURATION = 10;

  var SERVICES = {};
  var SERVICE_DURATIONS = {};

  var MONTH_NAMES = [
    'Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec',
    'Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'
  ];

  var currentMonth, currentYear;
  var selectedDate = null;
  var selectedTime = null;
  var selectedService = null;
  var urlService = null;
  var takenSlots = {};
  var selectedDoctor = null;
  var doctors = [];
  var unsubscribeSlots = null;
  var monthDataGen = 0;
  var doctorScheduleData = null;
  var doctorScheduleLoaded = false;
  var unsubscribeDoctorSchedule = null;

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

  function overlapsTaken(ranges, start, end) {
    for (var i = 0; i < ranges.length; i++) {
      if (start < ranges[i].end && end > ranges[i].start) return true;
    }
    return false;
  }

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

  function hasWorkingHours(sched) {
    if (!sched) return false;
    if (sched.lastWeek || sched.defaultWeek) return true;
    return !!sched.days && Object.keys(sched.days).length > 0;
  }

  function resolveDoctorDay(sched, dayOfWeek, dateStr) {
    if (!sched) return undefined;
    var day = sched.days && dateStr && sched.days[dateStr];
    if (day) return day;
    if (dateStr) {
      if (sched.validFrom && dateStr < sched.validFrom) return undefined;
      if (sched.validUntil && dateStr > sched.validUntil) return undefined;
    }
    var dow = String(dayOfWeek);
    return (sched.defaultWeek && sched.defaultWeek[dow]) || undefined;
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

  function init() {
    var now = new Date();
    currentMonth = now.getMonth();
    currentYear = now.getFullYear();

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

    renderServicePicker();

    if (!navigator.onLine) {
      offlineNotice.classList.add('visible');
    }
    window.addEventListener('online', function() { offlineNotice.classList.remove('visible'); });
    window.addEventListener('offline', function() { offlineNotice.classList.add('visible'); });

    if (calendarSection) calendarSection.style.display = 'none';
    loadDoctors();
  }

  function changeMonth(delta) {
    currentMonth += delta;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    loadMonthData();
  }

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
    teardownMonthListeners();
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

  function teardownMonthListeners() {
    monthDataGen++;
    if (unsubscribeSlots) { unsubscribeSlots(); unsubscribeSlots = null; }
  }

  function loadMonthData() {
    var db = window.PawsomeDB;

    teardownMonthListeners();

    if (!db || !selectedDoctor) { renderCalendar(); return; }

    var gen = monthDataGen;
    var doctorId = selectedDoctor.id;
    var startDate = formatDate(currentYear, currentMonth, 1);
    var lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();
    var endDate = formatDate(currentYear, currentMonth, lastDay);

    var slotsCache = [];
    var slotsReady = false;

    function applyData() {
      if (gen !== monthDataGen) return;
// Rendering before the doctor's schedule arrives would briefly offer clinic
// hours on days the doctor does not work.
      if (!slotsReady || !doctorScheduleLoaded) return;

      var monthTaken = {};
      slotsCache.forEach(function(d) {
        var startMins = timeToMins(d.time);
        if (!monthTaken[d.date]) monthTaken[d.date] = [];
        monthTaken[d.date].push({ start: startMins, end: startMins + (d.duration || SLOT_DURATION) });
      });

      Object.keys(takenSlots).forEach(function(k) {
        if (k >= startDate && k <= endDate) delete takenSlots[k];
      });
      Object.keys(monthTaken).forEach(function(k) { takenSlots[k] = monthTaken[k]; });

      renderCalendar();

      if (selectedDate && selectedDate >= startDate && selectedDate <= endDate) {
        var parts = selectedDate.split('-');
        var dow = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])).getDay();
        renderTimeSlots(selectedDate, dow);

        if (selectedTime) {
          var stillOffered = false;
          timeSlotsGrid.querySelectorAll('.time-slot').forEach(function(b) {
            if (b.textContent === selectedTime) { b.classList.add('selected'); stillOffered = true; }
          });
          if (!stillOffered) {
            selectedTime = null;
            formSection.classList.remove('visible');
          }
        }
      }
    }

// Until the (doctorId, date) index is deployed Firestore answers
// failed-precondition; then filter by doctor in the browser instead.
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

  }

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

      var daySlots = generateTimeSlots(date.getDay(), dateStr, doctorScheduleData);
      var totalSlots = daySlots.length;
      var dayTaken = takenSlots[dateStr] || [];
      var availableSlots = 0;
      for (var s = 0; s < daySlots.length; s++) {
        var slotStart = timeToMins(daySlots[s]);
        if (!overlapsTaken(dayTaken, slotStart, slotStart + SLOT_DURATION)) availableSlots++;
      }

      if (isPast || totalSlots === 0) {
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

  function generateTimeSlots(dayOfWeek, dateStr, sched) {
    var doctorDay = resolveDoctorDay(sched, dayOfWeek, dateStr);

// Clinic hours apply only to doctors who never set working hours.
    if (!doctorDay && hasWorkingHours(sched)) return [];
    if (doctorDay && !doctorDay.active) return [];

    var hours = doctorDay ? { open: doctorDay.start, close: doctorDay.end } : CLINIC_HOURS[dayOfWeek];

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
      if (!overlapsTaken(blockedRanges, mins, mins + SLOT_DURATION)) {
        slots.push(timeStr);
      }
      mins += SLOT_DURATION;
    }
    return slots;
  }

  function renderTimeSlots(dateStr, dayOfWeek) {
    var slots = generateTimeSlots(dayOfWeek, dateStr, doctorScheduleData);
    var taken = takenSlots[dateStr] || [];
    var workable = {};
    slots.forEach(function(time) { workable[time] = true; });

    var now = new Date();
    var todayStr = formatDate(now.getFullYear(), now.getMonth(), now.getDate());
    var currentMinutes = now.getHours() * 60 + now.getMinutes();

    timeSlotsDate.textContent = formatDateDisplay(dateStr);
    timeSlotsGrid.innerHTML = '';

    var serviceDur = SERVICE_DURATIONS[selectedService] || SLOT_DURATION;

    var groups = {};
    var groupOrder = [];
    slots.forEach(function(time) {
      var slotMins = timeToMins(time);
      if (dateStr === todayStr && slotMins <= currentMinutes) return;
      for (var m = slotMins; m < slotMins + serviceDur; m += SLOT_DURATION) {
        if (!workable[minsToTime(m)]) return;
      }
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

  function selectTime(time, btn) {
    selectedTime = time;
    timeSlotsGrid.querySelectorAll('.time-slot').forEach(function(b) { b.classList.remove('selected'); });
    btn.classList.add('selected');

    formSection.classList.add('visible');
    updateSummary();
    formSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

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

    var newStart = timeToMins(capturedTime);
    var newEnd = newStart + capturedDuration;
    var cells = visitCells(newStart, capturedDuration);
    var cellRefs = cells.map(function(cellMins) {
      return db.collection('slots').doc(slotCellId(capturedDoctorId, capturedDate, cellMins));
    });
    var appointmentRef = db.collection('appointments').doc();

    db.runTransaction(function(transaction) {
// Catches legacy whole-visit slot docs that cell ids cannot. Not part of the
// transaction, but re-run on every retry.
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

// Firestore transactions need every read before the first write.
          return Promise.all(cellRefs.map(function(ref) { return transaction.get(ref); }));
        })
        .then(function(cellDocs) {
          for (var i = 0; i < cellDocs.length; i++) {
            if (cellDocs[i].exists) throw { code: 'slot-taken' };
          }

          cellRefs.forEach(function(ref, idx) {
            transaction.set(ref, {
              date: capturedDate,
              time: minsToTime(cells[idx]),
              doctorId: capturedDoctorId,
              duration: SLOT_DURATION,
              appointmentId: appointmentRef.id
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

  var NEXT_TERM_CACHE_KEY = 'pawsomeNextFreeTerm';
  var NEXT_TERM_CACHE_TTL = 5 * 60 * 1000;

// sessionStorage throws in private mode or with blocked site data; the badge
// must work without it.
  function readCachedNextTerm() {
    try {
      var cached = JSON.parse(window.sessionStorage.getItem(NEXT_TERM_CACHE_KEY));
      if (!cached || typeof cached.label !== 'string' || !cached.label || typeof cached.ts !== 'number') return null;
      var age = Date.now() - cached.ts;
      if (age < 0 || age >= NEXT_TERM_CACHE_TTL) return null;
      if (new Date(cached.ts).toDateString() !== new Date().toDateString()) return null;
      return cached.label;
    } catch (e) {
      return null;
    }
  }

  function cacheNextTerm(label) {
    try {
      window.sessionStorage.setItem(NEXT_TERM_CACHE_KEY, JSON.stringify({ label: label, ts: Date.now() }));
    } catch (e) { }
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
        db.collection('doctors').get(),
        db.collection('doctorSchedules').get()
      ]).then(function(results) {
        var taken = {};
        results[0].forEach(function(doc) {
          var d = doc.data();
          if (!d.doctorId || !d.date || !d.time) return;
          var start = timeToMins(d.time);
          var byDate = taken[d.doctorId] || (taken[d.doctorId] = {});
          (byDate[d.date] || (byDate[d.date] = [])).push({ start: start, end: start + (d.duration || SLOT_DURATION) });
        });
        var doctorIds = [];
        results[1].forEach(function(doc) { doctorIds.push(doc.id); });
        if (doctorIds.length === 0) { callback(null); return; }

        var schedules = {};
        results[2].forEach(function(doc) { schedules[doc.id] = doc.data(); });

        var currentMinutes = now.getHours() * 60 + now.getMinutes();
        var dayNames = ['Nd','Pn','Wt','Śr','Cz','Pt','Sb'];

        for (var i = 0; i <= 14; i++) {
          var checkDate = new Date(now);
          checkDate.setDate(checkDate.getDate() + i);
          var dateStr = formatDate(checkDate.getFullYear(), checkDate.getMonth(), checkDate.getDate());
          var earliest = null;
          for (var d = 0; d < doctorIds.length; d++) {
            var id = doctorIds[d];
            var docSlots = generateTimeSlots(checkDate.getDay(), dateStr, schedules[id] || null);
            var docTaken = (taken[id] && taken[id][dateStr]) || [];
            for (var s = 0; s < docSlots.length; s++) {
              var slotMins = timeToMins(docSlots[s]);
              if (i === 0 && slotMins <= currentMinutes) continue;
              if (overlapsTaken(docTaken, slotMins, slotMins + SLOT_DURATION)) continue;
              if (earliest === null || slotMins < earliest) earliest = slotMins;
              break;
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

  if (calendarDays) {
    (window.PawsomeServices || []).forEach(function(svc) {
      if (!svc.active) return;
      SERVICES[svc.slug] = svc.name;
      SERVICE_DURATIONS[svc.slug] = svc.duration;
    });
    init();
  }
})();
