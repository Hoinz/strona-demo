// Admin dashboard for Pawsome Vet
(function() {
  'use strict';

  // ── DOM ──
  var loginView = document.getElementById('admin-login');
  var dashboard = document.getElementById('admin-dashboard');
  var loginForm = document.getElementById('login-form');
  var loginError = document.getElementById('login-error');
  var logoutBtn = document.getElementById('btn-logout');
  var datePicker = document.getElementById('admin-date');
  var bookingsList = document.getElementById('bookings-list');
  var timelineEl = document.getElementById('timeline');
  var tabs = document.querySelectorAll('.admin-tab');

  var currentFilter = 'pending';
  var unsubscribePending = null;
  var unsubscribeDate = null;
  var allPendingBookings = [];
  var allDateBookings = [];
  var dashboardInitialized = false;
  var currentUser = null;
  var viewMode = 'mine';   // 'mine' | 'all'
  var doctorName = '';
  var acceptedById = {};   // id → booking, for the click-to-edit modal
  var doctorScheduleCache = {};  // doctorId → schedule doc data
  var allDoctors = [];           // [{id, name}] for view-schedule selector

  // ── AUTH ──
  function initAuth() {
    var auth = window.PawsomeAuth;
    if (!auth) return;

    auth.onAuthStateChanged(function(user) {
      if (user) {
        currentUser = user;
        loginView.style.display = 'none';
        dashboard.classList.add('visible');
        if (!dashboardInitialized) {
          loadDoctorInfo(user.uid, function() {
            initDashboard();
            dashboardInitialized = true;
          });
        } else {
          loadBookings();
        }
      } else {
        currentUser = null;
        doctorName = '';
        loginView.style.display = '';
        dashboard.classList.remove('visible');
        if (unsubscribePending) { unsubscribePending(); unsubscribePending = null; }
        if (unsubscribeDate) { unsubscribeDate(); unsubscribeDate = null; }
      }
    });
  }

  // ── LOAD DOCTOR INFO ──
  function loadDoctorInfo(uid, callback) {
    window.PawsomeDB.collection('doctors').doc(uid).get().then(function(doc) {
      doctorName = doc.exists ? (doc.data().name || '') : 'Lekarz';
      var labelEl = document.getElementById('doctor-label');
      if (labelEl) labelEl.textContent = 'Zalogowany jako: ' + doctorName;
      callback();
    }).catch(function() { callback(); });
  }

  // ── LOGIN ──
  loginForm.addEventListener('submit', function(e) {
    e.preventDefault();
    loginError.classList.remove('visible');
    var email = document.getElementById('login-email').value;
    var password = document.getElementById('login-password').value;

    window.PawsomeAuth.signInWithEmailAndPassword(email, password)
      .catch(function() {
        loginError.textContent = 'Nieprawidłowy email lub hasło';
        loginError.classList.add('visible');
      });
  });

  // ── LOGOUT ──
  logoutBtn.addEventListener('click', function() {
    window.PawsomeAuth.signOut();
  });

  // ── DASHBOARD ──
  function initDashboard() {
    var today = new Date();
    datePicker.value = formatDateInput(today);

    datePicker.addEventListener('change', loadBookings);

    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        currentFilter = this.dataset.filter;
        tabs.forEach(function(t) { t.classList.remove('active'); });
        this.classList.add('active');
        refreshDisplay(datePicker.value);
      });
    });

    // Wire view-mode toggle buttons
    var btnViewMine = document.getElementById('btn-view-mine');
    var btnViewAll  = document.getElementById('btn-view-all');
    if (btnViewMine && btnViewAll) {
      btnViewMine.addEventListener('click', function() {
        viewMode = 'mine';
        btnViewMine.classList.add('active');
        btnViewAll.classList.remove('active');
        updatePendingTabLabel();
        loadBookings();
      });
      btnViewAll.addEventListener('click', function() {
        viewMode = 'all';
        btnViewAll.classList.add('active');
        btnViewMine.classList.remove('active');
        updatePendingTabLabel();
        loadBookings();
      });
    }

    loadAllDoctors();
    loadAllDoctorSchedules();
    var schedBtn = document.getElementById('btn-schedule');
    if (schedBtn) schedBtn.addEventListener('click', openScheduleModal);
    var viewSchedBtn = document.getElementById('btn-view-schedule');
    if (viewSchedBtn) viewSchedBtn.addEventListener('click', openViewScheduleModal);

    loadBookings();
  }

  // ── UPDATE PENDING TAB LABEL based on view mode ──
  function updatePendingTabLabel() {
    var labelEl = document.querySelector('#tab-pending .tab-label');
    if (!labelEl) return;
    labelEl.textContent = viewMode === 'all'
      ? 'Wszystkie oczekujące przychodni'
      : 'Wszystkie moje oczekujące';
  }

  // ── LOAD BOOKINGS (two listeners: all pending + date-specific) ──
  function loadBookings() {
    var db = window.PawsomeDB;
    if (!db) return;

    if (unsubscribePending) { unsubscribePending(); unsubscribePending = null; }
    if (unsubscribeDate) { unsubscribeDate(); unsubscribeDate = null; }

    var dateStr = datePicker.value;

    // Listener 1: All pending appointments across all dates
    var pendingQuery = db.collection('appointments').where('status', '==', 'pending');
    if (viewMode === 'mine' && currentUser) {
      pendingQuery = pendingQuery.where('doctorId', '==', currentUser.uid);
    }
    unsubscribePending = pendingQuery.onSnapshot(function(snapshot) {
      allPendingBookings = [];
      snapshot.forEach(function(doc) {
        allPendingBookings.push({ id: doc.id, ...doc.data() });
      });
      allPendingBookings.sort(function(a, b) {
        var d = (a.date || '').localeCompare(b.date || '');
        return d !== 0 ? d : (a.time || '').localeCompare(b.time || '');
      });
      refreshDisplay(datePicker.value);
    }, function() {
      bookingsList.innerHTML = '<div class="no-bookings">Błąd ładowania danych</div>';
    });

    // Listener 2: All appointments for the selected date (accepted / rejected / all)
    var dateQuery = db.collection('appointments').where('date', '==', dateStr);
    if (viewMode === 'mine' && currentUser) {
      dateQuery = dateQuery.where('doctorId', '==', currentUser.uid);
    }
    unsubscribeDate = dateQuery.onSnapshot(function(snapshot) {
      allDateBookings = [];
      snapshot.forEach(function(doc) {
        allDateBookings.push({ id: doc.id, ...doc.data() });
      });
      allDateBookings.sort(function(a, b) { return (a.time || '').localeCompare(b.time || ''); });
      refreshDisplay(datePicker.value);
    }, function() {});
  }

  // ── REFRESH DISPLAY (re-render from cached data) ──
  function refreshDisplay(dateStr) {
    // Counts: pending = all dates, others = selected date only
    var counts = { pending: allPendingBookings.length, accepted: 0, rejected: 0, all: allDateBookings.length };
    allDateBookings.forEach(function(b) {
      if (b.status === 'accepted' || b.status === 'rejected') {
        counts[b.status] = (counts[b.status] || 0) + 1;
      }
    });
    updateCountsFromData(counts);

    // Build acceptedById for conflict detection (always date-specific)
    var acceptedArr = allDateBookings.filter(function(b) { return b.status === 'accepted'; });
    acceptedById = {};
    acceptedArr.forEach(function(b) { acceptedById[b.id] = b; });

    // Render list
    if (currentFilter === 'pending') {
      renderBookings(allPendingBookings, true);
    } else if (currentFilter === 'all') {
      renderBookings(allDateBookings);
    } else {
      renderBookings(allDateBookings.filter(function(b) { return b.status === currentFilter; }));
    }

    renderTimeline(dateStr, acceptedArr);
  }

  // ── RENDER BOOKINGS ──
  function renderBookings(bookings, showDate) {
    if (bookings.length === 0) {
      bookingsList.innerHTML = '<div class="no-bookings">Brak rezerwacji do wyświetlenia</div>';
      return;
    }

    bookingsList.innerHTML = bookings.map(function(b) {
      var statusLabel = { pending: 'Oczekuje', accepted: 'Potwierdzona', rejected: 'Odrzucona' }[b.status] || b.status;
      var dur = b.duration || getServiceDuration(b.service) || 20;
      var durLabel = dur + ' min';
      var endTime = minsToTime(timeToMins(b.time) + dur);

      return '<div class="booking-card status-' + escapeAttr(b.status) + '" data-id="' + escapeAttr(b.id) + '">' +
        '<div class="booking-info">' +
          '<span class="booking-status ' + escapeAttr(b.status) + '">' + statusLabel + '</span>' +
          '<h3>' + escapeHtml(b.patientName) + ' — ' + escapeHtml(b.petName) + '</h3>' +
          '<div class="booking-meta">' +
            (showDate ? '<span class="meta-date">📅 ' + escapeHtml(formatDateDisplay(b.date)) + '</span>' : '') +
            '<span>🕐 ' + escapeHtml(b.time) + ' – ' + escapeHtml(endTime) + '</span>' +
            '<span>⏱ ' + escapeHtml(durLabel) + '</span>' +
            '<span>📞 ' + escapeHtml(formatPhone(b.phone)) + '</span>' +
            '<span>✉️ ' + escapeHtml(b.email) + '</span>' +
            '<span>🩺 ' + escapeHtml(getServiceName(b.service)) + '</span>' +
            '<span>👨‍⚕️ ' + escapeHtml(b.doctorName || '') + '</span>' +
            (b.comment ? '<span class="meta-comment">💬 ' + escapeHtml(b.comment) + '</span>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    var localById = {};
    bookings.forEach(function(b) { localById[b.id] = b; });

    // Pending cards → open action modal
    bookingsList.querySelectorAll('.booking-card.status-pending').forEach(function(card) {
      card.addEventListener('click', function() {
        var booking = localById[this.dataset.id];
        if (booking) openPendingModal(booking);
      });
    });

    // Accepted cards → open edit modal
    bookingsList.querySelectorAll('.booking-card.status-accepted').forEach(function(card) {
      card.addEventListener('click', function() {
        var booking = acceptedById[this.dataset.id];
        if (booking) openApptModal(booking);
      });
    });

    // Rejected cards → open details/restore modal
    bookingsList.querySelectorAll('.booking-card.status-rejected').forEach(function(card) {
      card.addEventListener('click', function() {
        var booking = localById[this.dataset.id];
        if (booking) openRejectedModal(booking);
      });
    });
  }

  // ── UPDATE TAB COUNTS (from in-memory data) ──
  function updateCountsFromData(counts) {
    tabs.forEach(function(tab) {
      var f = tab.dataset.filter;
      var countEl = tab.querySelector('.count');
      if (countEl) countEl.textContent = counts[f] || 0;
    });
  }

  // ── RENDER TIMELINE (visual block schedule) ──
  function renderTimeline(dateStr, acceptedBookings) {
    if (!timelineEl) return;

    var PX_PER_MIN = 2.5;
    var clinicHours = (window.PawsomeBooking && window.PawsomeBooking.CLINIC_HOURS) || {
      1: { open: '08:00', close: '20:00' },
      2: { open: '08:00', close: '20:00' },
      3: { open: '08:00', close: '20:00' },
      4: { open: '08:00', close: '20:00' },
      5: { open: '08:00', close: '20:00' },
      6: { open: '08:00', close: '20:00' },
      0: { open: '09:00', close: '17:00' }
    };

    var date = new Date(dateStr + 'T00:00:00');
    var dayOfWeek = date.getDay();
    var h = clinicHours[dayOfWeek];
    if (!h) { timelineEl.innerHTML = ''; return; }

    var openMin = timeToMins(h.open);
    var closeMin = timeToMins(h.close);
    var totalHeight = Math.round((closeMin - openMin) * PX_PER_MIN);

    // Group bookings into columns: one per doctor in "all" view, single column in "mine"
    var columns;
    if (viewMode === 'all') {
      var doctorMap = {};
      // Seed a column for every known doctor (so empty-day doctors still appear)
      allDoctors.forEach(function(d) {
        doctorMap[d.id] = { name: d.name, bookings: [] };
      });
      // Fill in accepted bookings
      acceptedBookings.forEach(function(b) {
        var key = b.doctorId || b.doctorName || 'unknown';
        if (!doctorMap[key]) doctorMap[key] = { name: b.doctorName || 'Lekarz', bookings: [] };
        doctorMap[key].bookings.push(b);
      });
      columns = Object.keys(doctorMap).map(function(k) { return doctorMap[k]; });
      columns.sort(function(a, b) { return a.name.localeCompare(b.name); });
      if (columns.length === 0) columns = [{ name: '', bookings: [] }];
    } else {
      columns = [{ name: doctorName || '', bookings: acceptedBookings }];
    }

    var showHeaders = columns.length > 1;

    // Hour + half-hour grid lines
    function buildGridLines() {
      var g = '';
      for (var gm = openMin; gm <= closeMin; gm += 60) {
        g += '<div class="sch-grid-line" style="top:' + Math.round((gm - openMin) * PX_PER_MIN) + 'px"></div>';
      }
      for (var hm = openMin + 30; hm < closeMin; hm += 60) {
        g += '<div class="sch-grid-line half" style="top:' + Math.round((hm - openMin) * PX_PER_MIN) + 'px"></div>';
      }
      return g;
    }
    var gridLines = buildGridLines();

    // Build one appointment block
    function buildBlock(b, colorIdx, isSingle) {
      var startMin = timeToMins(b.time);
      if (startMin < openMin || startMin >= closeMin) return '';
      var apptDur = b.duration || getServiceDuration(b.service) || 20;
      var endMin = Math.min(startMin + apptDur, closeMin);
      var topPx = Math.round((startMin - openMin) * PX_PER_MIN);
      var heightPx = Math.round((endMin - startMin) * PX_PER_MIN);
      var endTimeStr = minsToTime(endMin);
      var cls = isSingle ? 'sch-color-mine' : ('sch-color-' + (colorIdx % 6));

      var inner = '<div class="sch-appt-time">' + escapeHtml(b.time) + ' – ' + escapeHtml(endTimeStr) + '</div>' +
        '<div class="sch-appt-patient">' + escapeHtml(b.patientName) + ' · ' + escapeHtml(b.petName) + '</div>' +
        '<div class="sch-appt-service">' + escapeHtml(getServiceName(b.service)) + ' · ' + apptDur + ' min</div>';

      return '<div class="sch-appt-block ' + cls + '" ' +
        'data-id="' + escapeAttr(b.id) + '" ' +
        'style="top:' + topPx + 'px;height:' + heightPx + 'px" ' +
        'title="' + escapeAttr(b.patientName + ' — ' + b.petName + '\n' + getServiceName(b.service) + ' (' + apptDur + ' min)\n' + b.time + ' – ' + endTimeStr) + '">' +
        inner + '</div>';
    }

    // Build columns HTML (body only — headers are in a separate row above)
    var columnsHtml = columns.map(function(col, idx) {
      var blocks = col.bookings.map(function(b) { return buildBlock(b, idx, !showHeaders); }).join('');
      var bodyClass = showHeaders ? ' sch-col-body-multi' : '';
      return '<div class="sch-column">' +
        '<div class="sch-col-body' + bodyClass + '" style="height:' + totalHeight + 'px">' + gridLines + blocks + '</div>' +
        '</div>';
    }).join('');

    // Build header row (combined view only) — separate from the body so the time axis aligns correctly
    var headerRowHtml = '';
    if (showHeaders) {
      var headerCols = columns.map(function(col) {
        return '<div class="sch-col-header">' + escapeHtml(col.name) + '</div>';
      }).join('');
      headerRowHtml = '<div class="sch-header-row"><div class="sch-time-spacer"></div><div class="sch-columns-wrap">' + headerCols + '</div></div>';
    }

    // Build time axis HTML
    var axisHtml = '';
    for (var am = openMin; am <= closeMin; am += 60) {
      axisHtml += '<div class="sch-hour-label" style="top:' + Math.round((am - openMin) * PX_PER_MIN) + 'px">' + minsToTime(am) + '</div>';
    }

    timelineEl.innerHTML =
      '<div class="schedule-wrap" id="schedule-wrap">' +
        '<h3 class="schedule-title">Harmonogram dnia</h3>' +
        (acceptedBookings.length === 0 && viewMode !== 'all' ? '<p class="sch-empty">Brak potwierdzonych wizyt</p>' : '') +
        headerRowHtml +
        '<div class="schedule-layout">' +
          '<div class="sch-time-axis" style="height:' + totalHeight + 'px">' + axisHtml + '</div>' +
          '<div class="sch-columns-wrap">' + columnsHtml + '</div>' +
        '</div>' +
      '</div>';
    // Attach click handlers to appointment blocks
    timelineEl.querySelectorAll('.sch-appt-block').forEach(function(el) {
      el.addEventListener('click', function() {
        var booking = acceptedById[this.dataset.id];
        if (booking) openApptModal(booking);
      });
    });
  }

  // ── ACTIONS ──
  function confirmAccept(id, slotId, duration) {
    var db = window.PawsomeDB;
    var batch = db.batch();
    batch.update(db.collection('appointments').doc(id), { status: 'accepted', duration: duration });
    if (slotId) {
      batch.update(db.collection('slots').doc(slotId), { duration: duration });
    }
    return batch.commit();
  }

  function rejectBooking(id, slotId) {
    var db = window.PawsomeDB;
    var batch = db.batch();
    batch.update(db.collection('appointments').doc(id), { status: 'rejected' });
    if (slotId) batch.delete(db.collection('slots').doc(slotId));
    return batch.commit();
  }

  function restoreBooking(booking, duration) {
    var db = window.PawsomeDB;
    var slotId = booking.slotId || booking.id;
    var batch = db.batch();
    batch.update(db.collection('appointments').doc(booking.id), { status: 'accepted', duration: duration });
    // Slot was deleted on rejection — recreate it with set()
    batch.set(db.collection('slots').doc(slotId), {
      date: booking.date,
      time: booking.time,
      doctorId: booking.doctorId,
      duration: duration
    });
    return batch.commit();
  }

  // ── REJECTED VISIT MODAL ──
  function openRejectedModal(booking) {
    var existing = document.getElementById('rejected-modal-overlay');
    if (existing) existing.parentNode.removeChild(existing);

    var dur = booking.duration || getServiceDuration(booking.service) || 20;
    var endTime = minsToTime(timeToMins(booking.time) + dur);

    var overlay = document.createElement('div');
    overlay.id = 'rejected-modal-overlay';
    overlay.className = 'appt-modal-overlay';

    overlay.innerHTML =
      '<div class="appt-modal">' +
        '<div class="appt-modal-header">' +
          '<h3 class="appt-modal-title">' + escapeHtml(booking.patientName) + ' — ' + escapeHtml(booking.petName) + '</h3>' +
          '<button class="appt-modal-close">&times;</button>' +
        '</div>' +
        '<div class="appt-modal-body">' +
          '<p class="appt-modal-meta">' +
            escapeHtml(getServiceName(booking.service)) + ' &bull; ' +
            escapeHtml(booking.time) + ' – ' + escapeHtml(endTime) +
            ' &bull; ' + escapeHtml(formatPhone(booking.phone)) +
            ' &bull; ' + escapeHtml(booking.email) +
            (booking.comment ? '<br><span class="pending-comment">💬 ' + escapeHtml(booking.comment) + '</span>' : '') +
          '</p>' +
          '<div class="pending-duration-row">' +
            '<label class="pending-dur-label">Czas trwania (min):</label>' +
            '<input type="number" class="duration-input pending-dur-input" value="' + dur + '" min="10" max="240" step="10">' +
          '</div>' +
          '<div class="appt-form-error rejected-modal-error" style="display:none"></div>' +
          '<div class="appt-modal-actions">' +
            '<button class="appt-btn-amend rejected-btn-restore">Przywróć i potwierdź</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    requestAnimationFrame(function() { overlay.classList.add('visible'); });

    var modal = overlay.querySelector('.appt-modal');

    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeRejectedModal(); });
    modal.querySelector('.appt-modal-close').addEventListener('click', closeRejectedModal);

    modal.querySelector('.rejected-btn-restore').addEventListener('click', function() {
      var durVal = parseInt(modal.querySelector('.pending-dur-input').value) || dur;
      var newStart = timeToMins(booking.time);
      var newEnd = newStart + durVal;
      var conflictTime = null;
      Object.keys(acceptedById).forEach(function(bid) {
        var b = acceptedById[bid];
        if (b.doctorId !== booking.doctorId || b.id === booking.id) return;
        var bStart = timeToMins(b.time);
        var bEnd = bStart + (b.duration || getServiceDuration(b.service) || 20);
        if (newStart < bEnd && newEnd > bStart) conflictTime = b.time;
      });
      var errorEl = modal.querySelector('.rejected-modal-error');
      if (conflictTime) {
        errorEl.textContent = 'Czas wizyty koliduje z wizytą o godz. ' + conflictTime + '. Skróć czas trwania.';
        errorEl.style.display = '';
        return;
      }
      var schedErr = validateAgainstDoctorSchedule(booking.time, durVal, booking.date, booking.doctorId);
      if (schedErr) { errorEl.textContent = schedErr; errorEl.style.display = ''; return; }
      errorEl.style.display = 'none';
      restoreBooking(booking, durVal).then(closeRejectedModal);
    });
  }

  function closeRejectedModal() {
    var overlay = document.getElementById('rejected-modal-overlay');
    if (!overlay) return;
    overlay.classList.remove('visible');
    overlay.addEventListener('transitionend', function() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, { once: true });
  }

  // ── PENDING VISIT MODAL ──
  function openPendingModal(booking) {
    var existing = document.getElementById('pending-modal-overlay');
    if (existing) existing.parentNode.removeChild(existing);

    var dur = booking.duration || getServiceDuration(booking.service) || 20;
    var endTime = minsToTime(timeToMins(booking.time) + dur);

    var overlay = document.createElement('div');
    overlay.id = 'pending-modal-overlay';
    overlay.className = 'appt-modal-overlay';

    overlay.innerHTML =
      '<div class="appt-modal">' +
        '<div class="appt-modal-header">' +
          '<h3 class="appt-modal-title">' + escapeHtml(booking.patientName) + ' — ' + escapeHtml(booking.petName) + '</h3>' +
          '<button class="appt-modal-close">&times;</button>' +
        '</div>' +
        '<div class="appt-modal-body">' +
          '<p class="appt-modal-meta">' +
            escapeHtml(getServiceName(booking.service)) + ' &bull; ' +
            escapeHtml(booking.time) + ' – ' + escapeHtml(endTime) +
            ' &bull; ' + escapeHtml(formatPhone(booking.phone)) +
            (booking.comment ? '<br><span class="pending-comment">💬 ' + escapeHtml(booking.comment) + '</span>' : '') +
          '</p>' +
          '<div class="pending-duration-row">' +
            '<label class="pending-dur-label">Czas trwania (min):</label>' +
            '<input type="number" class="duration-input pending-dur-input" value="' + dur + '" min="10" max="240" step="10">' +
          '</div>' +
          '<div class="appt-form-error pending-modal-error" style="display:none"></div>' +
          '<div class="appt-modal-actions" id="pending-modal-actions">' +
            '<button class="appt-btn-amend pending-btn-accept">Potwierdź wizytę</button>' +
            '<button class="appt-btn-delete pending-btn-reject">Odrzuć wizytę</button>' +
          '</div>' +
          '<div class="appt-delete-confirm" id="pending-reject-confirm" style="display:none">' +
            '<p class="appt-delete-warn">Czy na pewno chcesz odrzucić tę wizytę?</p>' +
            '<div class="appt-delete-confirm-actions">' +
              '<button class="appt-btn-delete-confirm">Tak, odrzuć</button>' +
              '<button class="appt-btn-delete-cancel">Anuluj</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    requestAnimationFrame(function() { overlay.classList.add('visible'); });

    var modal = overlay.querySelector('.appt-modal');

    overlay.addEventListener('click', function(e) { if (e.target === overlay) closePendingModal(); });
    modal.querySelector('.appt-modal-close').addEventListener('click', closePendingModal);

    modal.querySelector('.pending-btn-accept').addEventListener('click', function() {
      var durVal = parseInt(modal.querySelector('.pending-dur-input').value) || dur;
      var newStart = timeToMins(booking.time);
      var newEnd = newStart + durVal;
      var conflictTime = null;
      Object.keys(acceptedById).forEach(function(bid) {
        var b = acceptedById[bid];
        if (b.doctorId !== booking.doctorId || b.id === booking.id) return;
        var bStart = timeToMins(b.time);
        var bEnd = bStart + (b.duration || getServiceDuration(b.service) || 20);
        if (newStart < bEnd && newEnd > bStart) conflictTime = b.time;
      });
      var errorEl = modal.querySelector('.pending-modal-error');
      if (conflictTime) {
        errorEl.textContent = 'Czas wizyty koliduje z wizytą o godz. ' + conflictTime + '. Skróć czas trwania.';
        errorEl.style.display = '';
        return;
      }
      var schedErr = validateAgainstDoctorSchedule(booking.time, durVal, booking.date, booking.doctorId);
      if (schedErr) { errorEl.textContent = schedErr; errorEl.style.display = ''; return; }
      errorEl.style.display = 'none';
      confirmAccept(booking.id, booking.slotId || booking.id, durVal).then(closePendingModal);
    });

    modal.querySelector('.pending-btn-reject').addEventListener('click', function() {
      modal.querySelector('#pending-modal-actions').style.display = 'none';
      modal.querySelector('#pending-reject-confirm').style.display = '';
    });

    modal.querySelector('.appt-btn-delete-cancel').addEventListener('click', function() {
      modal.querySelector('#pending-reject-confirm').style.display = 'none';
      modal.querySelector('#pending-modal-actions').style.display = '';
    });

    modal.querySelector('.appt-btn-delete-confirm').addEventListener('click', function() {
      rejectBooking(booking.id, booking.slotId || booking.id).then(closePendingModal);
    });
  }

  function closePendingModal() {
    var overlay = document.getElementById('pending-modal-overlay');
    if (!overlay) return;
    overlay.classList.remove('visible');
    overlay.addEventListener('transitionend', function() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, { once: true });
  }

  // ── APPOINTMENT MODAL ──
  function openApptModal(booking) {
    var existing = document.getElementById('appt-modal-overlay');
    if (existing) existing.parentNode.removeChild(existing);

    var dur = booking.duration || getServiceDuration(booking.service) || 20;
    var endTime = minsToTime(timeToMins(booking.time) + dur);

    var overlay = document.createElement('div');
    overlay.id = 'appt-modal-overlay';
    overlay.className = 'appt-modal-overlay';

    var serviceOptions = [
      ['badania-profilaktyczne', 'Badania profilaktyczne'],
      ['szczepienia', 'Szczepienia'],
      ['stomatologia', 'Stomatologia'],
      ['chirurgia', 'Chirurgia'],
      ['diagnostyka', 'Diagnostyka'],
      ['plany-zywieniowe', 'Plany żywieniowe']
    ].map(function(s) {
      return '<option value="' + s[0] + '"' + (booking.service === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
    }).join('');

    overlay.innerHTML =
      '<div class="appt-modal">' +
        '<div class="appt-modal-header">' +
          '<h3 class="appt-modal-title">' + escapeHtml(booking.patientName) + ' — ' + escapeHtml(booking.petName) + '</h3>' +
          '<button class="appt-modal-close">&times;</button>' +
        '</div>' +
        '<div class="appt-modal-body">' +
          '<p class="appt-modal-meta">' + escapeHtml(getServiceName(booking.service)) + ' &bull; ' + escapeHtml(booking.time) + ' – ' + escapeHtml(endTime) + ' &bull; ' + dur + ' min' + (booking.comment ? '<br><span class="pending-comment">💬 ' + escapeHtml(booking.comment) + '</span>' : '') + '</p>' +
          '<div class="appt-modal-actions">' +
            '<button class="appt-btn-amend">Edytuj wizytę</button>' +
            '<button class="appt-btn-delete">Odrzuć wizytę</button>' +
          '</div>' +
          '<div class="appt-delete-confirm" style="display:none">' +
            '<p class="appt-delete-warn">Czy na pewno chcesz odrzucić tę wizytę?</p>' +
            '<div class="appt-delete-confirm-actions">' +
              '<button class="appt-btn-delete-confirm">Tak, odrzuć</button>' +
              '<button class="appt-btn-delete-cancel">Anuluj</button>' +
            '</div>' +
          '</div>' +
          '<form class="appt-amend-form" style="display:none">' +
            '<div class="appt-form-row"><label>Imię właściciela</label><input type="text" name="patientName" value="' + escapeAttr(booking.patientName || '') + '" required></div>' +
            '<div class="appt-form-row"><label>Imię zwierzęcia</label><input type="text" name="petName" value="' + escapeAttr(booking.petName || '') + '" required></div>' +
            '<div class="appt-form-row"><label>Telefon</label><input type="tel" name="phone" value="' + escapeAttr(booking.phone || '') + '"></div>' +
            '<div class="appt-form-row"><label>Email</label><input type="email" name="email" value="' + escapeAttr(booking.email || '') + '"></div>' +
            '<div class="appt-form-row"><label>Usługa</label><select name="service">' + serviceOptions + '</select></div>' +
            '<div class="appt-form-row"><label>Data wizyty</label><input type="date" name="date" value="' + escapeAttr(booking.date || '') + '" required></div>' +
            '<div class="appt-form-row"><label>Godzina</label><input type="time" name="time" value="' + escapeAttr(booking.time || '') + '" required></div>' +
            '<div class="appt-form-row"><label>Czas trwania (min)</label><input type="number" name="duration" value="' + dur + '" min="10" max="240" step="10" required></div>' +
            '<div class="appt-form-row"><label>Komentarz klienta</label><textarea name="comment" rows="3">' + escapeHtml(booking.comment || '') + '</textarea></div>' +
            '<div class="appt-form-error" style="display:none"></div>' +
            '<div class="appt-form-actions">' +
              '<button type="submit" class="appt-btn-save">Zapisz zmiany</button>' +
              '<button type="button" class="appt-btn-amend-cancel">Anuluj</button>' +
            '</div>' +
          '</form>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    requestAnimationFrame(function() { overlay.classList.add('visible'); });

    var modal = overlay.querySelector('.appt-modal');

    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeApptModal(); });
    modal.querySelector('.appt-modal-close').addEventListener('click', closeApptModal);

    modal.querySelector('.appt-btn-delete').addEventListener('click', function() {
      modal.querySelector('.appt-modal-actions').style.display = 'none';
      modal.querySelector('.appt-delete-confirm').style.display = '';
    });
    modal.querySelector('.appt-btn-delete-cancel').addEventListener('click', function() {
      modal.querySelector('.appt-delete-confirm').style.display = 'none';
      modal.querySelector('.appt-modal-actions').style.display = '';
    });
    modal.querySelector('.appt-btn-delete-confirm').addEventListener('click', function() {
      deleteAppt(booking.id, booking.slotId || booking.id);
    });

    modal.querySelector('.appt-btn-amend').addEventListener('click', function() {
      modal.querySelector('.appt-modal-actions').style.display = 'none';
      modal.querySelector('.appt-amend-form').style.display = '';
    });
    modal.querySelector('.appt-btn-amend-cancel').addEventListener('click', function() {
      modal.querySelector('.appt-amend-form').style.display = 'none';
      modal.querySelector('.appt-modal-actions').style.display = '';
    });
    modal.querySelector('.appt-amend-form').addEventListener('submit', function(e) {
      e.preventDefault();
      var form = this;
      var errorEl = form.querySelector('.appt-form-error');
      var newDate = form.elements.date.value;
      var newTime = form.elements.time.value;
      if (!newDate) {
        errorEl.textContent = 'Wybierz datę wizyty.';
        errorEl.style.display = '';
        return;
      }
      if (!newTime) {
        errorEl.textContent = 'Wybierz godzinę wizyty.';
        errorEl.style.display = '';
        return;
      }
      var newDur = parseInt(form.elements.duration.value) || dur;
      if (isNaN(newDur) || newDur < 10 || newDur > 240) {
        errorEl.textContent = 'Czas trwania musi wynosić od 10 do 240 minut.';
        errorEl.style.display = '';
        return;
      }
      var newStart = timeToMins(newTime);
      var newEnd = newStart + newDur;
      var conflictTime = null;
      Object.keys(acceptedById).forEach(function(bid) {
        var b = acceptedById[bid];
        if (b.doctorId !== booking.doctorId || b.id === booking.id || b.date !== newDate) return;
        var bStart = timeToMins(b.time);
        var bEnd = bStart + (b.duration || getServiceDuration(b.service) || 20);
        if (newStart < bEnd && newEnd > bStart) conflictTime = b.time;
      });
      if (conflictTime) {
        errorEl.textContent = 'Czas wizyty koliduje z wizytą o godz. ' + conflictTime + '. Zmień godzinę lub skróć czas trwania.';
        errorEl.style.display = '';
        return;
      }
      var schedErr = validateAgainstDoctorSchedule(newTime, newDur, newDate, booking.doctorId);
      if (schedErr) { errorEl.textContent = schedErr; errorEl.style.display = ''; return; }
      errorEl.style.display = 'none';
      amendAppt(booking.id, booking.slotId || booking.id, {
        patientName: form.elements.patientName.value.trim(),
        petName: form.elements.petName.value.trim(),
        phone: form.elements.phone.value.trim(),
        email: form.elements.email.value.trim(),
        service: form.elements.service.value,
        date: newDate,
        time: newTime,
        duration: newDur,
        comment: form.elements.comment.value.trim()
      });
    });
  }

  function closeApptModal() {
    var overlay = document.getElementById('appt-modal-overlay');
    if (!overlay) return;
    overlay.classList.remove('visible');
    overlay.addEventListener('transitionend', function() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, { once: true });
  }

  function deleteAppt(id, slotId) {
    rejectBooking(id, slotId).then(closeApptModal);
  }

  function amendAppt(id, slotId, fields) {
    var db = window.PawsomeDB;
    var batch = db.batch();
    batch.update(db.collection('appointments').doc(id), fields);
    if (slotId) batch.update(db.collection('slots').doc(slotId), { date: fields.date, time: fields.time, duration: fields.duration });
    batch.commit().then(closeApptModal).catch(function(err) {
      var errorEl = document.querySelector('.appt-form-error');
      if (errorEl) { errorEl.textContent = 'Błąd zapisu — spróbuj ponownie'; errorEl.style.display = ''; }
    });
  }

  // ── HELPERS ──
  function getServiceDuration(service) {
    var durations = (window.PawsomeBooking && window.PawsomeBooking.SERVICE_DURATIONS) || {
      'badania-profilaktyczne': 20,
      'szczepienia': 20,
      'stomatologia': 60,
      'chirurgia': 90,
      'diagnostyka': 30,
      'plany-zywieniowe': 30
    };
    return durations[service] || 10;
  }

  function getServiceName(slug) {
    // Use shared SERVICES if booking.js is loaded, otherwise fallback
    var services = (window.PawsomeBooking && window.PawsomeBooking.SERVICES) || {
      'badania-profilaktyczne': 'Badania profilaktyczne',
      'szczepienia': 'Szczepienia',
      'stomatologia': 'Stomatologia',
      'chirurgia': 'Chirurgia',
      'diagnostyka': 'Diagnostyka',
      'plany-zywieniowe': 'Plany żywieniowe'
    };
    return services[slug] || slug || '';
  }

  function timeToMins(timeStr) {
    var parts = (timeStr || '').split(':');
    return parseInt(parts[0] || 0) * 60 + parseInt(parts[1] || 0);
  }

  function minsToTime(mins) {
    return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
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

  function escapeAttr(str) {
    return escapeHtml(str);
  }

  function formatDateDisplay(dateStr) {
    if (!dateStr) return '';
    var months = ['stycznia','lutego','marca','kwietnia','maja','czerwca',
                  'lipca','sierpnia','września','października','listopada','grudnia'];
    var parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return parseInt(parts[2], 10) + ' ' + (months[parseInt(parts[1], 10) - 1] || '') + ' ' + parts[0];
  }

  function formatPhone(raw) {
    if (!raw) return '';
    var s = String(raw).replace(/[\s\-().]/g, '');
    if (s.charAt(0) === '+') s = s.slice(1);
    if (s.startsWith('48') && s.length === 11) s = s.slice(2);
    else if (s.charAt(0) === '0') s = s.slice(1);
    if (s.length === 9) return s.slice(0, 3) + ' ' + s.slice(3, 6) + ' ' + s.slice(6);
    return raw;
  }

  function formatDateInput(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // ── DOCTOR SCHEDULE ──
  function loadAllDoctorSchedules() {
    window.PawsomeDB.collection('doctorSchedules').get().then(function(snap) {
      snap.forEach(function(doc) { doctorScheduleCache[doc.id] = doc.data(); });
    });
  }

  function dateStrToDow(dateStr) {
    var p = dateStr.split('-');
    return new Date(+p[0], +p[1]-1, +p[2]).getDay();
  }

  function validateAgainstScheduleData(time, duration, date, sched) {
    if (!sched) return null;
    var vStart = timeToMins(time), vEnd = vStart + duration;
    // Busy blocks are independent of the validity period — always check them
    if (sched.busyBlocks) {
      for (var k = 0; k < sched.busyBlocks.length; k++) {
        var bb = sched.busyBlocks[k];
        if (bb.date !== date) continue;
        if (vStart < timeToMins(bb.endTime) && vEnd > timeToMins(bb.startTime))
          return 'Koliduje z blokad\u0105 ' + bb.startTime + ' \u2013 ' + bb.endTime + '.';
      }
    }
    // Period check applies to the weekly schedule
    if (sched.validFrom && date < sched.validFrom) return null;
    if (sched.validUntil && date > sched.validUntil) return null;
    var dow = String(dateStrToDow(date));
    var day = (sched.days && sched.days[date]) ||
              (sched.defaultWeek && sched.defaultWeek[dow]) ||
              (sched.weeklyHours && sched.weeklyHours[dow]);
    if (!day) return null;
    if (!day.active) return 'Lekarz nie pracuje w tym dniu.';
    var wStart = timeToMins(day.start), wEnd = timeToMins(day.end);
    if (vStart < wStart || vEnd > wEnd)
      return 'Poza godzinami pracy (' + day.start + ' \u2013 ' + day.end + ').';
    var pauses = day.pauses || [];
    for (var i = 0; i < pauses.length; i++) {
      var p = pauses[i];
      var ps = timeToMins(p.start), pe = timeToMins(p.end);
      if (vStart < pe && vEnd > ps)
        return 'Koliduje z przerw\u0105 ' + p.start + ' \u2013 ' + p.end + '.';
    }
    return null;
  }

  function validateAgainstDoctorSchedule(time, duration, date, doctorId) {
    return validateAgainstScheduleData(time, duration, date, doctorScheduleCache[doctorId]);
  }

  function openScheduleModal() {
    var existing = document.getElementById('sched-modal-overlay');
    if (existing) existing.parentNode.removeChild(existing);

    var sched = doctorScheduleCache[currentUser.uid] || {};
    var defaultWeek = sched.defaultWeek || sched.weeklyHours || {};
    var days = sched.days || {};
    var busyBlocks = (sched.busyBlocks || []).slice();
    var validFrom = sched.validFrom || '';
    var validUntil = sched.validUntil || '';
    var dayNames = ['Nd', 'Pn', 'Wt', '\u015ar', 'Cz', 'Pt', 'Sb'];
    var dayOrder = [1, 2, 3, 4, 5, 6, 0];

    var weekPauses = {};
    dayOrder.forEach(function(dow) {
      var d = defaultWeek[String(dow)] || {};
      weekPauses[dow] = (d.pauses || []).map(function(p) { return { start: p.start, end: p.end }; });
    });

    function buildPauseChips(dow) {
      var ps = weekPauses[dow];
      if (!ps || ps.length === 0) return '<span class="sched-no-pauses">bez przerw</span>';
      return ps.map(function(p, idx) {
        return '<span class="sched-pause-chip">' + escapeHtml(p.start) + '\u2013' + escapeHtml(p.end) +
          '<button type="button" class="sched-pause-del" data-dow="' + dow + '" data-idx="' + idx + '">&times;</button>' +
          '</span>';
      }).join('');
    }

    function buildDayRows() {
      return dayOrder.map(function(dow) {
        var d = defaultWeek[String(dow)] || { active: false, start: '08:00', end: '18:00' };
        var checked = d.active ? ' checked' : '';
        var disabled = d.active ? '' : ' disabled';
        return '<div class="sched-day-row" data-dow="' + dow + '">' +
          '<div class="sched-day-main">' +
            '<input type="checkbox" class="sched-day-check"' + checked + '>' +
            '<span class="sched-day-label">' + escapeHtml(dayNames[dow]) + '</span>' +
            '<div class="sched-time-inputs">' +
              '<input type="time" class="sched-time-start" value="' + escapeAttr(d.start || '08:00') + '"' + disabled + '>' +
              '<span>\u2013</span>' +
              '<input type="time" class="sched-time-end" value="' + escapeAttr(d.end || '18:00') + '"' + disabled + '>' +
            '</div>' +
          '</div>' +
          '<div class="sched-pauses-row"' + (d.active ? '' : ' style="display:none"') + '>' +
            '<span class="sched-pauses-label">Przerwy:</span>' +
            '<div class="sched-pause-chips" data-dow="' + dow + '">' + buildPauseChips(dow) + '</div>' +
            '<button type="button" class="sched-add-pause-btn" data-dow="' + dow + '">+ Dodaj</button>' +
          '</div>' +
          '<div class="sched-pause-add-form" data-dow="' + dow + '" style="display:none">' +
            '<input type="time" class="sched-pause-start">' +
            '<span>\u2013</span>' +
            '<input type="time" class="sched-pause-end">' +
            '<button type="button" class="sched-pause-confirm" data-dow="' + dow + '">OK</button>' +
            '<button type="button" class="sched-pause-cancel" data-dow="' + dow + '">Anuluj</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    function buildBusyList() {
      if (busyBlocks.length === 0) return '<div class="sched-busy-empty">Brak blokad</div>';
      return busyBlocks.map(function(bb, idx) {
        return '<div class="sched-busy-item" data-idx="' + idx + '">' +
          '<span>' + escapeHtml(bb.date) + ' ' + escapeHtml(bb.startTime) + '\u2013' + escapeHtml(bb.endTime) + '</span>' +
          '<button type="button" class="sched-busy-delete" data-idx="' + idx + '">&times;</button>' +
        '</div>';
      }).join('');
    }

    var overlay = document.createElement('div');
    overlay.id = 'sched-modal-overlay';
    overlay.className = 'appt-modal-overlay sched-modal-overlay';
    overlay.innerHTML =
      '<div class="appt-modal sched-modal">' +
        '<div class="appt-modal-header">' +
          '<h3 class="appt-modal-title">Grafik pracy</h3>' +
          '<button class="appt-modal-close">&times;</button>' +
        '</div>' +
        '<div class="appt-modal-body">' +
          '<div class="sched-section">' +
            '<div class="sched-section-title">Okres wa\u017cno\u015bci</div>' +
            '<div class="sched-period-row">' +
              '<div><label>Od</label><input type="date" id="sched-valid-from" value="' + escapeAttr(validFrom) + '"></div>' +
              '<div><label>Do</label><input type="date" id="sched-valid-until" value="' + escapeAttr(validUntil) + '"></div>' +
              '<button type="button" id="sched-clear-period">Wyczy\u015b\u0107</button>' +
            '</div>' +
          '</div>' +
          '<div class="sched-section">' +
            '<div class="sched-section-title">Godziny pracy i przerwy</div>' +
            '<div id="sched-day-rows">' + buildDayRows() + '</div>' +
          '</div>' +
          '<div class="sched-section">' +
            '<div class="sched-section-title">Blokady czasu</div>' +
            '<div class="sched-busy-list" id="sched-busy-list">' + buildBusyList() + '</div>' +
            '<div class="sched-add-block">' +
              '<input type="date" id="sched-block-date">' +
              '<input type="time" id="sched-block-start">' +
              '<input type="time" id="sched-block-end">' +
              '<button type="button" id="sched-add-block-btn">Dodaj blokad\u0119</button>' +
            '</div>' +
            '<div class="appt-form-error sched-block-error" style="display:none"></div>' +
          '</div>' +
          '<div class="appt-form-error sched-save-error" style="display:none"></div>' +
          '<div class="appt-form-actions">' +
            '<button type="button" class="appt-btn-save sched-btn-save">Zapisz grafik</button>' +
            '<button type="button" class="appt-btn-amend-cancel sched-btn-cancel">Anuluj</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    requestAnimationFrame(function() { overlay.classList.add('visible'); });

    var modal = overlay.querySelector('.sched-modal');

    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeScheduleModal(); });
    modal.querySelector('.appt-modal-close').addEventListener('click', closeScheduleModal);
    modal.querySelector('.sched-btn-cancel').addEventListener('click', closeScheduleModal);

    modal.querySelector('#sched-clear-period').addEventListener('click', function() {
      modal.querySelector('#sched-valid-from').value = '';
      modal.querySelector('#sched-valid-until').value = '';
    });

    function rebuildPauses(dow) {
      var chips = modal.querySelector('.sched-pause-chips[data-dow="' + dow + '"]');
      if (chips) chips.innerHTML = buildPauseChips(dow);
      wirePauseDeletes();
    }

    function wirePauseDeletes() {
      modal.querySelectorAll('.sched-pause-del').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var dow = parseInt(this.dataset.dow);
          var idx = parseInt(this.dataset.idx);
          weekPauses[dow].splice(idx, 1);
          rebuildPauses(dow);
        });
      });
    }
    wirePauseDeletes();

    modal.querySelectorAll('.sched-day-row').forEach(function(row) {
      var dow = parseInt(row.dataset.dow);
      var check = row.querySelector('.sched-day-check');
      var pausesRow = row.querySelector('.sched-pauses-row');
      check.addEventListener('change', function() {
        var dis = !this.checked;
        row.querySelector('.sched-time-start').disabled = dis;
        row.querySelector('.sched-time-end').disabled = dis;
        if (pausesRow) pausesRow.style.display = dis ? 'none' : '';
      });
      var addBtn = row.querySelector('.sched-add-pause-btn');
      var addForm = row.querySelector('.sched-pause-add-form');
      if (addBtn && addForm) {
        addBtn.addEventListener('click', function() { addForm.style.display = ''; addBtn.style.display = 'none'; });
        addForm.querySelector('.sched-pause-cancel').addEventListener('click', function() {
          addForm.style.display = 'none';
          addBtn.style.display = '';
          addForm.querySelector('.sched-pause-start').value = '';
          addForm.querySelector('.sched-pause-end').value = '';
        });
        addForm.querySelector('.sched-pause-confirm').addEventListener('click', function() {
          var ps = addForm.querySelector('.sched-pause-start').value;
          var pe = addForm.querySelector('.sched-pause-end').value;
          if (!ps || !pe || ps >= pe) return;
          weekPauses[dow].push({ start: ps, end: pe });
          rebuildPauses(dow);
          addForm.style.display = 'none';
          addBtn.style.display = '';
          addForm.querySelector('.sched-pause-start').value = '';
          addForm.querySelector('.sched-pause-end').value = '';
        });
      }
    });

    function wireBusyDeletes() {
      modal.querySelectorAll('.sched-busy-delete').forEach(function(btn) {
        btn.addEventListener('click', function() {
          busyBlocks.splice(parseInt(this.dataset.idx), 1);
          modal.querySelector('#sched-busy-list').innerHTML = buildBusyList();
          wireBusyDeletes();
        });
      });
    }
    wireBusyDeletes();

    modal.querySelector('#sched-add-block-btn').addEventListener('click', function() {
      var blockErr = modal.querySelector('.sched-block-error');
      var date = modal.querySelector('#sched-block-date').value;
      var start = modal.querySelector('#sched-block-start').value;
      var end = modal.querySelector('#sched-block-end').value;
      if (!date || !start || !end) {
        blockErr.textContent = 'Uzupe\u0142nij dat\u0119, godzin\u0119 od i do.';
        blockErr.style.display = '';
        return;
      }
      if (start >= end) {
        blockErr.textContent = 'Godzina zako\u0144czenia musi by\u0107 p\u00f3\u017aniejsza ni\u017c rozpocz\u0119cia.';
        blockErr.style.display = '';
        return;
      }
      blockErr.style.display = 'none';
      busyBlocks.push({ date: date, startTime: start, endTime: end });
      busyBlocks.sort(function(a, b) { return (a.date + a.startTime).localeCompare(b.date + b.startTime); });
      modal.querySelector('#sched-busy-list').innerHTML = buildBusyList();
      wireBusyDeletes();
      modal.querySelector('#sched-block-date').value = '';
      modal.querySelector('#sched-block-start').value = '';
      modal.querySelector('#sched-block-end').value = '';
    });

    modal.querySelector('.sched-btn-save').addEventListener('click', function() {
      var wh = {};
      modal.querySelectorAll('.sched-day-row').forEach(function(row) {
        var dow = row.dataset.dow;
        var active = row.querySelector('.sched-day-check').checked;
        wh[dow] = active ? {
          active: true,
          start: row.querySelector('.sched-time-start').value || '08:00',
          end: row.querySelector('.sched-time-end').value || '18:00',
          pauses: weekPauses[parseInt(dow)].slice()
        } : { active: false };
      });
      saveSchedule({
        defaultWeek: wh,
        validFrom: modal.querySelector('#sched-valid-from').value || null,
        validUntil: modal.querySelector('#sched-valid-until').value || null,
        busyBlocks: busyBlocks.slice(),
        days: days
      }, modal);
    });
  }

  function closeScheduleModal() {
    var overlay = document.getElementById('sched-modal-overlay');
    if (!overlay) return;
    overlay.classList.remove('visible');
    overlay.addEventListener('transitionend', function() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, { once: true });
  }

  function saveSchedule(data, modal) {
    var saveBtn = modal.querySelector('.sched-btn-save');
    var errorEl = modal.querySelector('.sched-save-error');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Sprawdzam...';
    errorEl.style.display = 'none';

    var today = new Date();
    var todayStr = today.getFullYear() + '-' +
      String(today.getMonth()+1).padStart(2,'0') + '-' +
      String(today.getDate()).padStart(2,'0');

    window.PawsomeDB.collection('appointments')
      .where('doctorId', '==', currentUser.uid)
      .where('status', '==', 'accepted')
      .where('date', '>=', todayStr)
      .get()
      .then(function(snap) {
        var conflicts = [];
        snap.forEach(function(doc) {
          var b = doc.data();
          var dur = b.duration || getServiceDuration(b.service) || 20;
          var err = validateAgainstScheduleData(b.time, dur, b.date, data);
          if (err) conflicts.push(b.date + ' ' + b.time + ' \u2014 ' + (b.patientName || '') + ': ' + err);
        });
        if (conflicts.length > 0) {
          errorEl.innerHTML = 'Grafik koliduje z potwierdzonymi wizytami:<br>' + conflicts.slice(0,5).map(escapeHtml).join('<br>');
          errorEl.style.display = '';
          saveBtn.disabled = false;
          saveBtn.textContent = 'Zapisz grafik';
          return;
        }
        return window.PawsomeDB.collection('doctorSchedules').doc(currentUser.uid)
          .set(data)
          .then(function() {
            doctorScheduleCache[currentUser.uid] = data;
            closeScheduleModal();
          });
      })
      .catch(function(err) {
        errorEl.textContent = err && err.code
          ? ('B\u0142\u0105d zapisu: ' + err.code)
          : 'B\u0142\u0105d zapisu \u2014 spr\u00f3buj ponownie.';
        errorEl.style.display = '';
        saveBtn.disabled = false;
        saveBtn.textContent = 'Zapisz grafik';
      });
  }

  // ── VIEW SCHEDULE MODAL ──
  function loadAllDoctors() {
    window.PawsomeDB.collection('doctors').get().then(function(snap) {
      allDoctors = [];
      snap.forEach(function(doc) {
        allDoctors.push({ id: doc.id, name: doc.data().name || 'Lekarz' });
      });
      allDoctors.sort(function(a, b) { return a.name.localeCompare(b.name); });
    }).catch(function() {});
  }

  function openViewScheduleModal() {
    var existing = document.getElementById('view-sched-modal-overlay');
    if (existing) existing.parentNode.removeChild(existing);

    var hdrNames = ['Pn', 'Wt', '\u015ar', 'Cz', 'Pt', 'Sb', 'Nd'];
    var monthNames = ['Stycze\u0144','Luty','Marzec','Kwiecie\u0144','Maj','Czerwiec',
      'Lipiec','Sierpie\u0144','Wrzesie\u0144','Pa\u017adziernik','Listopad','Grudzie\u0144'];
    var todayStr = formatDateInput(new Date());
    var now = new Date();
    var viewYear = now.getFullYear();
    var viewMonth = now.getMonth();
    var selectedDoctorId = currentUser.uid;

    function getDayConfig(sched, dateStr, dow) {
      if (!sched) return null;
      // Outside validity period → no schedule
      if (sched.validFrom && dateStr < sched.validFrom) return null;
      if (sched.validUntil && dateStr > sched.validUntil) return null;
      return (sched.days && sched.days[dateStr]) ||
             (sched.defaultWeek && sched.defaultWeek[String(dow)]) ||
             (sched.weeklyHours && sched.weeklyHours[String(dow)]);
    }

    function renderCalendar(year, month, doctorId) {
      var sched = doctorScheduleCache[doctorId];
      var firstDay = new Date(year, month, 1);
      var lastDate = new Date(year, month + 1, 0).getDate();
      var startOffset = (firstDay.getDay() + 6) % 7;

      var html = '<div class="vs-cal-header">';
      hdrNames.forEach(function(h) { html += '<div class="vs-cal-hdr-cell">' + escapeHtml(h) + '</div>'; });
      html += '</div><div class="vs-cal-grid">';

      for (var i = 0; i < startOffset; i++) {
        html += '<div class="vs-cal-cell vs-cal-empty"></div>';
      }
      for (var d = 1; d <= lastDate; d++) {
        var dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        var date = new Date(year, month, d);
        var dow = date.getDay();
        var cfg = getDayConfig(sched, dateStr, dow);
        var dayBusy = (sched && sched.busyBlocks)
          ? sched.busyBlocks.filter(function(bb) { return bb.date === dateStr; })
          : [];
        var isToday = dateStr === todayStr;
        var isActive = cfg && cfg.active;
        var isOff = cfg && !cfg.active;

        var cls = 'vs-cal-cell' +
          (isToday ? ' vs-cal-today' : '') +
          (isActive ? ' vs-cal-active' : isOff ? ' vs-cal-off' : ' vs-cal-nosched');

        var inner = '<div class="vs-cal-day-num">' + d + '</div>';
        if (isActive) {
          inner += '<div class="vs-cal-hours">' + escapeHtml(cfg.start) + '\u2013' + escapeHtml(cfg.end) + '</div>';
          (cfg.pauses || []).forEach(function(p) {
            inner += '<div class="vs-cal-pause">' + escapeHtml(p.start) + '\u2013' + escapeHtml(p.end) + '</div>';
          });
        } else if (isOff) {
          inner += '<div class="vs-cal-hours vs-cal-hours-off">Wolny</div>';
        } else {
          inner += '<div class="vs-cal-hours vs-cal-hours-clinic">\u2013</div>';
        }
        dayBusy.forEach(function(bb) {
          inner += '<div class="vs-cal-busy">' + escapeHtml(bb.startTime) + '\u2013' + escapeHtml(bb.endTime) + '</div>';
        });
        html += '<div class="' + cls + '">' + inner + '</div>';
      }
      return html + '</div>';
    }

    function refresh() {
      overlay.querySelector('#vs-month-label').textContent = monthNames[viewMonth] + ' ' + viewYear;
      overlay.querySelector('#view-sched-content').innerHTML = renderCalendar(viewYear, viewMonth, selectedDoctorId);
    }

    var myId = currentUser.uid;
    var doctorList = allDoctors.length > 0 ? allDoctors : [{ id: myId, name: doctorName || 'M\u00f3j grafik' }];
    var doctorOptions = doctorList.map(function(d) {
      return '<option value="' + escapeAttr(d.id) + '"' + (d.id === myId ? ' selected' : '') + '>' + escapeHtml(d.name) + '</option>';
    }).join('');

    var overlay = document.createElement('div');
    overlay.id = 'view-sched-modal-overlay';
    overlay.className = 'appt-modal-overlay';
    overlay.innerHTML =
      '<div class="appt-modal view-sched-modal">' +
        '<div class="appt-modal-header">' +
          '<h3 class="appt-modal-title">Podgl\u0105d grafiku</h3>' +
          '<button class="appt-modal-close">&times;</button>' +
        '</div>' +
        '<div class="appt-modal-body">' +
          '<div class="view-sched-selector">' +
            '<label class="view-sched-label">Lekarz:</label>' +
            '<select id="view-sched-doctor" class="view-sched-select">' + doctorOptions + '</select>' +
          '</div>' +
          '<div class="view-sched-nav">' +
            '<button class="vs-nav-btn" id="vs-prev-month">&#8249;</button>' +
            '<span class="vs-month-label" id="vs-month-label"></span>' +
            '<button class="vs-nav-btn" id="vs-next-month">&#8250;</button>' +
          '</div>' +
          '<div id="view-sched-content"></div>' +
          '<div class="vs-legend">' +
            '<span class="vs-leg-item vs-leg-active">Pracuje</span>' +
            '<span class="vs-leg-item vs-leg-off">Wolny</span>' +
            '<span class="vs-leg-item vs-leg-nosched">Brak grafiku</span>' +
            '<span class="vs-leg-item vs-leg-busy">Blokada</span>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    requestAnimationFrame(function() { overlay.classList.add('visible'); });

    var modal = overlay.querySelector('.view-sched-modal');
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeViewScheduleModal(); });
    modal.querySelector('.appt-modal-close').addEventListener('click', closeViewScheduleModal);
    overlay.querySelector('#view-sched-doctor').addEventListener('change', function() {
      selectedDoctorId = this.value;
      refresh();
    });
    overlay.querySelector('#vs-prev-month').addEventListener('click', function() {
      viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      refresh();
    });
    overlay.querySelector('#vs-next-month').addEventListener('click', function() {
      viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      refresh();
    });
    refresh();
  }

  function closeViewScheduleModal() {
    var overlay = document.getElementById('view-sched-modal-overlay');
    if (!overlay) return;
    overlay.classList.remove('visible');
    overlay.addEventListener('transitionend', function() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, { once: true });
  }

  // ── INIT ──
  initAuth();
})();
