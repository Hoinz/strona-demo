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
  var canEditWebsite = true;
  var acceptedById = {};   // id → booking, for the click-to-edit modal
  var doctorScheduleCache = {};  // doctorId → schedule doc data
  var allDoctors = [];           // [{id, name}] for view-schedule selector
  var currentUserRole = null;    // 'admin' | 'doctor' — from roles collection

  // ── AUTH ──
  function initAuth() {
    var auth = window.PawsomeAuth;
    if (!auth) return;

    auth.onAuthStateChanged(function(user) {
      if (user) {
        // Check role in Firestore roles collection
        window.PawsomeDB.collection('roles').doc(user.uid).get().then(function(roleDoc) {
          var roleData = roleDoc.exists ? roleDoc.data() : {};
          var role = roleData.role || null;
          if (role !== 'admin' && role !== 'doctor') {
            auth.signOut();
            loginError.textContent = 'Brak uprawnień do panelu administracyjnego. Skontaktuj się z administratorem.';
            loginError.classList.add('visible');
            return;
          }
          currentUser = user;
          currentUserRole = role;
          canEditWebsite = role === 'admin' || !!roleData.canEditWebsite;
          loginView.style.display = 'none';
          dashboard.classList.add('visible');
          if (!dashboardInitialized) {
            loadDoctorInfo(user.uid, function() {
              initDashboard();
              dashboardInitialized = true;
              checkContentHealth();
            });
          } else {
            loadBookings();
          }
        }).catch(function() {
          auth.signOut();
          loginError.textContent = 'Błąd weryfikacji uprawnień. Spróbuj ponownie.';
          loginError.classList.add('visible');
        });
      } else {
        currentUser = null;
        currentUserRole = null;
        doctorName = '';
        canEditWebsite = true;
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
      if (doc.exists) {
        var data = doc.data();
        doctorName = data.name || '';
        canEditWebsite = data.canEditWebsite !== undefined ? !!data.canEditWebsite : true;
      } else {
        doctorName = 'Lekarz';
        canEditWebsite = true;
      }
      var labelEl = document.getElementById('doctor-label');
      if (labelEl) labelEl.textContent = 'Zalogowany jako: ' + doctorName;
      applyEditorPermission();
      callback();
    }).catch(function() { callback(); });
  }

  function applyEditorPermission() {
    var editorTab = document.getElementById('main-tab-editor');
    if (!editorTab) return;
    var hasEditorAccess = canEditWebsite;
    if (hasEditorAccess) {
      editorTab.style.display = '';
    } else {
      editorTab.style.display = 'none';
      // If currently on editor view, switch to bookings
      if (editorTab.classList.contains('active')) {
        editorTab.classList.remove('active');
        var bookingsTab = document.getElementById('main-tab-bookings');
        if (bookingsTab) bookingsTab.classList.add('active');
        var viewBookings = document.getElementById('view-bookings');
        var viewEditor = document.getElementById('view-editor');
        if (viewBookings) viewBookings.style.display = '';
        if (viewEditor) viewEditor.style.display = 'none';
      }
    }
  }

  // ── LOGIN ──
  loginForm.addEventListener('submit', function(e) {
    e.preventDefault();
    loginError.classList.remove('visible');
    loginError.style.color = '';
    var email = document.getElementById('login-email').value;
    var password = document.getElementById('login-password').value;

    window.PawsomeAuth.signInWithEmailAndPassword(email, password)
      .catch(function() {
        loginError.textContent = 'Nieprawidłowy email lub hasło';
        loginError.classList.add('visible');
      });
  });

  // ── FORGOT PASSWORD ──
  document.getElementById('forgot-password-link').addEventListener('click', function(e) {
    e.preventDefault();
    var email = document.getElementById('login-email').value.trim();
    if (!email) {
      loginError.textContent = 'Wpisz swój adres email powyżej, a następnie kliknij ten link';
      loginError.classList.add('visible');
      return;
    }
    window.PawsomeAuth.sendPasswordResetEmail(email).then(function() {
      loginError.style.color = '#2e7d32';
      loginError.textContent = 'Link do resetowania hasła został wysłany na ' + email;
      loginError.classList.add('visible');
    }).catch(function(err) {
      loginError.style.color = '';
      if (err.code === 'auth/user-not-found') {
        loginError.textContent = 'Nie znaleziono konta z tym adresem email';
      } else if (err.code === 'auth/invalid-email') {
        loginError.textContent = 'Nieprawidłowy format adresu email';
      } else {
        loginError.textContent = 'Błąd: ' + err.message;
      }
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
    var weekSchedBtn = document.getElementById('btn-week-schedule');
    if (weekSchedBtn) weekSchedBtn.addEventListener('click', openWeekScheduleModal);

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

    var innerHtml = headerRowHtml +
      '<div class="schedule-layout">' +
        '<div class="sch-time-axis" style="height:' + totalHeight + 'px">' + axisHtml + '</div>' +
        '<div class="sch-columns-wrap">' + columnsHtml + '</div>' +
      '</div>';
    timelineEl.innerHTML =
      '<div class="schedule-wrap" id="schedule-wrap">' +
        '<h3 class="schedule-title">Harmonogram dnia</h3>' +
        (acceptedBookings.length === 0 && viewMode !== 'all' ? '<p class="sch-empty">Brak potwierdzonych wizyt</p>' : '') +
        (showHeaders ? '<div class="sched-scroll">' + innerHtml + '</div>' : innerHtml) +
      '</div>';
    if (showHeaders) {
      requestAnimationFrame(function() {
        var s = timelineEl.querySelector('.sched-scroll');
        if (s) s.style.height = s.scrollHeight + 'px';
      });
    }
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

    var services = (window.PawsomeBooking && window.PawsomeBooking.SERVICES) || {
      'badania-profilaktyczne': 'Badania profilaktyczne',
      'szczepienia': 'Szczepienia',
      'stomatologia': 'Stomatologia',
      'chirurgia': 'Chirurgia',
      'diagnostyka': 'Diagnostyka',
      'plany-zywieniowe': 'Plany żywieniowe'
    };
    var serviceOptions = Object.keys(services).map(function(key) {
      return '<option value="' + key + '"' + (booking.service === key ? ' selected' : '') + '>' + escapeHtml(services[key]) + '</option>';
    }).join('');

    overlay.innerHTML =
      '<div class="appt-modal">' +
        '<div class="appt-modal-header">' +
          '<h3 class="appt-modal-title">' + escapeHtml(booking.patientName) + ' — ' + escapeHtml(booking.petName) + '</h3>' +
          '<button class="appt-modal-close">&times;</button>' +
        '</div>' +
        '<div class="appt-modal-body">' +
          '<p class="appt-modal-meta">' + escapeHtml(getServiceName(booking.service)) + ' &bull; ' + escapeHtml(booking.time) + ' \u2013 ' + escapeHtml(endTime) + ' &bull; ' + dur + ' min' + (booking.comment ? '<br><span class="pending-comment">\uD83D\uDCAC ' + escapeHtml(booking.comment) + '</span>' : '') + '</p>' +
          '<div class="appt-modal-actions">' +
            '<div class="appt-actions-edit">' +
              '<button class="appt-btn-amend-time">Edytuj termin</button>' +
              '<button class="appt-btn-amend-entry">Edytuj dane</button>' +
            '</div>' +
            '<button class="appt-btn-delete">Odrzuć wizytę</button>' +
          '</div>' +
          '<div class="appt-delete-confirm" style="display:none">' +
            '<p class="appt-delete-warn">Czy na pewno chcesz odrzucić tę wizytę?</p>' +
            '<div class="appt-delete-confirm-actions">' +
              '<button class="appt-btn-delete-confirm">Tak, odrzuć</button>' +
              '<button class="appt-btn-delete-cancel">Anuluj</button>' +
            '</div>' +
          '</div>' +
          '<form class="appt-time-form" style="display:none">' +
            '<div class="appt-form-row"><label>Data wizyty</label><input type="date" name="date" value="' + escapeAttr(booking.date || '') + '" required></div>' +
            '<div class="appt-form-row"><label>Godzina</label><input type="time" name="time" value="' + escapeAttr(booking.time || '') + '" required></div>' +
            '<div class="appt-form-row"><label>Czas trwania (min)</label><input type="number" name="duration" value="' + dur + '" min="10" max="240" step="10" required></div>' +
            '<div class="appt-form-error" style="display:none"></div>' +
            '<div class="appt-form-actions">' +
              '<button type="submit" class="appt-btn-save">Zapisz zmiany</button>' +
              '<button type="button" class="appt-btn-form-cancel">Anuluj</button>' +
            '</div>' +
          '</form>' +
          '<form class="appt-entry-form" style="display:none">' +
            '<div class="appt-form-row"><label>Imię właściciela</label><input type="text" name="patientName" value="' + escapeAttr(booking.patientName || '') + '" required></div>' +
            '<div class="appt-form-row"><label>Imię zwierzęcia</label><input type="text" name="petName" value="' + escapeAttr(booking.petName || '') + '" required></div>' +
            '<div class="appt-form-row"><label>Telefon</label><input type="tel" name="phone" value="' + escapeAttr(booking.phone || '') + '"></div>' +
            '<div class="appt-form-row"><label>Email</label><input type="email" name="email" value="' + escapeAttr(booking.email || '') + '"></div>' +
            '<div class="appt-form-row"><label>Usługa</label><select name="service">' + serviceOptions + '</select></div>' +
            '<div class="appt-form-row"><label>Komentarz klienta</label><textarea name="comment" rows="3">' + escapeHtml(booking.comment || '') + '</textarea></div>' +
            '<div class="appt-form-actions">' +
              '<button type="submit" class="appt-btn-save">Zapisz zmiany</button>' +
              '<button type="button" class="appt-btn-form-cancel">Anuluj</button>' +
            '</div>' +
          '</form>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    requestAnimationFrame(function() { overlay.classList.add('visible'); });

    var modal = overlay.querySelector('.appt-modal');

    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeApptModal(); });
    modal.querySelector('.appt-modal-close').addEventListener('click', closeApptModal);

    function showActions() {
      modal.querySelector('.appt-modal-actions').style.display = '';
      modal.querySelector('.appt-delete-confirm').style.display = 'none';
      modal.querySelector('.appt-time-form').style.display = 'none';
      modal.querySelector('.appt-entry-form').style.display = 'none';
    }

    modal.querySelector('.appt-btn-delete').addEventListener('click', function() {
      modal.querySelector('.appt-modal-actions').style.display = 'none';
      modal.querySelector('.appt-delete-confirm').style.display = '';
    });
    modal.querySelector('.appt-btn-delete-cancel').addEventListener('click', showActions);
    modal.querySelector('.appt-btn-delete-confirm').addEventListener('click', function() {
      deleteAppt(booking.id, booking.slotId || booking.id);
    });

    modal.querySelector('.appt-btn-amend-time').addEventListener('click', function() {
      modal.querySelector('.appt-modal-actions').style.display = 'none';
      modal.querySelector('.appt-time-form').style.display = '';
    });
    modal.querySelector('.appt-btn-amend-entry').addEventListener('click', function() {
      modal.querySelector('.appt-modal-actions').style.display = 'none';
      modal.querySelector('.appt-entry-form').style.display = '';
    });
    modal.querySelectorAll('.appt-btn-form-cancel').forEach(function(btn) {
      btn.addEventListener('click', showActions);
    });

    modal.querySelector('.appt-time-form').addEventListener('submit', function(e) {
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
        date: newDate,
        time: newTime,
        duration: newDur
      });
    });

    modal.querySelector('.appt-entry-form').addEventListener('submit', function(e) {
      e.preventDefault();
      var form = this;
      amendAppt(booking.id, null, {
        patientName: form.elements.patientName.value.trim(),
        petName: form.elements.petName.value.trim(),
        phone: form.elements.phone.value.trim(),
        email: form.elements.email.value.trim(),
        service: form.elements.service.value,
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
    window.PawsomeDB.collection('doctorSchedules').onSnapshot(function(snap) {
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
          return 'Wizyta przypada na zablokowany czas lekarza (' + bb.startTime + '\u2013' + bb.endTime + '). Wybierz inną godzinę.';
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
    if (!day.active) return 'Lekarz nie pracuje w wybranym dniu.';
    var wStart = timeToMins(day.start), wEnd = timeToMins(day.end);
    if (vStart < wStart || vEnd > wEnd)
      return 'Godzina wizyty wykracza poza godziny pracy lekarza (' + day.start + '\u2013' + day.end + '). Wybierz inną godzinę.';
    var pauses = day.pauses || [];
    for (var i = 0; i < pauses.length; i++) {
      var p = pauses[i];
      var ps = timeToMins(p.start), pe = timeToMins(p.end);
      if (vStart < pe && vEnd > ps)
        return 'Wizyta przypada na przerwę lekarza (' + p.start + '\u2013' + p.end + '). Wybierz inną godzinę.';
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

  // ── WEEK SCHEDULE MODAL ──
  function getWeekDates() {
    var today = new Date();
    var dow = today.getDay();
    var diffToMon = (dow === 0) ? -6 : 1 - dow;
    var monday = new Date(today);
    monday.setDate(today.getDate() + diffToMon);
    var dates = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date(monday);
      d.setDate(monday.getDate() + i);
      dates.push(formatDateInput(d));
    }
    return dates;
  }

  function buildWeekLabel(mondayStr, sundayStr) {
    var polishMonths = ['stycznia','lutego','marca','kwietnia','maja','czerwca',
      'lipca','sierpnia','września','października','listopada','grudnia'];
    var mParts = mondayStr.split('-');
    var sParts = sundayStr.split('-');
    var mDay = parseInt(mParts[2], 10);
    var sDay = parseInt(sParts[2], 10);
    var sMonth = polishMonths[parseInt(sParts[1], 10) - 1];
    var sYear = sParts[0];
    if (mParts[1] === sParts[1]) {
      return mDay + '\u2013' + sDay + ' ' + sMonth + ' ' + sYear;
    }
    var mMonth = polishMonths[parseInt(mParts[1], 10) - 1];
    return mDay + ' ' + mMonth + ' \u2013 ' + sDay + ' ' + sMonth + ' ' + sYear;
  }

  // filterDoctorId: null = all doctors, string = single doctor
  function buildWeekGrid(weekDates, apptsByDate, filterDoctorId, todayStr, doctorNameMap) {
    var dayNames = ['Poniedziałek','Wtorek','Środa','Czwartek','Piątek','Sobota','Niedziela'];
    var dowForDate = [1,2,3,4,5,6,0]; // Mon..Sun → JS getDay values

    function getDayConfig(sched, dateStr, jsdow) {
      if (!sched) return null;
      if (sched.validFrom && dateStr < sched.validFrom) return null;
      if (sched.validUntil && dateStr > sched.validUntil) return null;
      return (sched.days && sched.days[dateStr]) ||
             (sched.defaultWeek && sched.defaultWeek[String(jsdow)]) ||
             (sched.weeklyHours && sched.weeklyHours[String(jsdow)]);
    }

    function apptCountLabel(n) {
      if (n === 1) return '1 wizyta';
      if (n <= 4) return n + ' wizyty';
      return n + ' wizyt';
    }

    var label = buildWeekLabel(weekDates[0], weekDates[6]);
    var html = '<div class="week-sched-label">' + escapeHtml(label) + '</div>';
    html += '<div class="week-sched-grid">';

    weekDates.forEach(function(dateStr, idx) {
      var jsdow = dowForDate[idx];
      var isToday = dateStr === todayStr;
      var dayAppts = (apptsByDate[dateStr] || []).filter(function(a) {
        return a.status === 'accepted' || a.status === 'pending';
      }).sort(function(a, b) {
        return timeToMins(a.time) - timeToMins(b.time);
      });

      // For single-doctor mode: pull schedule config + busy blocks
      var sched = filterDoctorId ? doctorScheduleCache[filterDoctorId] : null;
      var cfg = filterDoctorId ? getDayConfig(sched, dateStr, jsdow) : null;
      var isActive = cfg && cfg.active;
      var isOff = filterDoctorId && cfg && !cfg.active;
      var busyBlocks = (sched && sched.busyBlocks)
        ? sched.busyBlocks.filter(function(bb) { return bb.date === dateStr; })
        : [];

      var cardCls = 'week-day-card';
      if (isToday) cardCls += ' week-day-today';
      else if (filterDoctorId && isOff) cardCls += ' week-day-off';

      var dateParts = dateStr.split('-');
      var dateLabel = parseInt(dateParts[2], 10) + '.' + parseInt(dateParts[1], 10) + '.';

      html += '<div class="' + cardCls + '">';
      html += '<div class="week-day-header">';
      html += '<span class="week-day-name">' + escapeHtml(dayNames[idx]) + '</span>';
      html += '<span class="week-day-date">' + escapeHtml(dateLabel) + '</span>';
      if (isToday) html += '<span class="week-day-today-badge">Dziś</span>';
      html += '</div>';

      // Schedule info — only in single-doctor mode
      if (filterDoctorId) {
        if (isActive) {
          html += '<div class="week-day-hours">' + escapeHtml(cfg.start) + '\u2013' + escapeHtml(cfg.end) + '</div>';
          (cfg.pauses || []).forEach(function(p) {
            html += '<div class="week-day-pause">Przerwa: ' + escapeHtml(p.start) + '\u2013' + escapeHtml(p.end) + '</div>';
          });
        } else if (isOff) {
          html += '<div class="week-day-off-label">Dzień wolny</div>';
        }
        busyBlocks.forEach(function(bb) {
          html += '<div class="week-day-busy">Blokada: ' + escapeHtml(bb.startTime) + '\u2013' + escapeHtml(bb.endTime) + '</div>';
        });
      }

      if (dayAppts.length > 0) {
        html += '<div class="week-appt-count">' + escapeHtml(apptCountLabel(dayAppts.length)) + '</div>';
        html += '<div class="week-appt-list">';
        dayAppts.forEach(function(a) {
          var endTime = minsToTime(timeToMins(a.time) + (a.duration || 20));
          var cls = 'week-appt-item ' + (a.status === 'accepted' ? 'week-appt-accepted' : 'week-appt-pending');
          html += '<div class="' + cls + '">';
          html += '<div class="week-appt-time">' + escapeHtml(a.time) + '\u2013' + escapeHtml(endTime) + '</div>';
          if (!filterDoctorId && doctorNameMap) {
            var dname = doctorNameMap[a.doctorId] || '';
            if (dname) html += '<div class="week-appt-doctor">' + escapeHtml(dname) + '</div>';
          }
          html += '<div class="week-appt-patient">' + escapeHtml(a.patientName || '') + ' / ' + escapeHtml(a.petName || '') + '</div>';
          html += '<div class="week-appt-service">' + escapeHtml(getServiceName(a.service)) + '</div>';
          html += '</div>';
        });
        html += '</div>';
      }

      html += '</div>';
    });

    html += '</div>';
    html += '<div class="week-sched-legend">';
    html += '<span class="week-leg-item week-leg-accepted">Potwierdzona</span>';
    html += '<span class="week-leg-item week-leg-pending">Oczekująca</span>';
    if (filterDoctorId) html += '<span class="week-leg-item week-leg-busy">Blokada</span>';
    html += '</div>';
    return html;
  }

  function openWeekScheduleModal() {
    var existing = document.getElementById('week-sched-modal-overlay');
    if (existing) existing.parentNode.removeChild(existing);

    var weekDates = getWeekDates();
    var todayStr = formatDateInput(new Date());
    var myId = currentUser.uid;
    var selectedDoctorId = 'all'; // default: all doctors

    var doctorList = allDoctors.length > 0 ? allDoctors : [{ id: myId, name: doctorName || 'Mój grafik' }];
    var doctorOptions = '<option value="all" selected>Wszyscy lekarze</option>' +
      doctorList.map(function(d) {
        return '<option value="' + escapeAttr(d.id) + '">' + escapeHtml(d.name) + '</option>';
      }).join('');

    // Build name lookup map
    var doctorNameMap = {};
    doctorList.forEach(function(d) { doctorNameMap[d.id] = d.name; });

    var overlay = document.createElement('div');
    overlay.id = 'week-sched-modal-overlay';
    overlay.className = 'appt-modal-overlay';
    overlay.innerHTML =
      '<div class="appt-modal week-sched-modal">' +
        '<div class="appt-modal-header">' +
          '<h3 class="appt-modal-title">Harmonogram na ten tydzień</h3>' +
          '<button class="appt-modal-close">&times;</button>' +
        '</div>' +
        '<div class="appt-modal-body">' +
          '<div class="view-sched-selector">' +
            '<label class="view-sched-label">Lekarz:</label>' +
            '<select id="week-sched-doctor" class="view-sched-select">' + doctorOptions + '</select>' +
          '</div>' +
          '<div id="week-sched-content"><div class="week-sched-loading">Ładowanie wizyt\u2026</div></div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    requestAnimationFrame(function() { overlay.classList.add('visible'); });

    var modal = overlay.querySelector('.week-sched-modal');
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeWeekScheduleModal(); });
    modal.querySelector('.appt-modal-close').addEventListener('click', closeWeekScheduleModal);

    function fetchAndRender(doctorId) {
      var contentEl = overlay.querySelector('#week-sched-content');
      contentEl.innerHTML = '<div class="week-sched-loading">Ładowanie wizyt\u2026</div>';

      var promises = weekDates.map(function(dateStr) {
        return window.PawsomeDB.collection('appointments')
          .where('date', '==', dateStr)
          .get();
      });
      Promise.all(promises)
        .then(function(snaps) {
          var apptsByDate = {};
          snaps.forEach(function(snap, i) {
            var dateStr = weekDates[i];
            snap.forEach(function(doc) {
              var a = doc.data();
              if (a.status !== 'accepted' && a.status !== 'pending') return;
              if (doctorId !== 'all' && a.doctorId !== doctorId) return;
              if (!apptsByDate[dateStr]) apptsByDate[dateStr] = [];
              apptsByDate[dateStr].push(a);
            });
          });
          var filterArg = doctorId !== 'all' ? doctorId : null;
          contentEl.innerHTML = buildWeekGrid(weekDates, apptsByDate, filterArg, todayStr, doctorNameMap);
        })
        .catch(function(err) {
          console.error('Week schedule fetch error:', err);
          contentEl.innerHTML = '<div class="week-sched-loading">Błąd ładowania wizyt.</div>';
        });
    }

    overlay.querySelector('#week-sched-doctor').addEventListener('change', function() {
      selectedDoctorId = this.value;
      fetchAndRender(selectedDoctorId);
    });

    fetchAndRender(selectedDoctorId);
  }

  function closeWeekScheduleModal() {
    var overlay = document.getElementById('week-sched-modal-overlay');
    if (!overlay) return;
    overlay.classList.remove('visible');
    overlay.addEventListener('transitionend', function() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, { once: true });
  }

  // ══════════════════════════════════════════════════════════
  // ── MAIN TAB SWITCHING ──
  // ══════════════════════════════════════════════════════════
  var mainTabs = document.querySelectorAll('.admin-main-tab');
  var viewBookings = document.getElementById('view-bookings');
  var viewEditor = document.getElementById('view-editor');
  var editorLoaded = false;

  mainTabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      mainTabs.forEach(function(t) { t.classList.remove('active'); });
      this.classList.add('active');
      var target = this.dataset.mainTab;
      if (target === 'bookings') {
        viewBookings.style.display = '';
        viewEditor.style.display = 'none';
      } else if (target === 'editor') {
        viewBookings.style.display = 'none';
        viewEditor.style.display = '';
        if (!editorLoaded) {
          editorLoaded = true;
          loadEditorContent();
        }
      }
    });
  });

  // ══════════════════════════════════════════════════════════
  // ── CONTENT HEALTH MONITOR ──
  // ══════════════════════════════════════════════════════════
  function checkContentHealth() {
    var db = window.PawsomeDB;
    if (!db) return;
    var banner = document.getElementById('content-health-banner');
    if (!banner) return;

    var warnings = [];
    var cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - 24);

    Promise.all([
      db.collection('siteErrors').where('timestamp', '>', cutoff).get(),
      db.collection('siteContent').doc('_health').get()
    ]).then(function(results) {
      var errorSnap = results[0];
      var healthDoc = results[1];

      if (!errorSnap.empty) {
        var errCount = errorSnap.size;
        var lastErr = null;
        errorSnap.forEach(function(doc) {
          var d = doc.data();
          if (!lastErr || (d.timestamp && d.timestamp.toDate() > lastErr)) lastErr = d.timestamp.toDate();
        });
        warnings.push('<strong>Uwaga:</strong> wykryto ' + errCount + ' problem' + (errCount === 1 ? '' : errCount < 5 ? 'y' : 'ów') + ' z ładowaniem treści strony w ostatnich 24h.' + (lastErr ? ' Ostatni: ' + lastErr.toLocaleString('pl-PL') : ''));
      }

      if (healthDoc.exists) {
        var health = healthDoc.data();
        if (health.lastSuccess) {
          var last = health.lastSuccess.toDate();
          if (last < cutoff) {
            warnings.push('<strong>Uwaga:</strong> treść strony nie była pomyślnie ładowana od ponad 24h (ostatnio: ' + last.toLocaleString('pl-PL') + ').');
          }
        }
      } else {
        warnings.push('<strong>Uwaga:</strong> brak danych o ładowaniu treści strony — upewnij się, że migracja została wykonana.');
      }

      if (warnings.length > 0) {
        banner.innerHTML = warnings.join('<br>');
        banner.style.display = '';
      }
    }).catch(function() {});
  }

  // ══════════════════════════════════════════════════════════
  // ── EDITOR ──
  // ══════════════════════════════════════════════════════════
  var editorData = {};

  function loadEditorContent() {
    var db = window.PawsomeDB;
    if (!db) return;
    var container = document.getElementById('editor-container');
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:#888">Ładowanie treści...</div>';

    Promise.all([
      db.collection('siteContent').doc('hero').get(),
      db.collection('siteContent').doc('stats').get(),
      db.collection('siteContent').doc('servicesSection').get(),
      db.collection('siteContent').doc('about').get(),
      db.collection('siteContent').doc('testimonials').get(),
      db.collection('siteContent').doc('contact').get(),
      db.collection('services').orderBy('displayOrder').get(),
      db.collection('doctors').orderBy('displayOrder').get()
    ]).then(function(results) {
      editorData.hero = results[0].exists ? results[0].data() : {};
      editorData.stats = results[1].exists ? results[1].data() : { items: [] };
      editorData.servicesSection = results[2].exists ? results[2].data() : {};
      editorData.about = results[3].exists ? results[3].data() : {};
      editorData.testimonials = results[4].exists ? results[4].data() : { items: [] };
      editorData.contact = results[5].exists ? results[5].data() : {};
      editorData.services = [];
      results[6].forEach(function(doc) { editorData.services.push(Object.assign({ _id: doc.id }, doc.data())); });
      editorData.doctors = [];
      results[7].forEach(function(doc) { editorData.doctors.push(Object.assign({ _id: doc.id }, doc.data())); });
      renderEditor(container);
    }).catch(function(err) {
      container.innerHTML = '<div style="text-align:center;padding:2rem;color:#C62828">Błąd ładowania treści: ' + (err.message || err) + '</div>';
    });
  }

  function renderEditor(container) {
    var html = '';

    // ── Hero Section ──
    html += editorSection('Hero (Nagłówek strony)', function() {
      var d = editorData.hero;
      return field('Etykieta sekcji', 'hero-sectionLabel', d.sectionLabel) +
        field('Tytuł (przed)', 'hero-titleBefore', d.titleBefore) +
        field('Tytuł (wyróżnienie)', 'hero-titleEmphasis', d.titleEmphasis) +
        field('Tytuł (po)', 'hero-titleAfter', d.titleAfter) +
        fieldTA('Podtytuł', 'hero-subtitle', d.subtitle) +
        saveBtn('hero');
    });

    // ── Stats Section ──
    html += editorSection('Statystyki', function() {
      var d = editorData.stats;
      var items = d.items || [];
      var out = '<div id="stats-items-list">';
      items.forEach(function(item, i) {
        out += dynamicItem('stats', i, item.number, item.label, 'Liczba', 'Opis');
      });
      out += '</div>';
      out += addBtn('Dodaj statystykę', 'stats');
      out += saveBtn('stats');
      return out;
    });

    // ── Services Header ──
    html += editorSection('Usługi (nagłówek)', function() {
      var d = editorData.servicesSection;
      return field('Etykieta sekcji', 'svcH-sectionLabel', d.sectionLabel) +
        field('Tytuł', 'svcH-title', d.title) +
        fieldTA('Podtytuł', 'svcH-subtitle', d.subtitle) +
        saveBtn('servicesSection');
    });

    // ── Services List ──
    html += editorSection('Usługi (lista)', function() {
      var out = '<div id="services-list">';
      editorData.services.forEach(function(svc) {
        out += listItem(svc.emoji + ' ' + svc.name, svc.active ? 'Aktywna' : 'Nieaktywna', 'service', svc._id);
      });
      out += '</div>';
      out += addBtn('Dodaj usługę', 'service');
      return out;
    });

    // ── About ──
    html += editorSection('O nas', function() {
      var d = editorData.about;
      return field('Etykieta sekcji', 'about-sectionLabel', d.sectionLabel) +
        field('Tytuł', 'about-title', d.title) +
        field('Emoji', 'about-emoji', d.emoji) +
        fieldTA('Akapit 1', 'about-paragraph1', d.paragraph1) +
        fieldTA('Akapit 2', 'about-paragraph2', d.paragraph2) +
        '<label style="font-size:.85rem;font-weight:500;color:#555;margin:1rem 0 .35rem;display:block">Wartości</label>' +
        '<div id="about-values-list">' + (function() {
          var vals = d.values || [];
          var v = '';
          vals.forEach(function(val, i) {
            v += dynamicItem('about-values', i, val.title, val.text, 'Tytuł', 'Opis');
          });
          return v;
        })() + '</div>' +
        addBtn('Dodaj wartość', 'about-values') +
        saveBtn('about');
    });

    // ── Team ──
    html += editorSection('Zespół', function() {
      var out = '<div id="doctors-list">';
      editorData.doctors.forEach(function(doc) {
        out += listItem(doc.name, doc.specialty || '', 'doctor', doc._id);
      });
      out += '</div>';
      out += addBtn('Dodaj lekarza do strony', 'doctor');
      return out;
    });

    // ── Testimonials ──
    html += editorSection('Opinie', function() {
      var d = editorData.testimonials;
      var out = field('Etykieta sekcji', 'test-sectionLabel', d.sectionLabel) +
        field('Tytuł', 'test-title', d.title);
      out += '<div id="testimonials-list">';
      var items = d.items || [];
      items.forEach(function(t, i) {
        out += listItem(t.authorName, t.stars + ' gwiazdek', 'testimonial', i);
      });
      out += '</div>';
      out += addBtn('Dodaj opinię', 'testimonial');
      out += saveBtn('testimonials');
      return out;
    });

    // ── Contact ──
    html += editorSection('Kontakt', function() {
      var d = editorData.contact;
      return field('Etykieta sekcji', 'cont-sectionLabel', d.sectionLabel) +
        field('Tytuł', 'cont-title', d.title) +
        fieldTA('Podtytuł', 'cont-subtitle', d.subtitle) +
        '<div class="editor-field-row">' +
          field('Adres', 'cont-address', d.address) +
          field('Miasto', 'cont-addressCity', d.addressCity) +
        '</div>' +
        '<div class="editor-field-row">' +
          field('Telefon', 'cont-phone', d.phone) +
          field('Info telefon', 'cont-phoneNote', d.phoneNote) +
        '</div>' +
        '<div class="editor-field-row">' +
          field('Email', 'cont-email', d.email) +
          field('Info email', 'cont-emailNote', d.emailNote) +
        '</div>' +
        '<div class="editor-field-row">' +
          field('Godziny', 'cont-hours', d.hours) +
          field('Info godziny', 'cont-hoursNote', d.hoursNote) +
        '</div>' +
        field('Tytuł CTA', 'cont-ctaTitle', d.ctaTitle) +
        fieldTA('Tekst CTA', 'cont-ctaText', d.ctaText) +
        field('Przycisk CTA', 'cont-ctaButtonText', d.ctaButtonText) +
        saveBtn('contact');
    });

    container.innerHTML = html;
    wireEditorEvents(container);
  }

  // ── Editor helpers ──
  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function field(label, id, defaultVal) {
    return '<div class="editor-field"><label for="ed-' + id + '">' + esc(label) + '</label><input type="text" id="ed-' + id + '" value="' + esc(defaultVal) + '"></div>';
  }
  function fieldTA(label, id, defaultVal) {
    return '<div class="editor-field"><label for="ed-' + id + '">' + esc(label) + '</label><textarea id="ed-' + id + '">' + esc(defaultVal) + '</textarea></div>';
  }
  function editorSection(title, contentFn) {
    return '<div class="editor-section"><div class="editor-section-header" onclick="this.parentElement.classList.toggle(\'open\')">' +
      esc(title) + '<span class="toggle-icon">▼</span></div><div class="editor-section-body">' +
      contentFn() + '</div></div>';
  }
  function saveBtn(sectionId) {
    return '<button class="editor-save-btn" data-save="' + sectionId + '">Zapisz</button>' +
      '<div class="editor-success" id="msg-' + sectionId + '">Zapisano pomyślnie!</div>' +
      '<div class="editor-error" id="err-' + sectionId + '"></div>';
  }
  function addBtn(label, type) {
    return '<button class="editor-add-btn" data-add="' + type + '">+ ' + esc(label) + '</button>';
  }
  function dynamicItem(prefix, idx, val1, val2, ph1, ph2) {
    return '<div class="editor-dynamic-item" data-prefix="' + prefix + '" data-idx="' + idx + '">' +
      '<input type="text" value="' + esc(val1) + '" placeholder="' + esc(ph1) + '" data-field="a">' +
      '<input type="text" value="' + esc(val2) + '" placeholder="' + esc(ph2) + '" data-field="b">' +
      '<button class="editor-remove-item-btn" data-remove="' + prefix + '" data-idx="' + idx + '">×</button></div>';
  }
  function listItem(title, subtitle, type, id) {
    return '<div class="editor-list-item" data-type="' + type + '" data-id="' + esc(String(id)) + '">' +
      '<div class="editor-list-item-info"><strong>' + esc(title) + '</strong><small>' + esc(subtitle) + '</small></div>' +
      '<div class="editor-list-item-actions">' +
        '<button class="editor-edit-btn" data-edit-type="' + type + '" data-edit-id="' + esc(String(id)) + '">Edytuj</button>' +
        '<button class="editor-delete-btn" data-del-type="' + type + '" data-del-id="' + esc(String(id)) + '">Usuń</button>' +
      '</div></div>';
  }

  function showMsg(id, ok, text) {
    var okEl = document.getElementById('msg-' + id);
    var errEl = document.getElementById('err-' + id);
    if (ok) {
      if (okEl) { okEl.textContent = text || 'Zapisano pomyślnie!'; okEl.classList.add('visible'); }
      if (errEl) errEl.classList.remove('visible');
      setTimeout(function() { if (okEl) okEl.classList.remove('visible'); }, 3000);
    } else {
      if (errEl) { errEl.textContent = text || 'Błąd zapisu'; errEl.classList.add('visible'); }
      if (okEl) okEl.classList.remove('visible');
      setTimeout(function() { if (errEl) errEl.classList.remove('visible'); }, 5000);
    }
  }

  // ── Wire editor events ──
  function wireEditorEvents(container) {
    var db = window.PawsomeDB;

    // Save buttons
    container.querySelectorAll('[data-save]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var section = this.dataset.save;
        btn.disabled = true;
        var data = collectSectionData(section);
        db.collection('siteContent').doc(section).set(data)
          .then(function() { showMsg(section, true); btn.disabled = false; })
          .catch(function(e) { showMsg(section, false, e.message); btn.disabled = false; });
      });
    });

    // Add dynamic items
    container.querySelectorAll('[data-add]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var type = this.dataset.add;
        if (type === 'stats') { addDynamicItem('stats-items-list', 'stats', 'Liczba', 'Opis'); }
        else if (type === 'about-values') { addDynamicItem('about-values-list', 'about-values', 'Tytuł', 'Opis'); }
        else if (type === 'service') { openServiceModal(null); }
        else if (type === 'doctor') { openDoctorModal(null); }
        else if (type === 'testimonial') { openTestimonialModal(null); }
      });
    });

    // Remove dynamic items
    container.addEventListener('click', function(e) {
      if (e.target.dataset.remove) {
        e.target.closest('.editor-dynamic-item').remove();
      }
    });

    // Edit/Delete list items
    container.addEventListener('click', function(e) {
      var btn = e.target;
      if (btn.dataset.editType) {
        handleEditClick(btn.dataset.editType, btn.dataset.editId);
      }
      if (btn.dataset.delType) {
        handleDeleteClick(btn.dataset.delType, btn.dataset.delId);
      }
    });
  }

  function addDynamicItem(listId, prefix, ph1, ph2) {
    var list = document.getElementById(listId);
    if (!list) return;
    var idx = list.children.length;
    var div = document.createElement('div');
    div.className = 'editor-dynamic-item';
    div.dataset.prefix = prefix;
    div.dataset.idx = idx;
    div.innerHTML =
      '<input type="text" value="" placeholder="' + esc(ph1) + '" data-field="a">' +
      '<input type="text" value="" placeholder="' + esc(ph2) + '" data-field="b">' +
      '<button class="editor-remove-item-btn" data-remove="' + prefix + '" data-idx="' + idx + '">×</button>';
    div.querySelector('[data-remove]').addEventListener('click', function() { div.remove(); });
    list.appendChild(div);
  }

  function collectDynamicItems(listId) {
    var list = document.getElementById(listId);
    if (!list) return [];
    var items = [];
    list.querySelectorAll('.editor-dynamic-item').forEach(function(row) {
      var a = row.querySelector('[data-field="a"]').value.trim();
      var b = row.querySelector('[data-field="b"]').value.trim();
      if (a || b) items.push({ a: a, b: b });
    });
    return items;
  }

  function val(id) {
    var el = document.getElementById('ed-' + id);
    return el ? el.value : '';
  }

  function collectSectionData(section) {
    if (section === 'hero') {
      return {
        sectionLabel: val('hero-sectionLabel'),
        titleBefore: val('hero-titleBefore'),
        titleEmphasis: val('hero-titleEmphasis'),
        titleAfter: val('hero-titleAfter'),
        subtitle: val('hero-subtitle')
      };
    }
    if (section === 'stats') {
      var items = collectDynamicItems('stats-items-list');
      return { items: items.map(function(i) { return { number: i.a, label: i.b }; }) };
    }
    if (section === 'servicesSection') {
      return {
        sectionLabel: val('svcH-sectionLabel'),
        title: val('svcH-title'),
        subtitle: val('svcH-subtitle')
      };
    }
    if (section === 'about') {
      var vals = collectDynamicItems('about-values-list');
      return {
        sectionLabel: val('about-sectionLabel'),
        title: val('about-title'),
        emoji: val('about-emoji'),
        paragraph1: val('about-paragraph1'),
        paragraph2: val('about-paragraph2'),
        values: vals.map(function(v) { return { title: v.a, text: v.b }; })
      };
    }
    if (section === 'testimonials') {
      return {
        sectionLabel: val('test-sectionLabel'),
        title: val('test-title'),
        items: editorData.testimonials.items || []
      };
    }
    if (section === 'contact') {
      return {
        sectionLabel: val('cont-sectionLabel'),
        title: val('cont-title'),
        subtitle: val('cont-subtitle'),
        address: val('cont-address'),
        addressCity: val('cont-addressCity'),
        phone: val('cont-phone'),
        phoneNote: val('cont-phoneNote'),
        email: val('cont-email'),
        emailNote: val('cont-emailNote'),
        hours: val('cont-hours'),
        hoursNote: val('cont-hoursNote'),
        ctaTitle: val('cont-ctaTitle'),
        ctaText: val('cont-ctaText'),
        ctaButtonText: val('cont-ctaButtonText')
      };
    }
    return {};
  }

  // ── Edit/Delete handlers ──
  function handleEditClick(type, id) {
    if (type === 'service') {
      var svc = editorData.services.find(function(s) { return s._id === id; });
      if (svc) openServiceModal(svc);
    } else if (type === 'doctor') {
      var doc = editorData.doctors.find(function(d) { return d._id === id; });
      if (doc) openDoctorModal(doc);
    } else if (type === 'testimonial') {
      var idx = parseInt(id);
      var items = editorData.testimonials.items || [];
      if (items[idx]) openTestimonialModal(items[idx], idx);
    }
  }

  function handleDeleteClick(type, id) {
    if (!confirm('Na pewno usunąć?')) return;
    var db = window.PawsomeDB;

    if (type === 'service') {
      db.collection('services').doc(id).delete().then(function() {
        editorData.services = editorData.services.filter(function(s) { return s._id !== id; });
        refreshList('services-list', editorData.services, 'service', function(s) { return s.emoji + ' ' + s.name; }, function(s) { return s.active ? 'Aktywna' : 'Nieaktywna'; });
      });
    } else if (type === 'doctor') {
      db.collection('doctors').doc(id).delete().then(function() {
        editorData.doctors = editorData.doctors.filter(function(d) { return d._id !== id; });
        refreshList('doctors-list', editorData.doctors, 'doctor', function(d) { return d.name; }, function(d) { return d.specialty || ''; });
      });
    } else if (type === 'testimonial') {
      var idx = parseInt(id);
      editorData.testimonials.items.splice(idx, 1);
      db.collection('siteContent').doc('testimonials').set(editorData.testimonials).then(function() {
        refreshTestimonialsList();
      });
    }
  }

  function refreshList(listId, data, type, titleFn, subtitleFn) {
    var el = document.getElementById(listId);
    if (!el) return;
    var html = '';
    data.forEach(function(item) {
      html += listItem(titleFn(item), subtitleFn(item), type, item._id);
    });
    el.innerHTML = html;
  }

  function refreshTestimonialsList() {
    var el = document.getElementById('testimonials-list');
    if (!el) return;
    var html = '';
    (editorData.testimonials.items || []).forEach(function(t, i) {
      html += listItem(t.authorName, t.stars + ' gwiazdek', 'testimonial', i);
    });
    el.innerHTML = html;
  }

  // ══════════════════════════════════════════════════════════
  // ── MODALS ──
  // ══════════════════════════════════════════════════════════

  function createModalOverlay() {
    var overlay = document.createElement('div');
    overlay.className = 'editor-modal-overlay';
    var modal = document.createElement('div');
    modal.className = 'editor-modal';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    requestAnimationFrame(function() { overlay.classList.add('visible'); });

    function close() {
      overlay.classList.remove('visible');
      overlay.addEventListener('transitionend', function() {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, { once: true });
    }
    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });

    return { overlay: overlay, modal: modal, close: close };
  }

  // ── Service Modal ──
  function openServiceModal(svc) {
    var isNew = !svc;
    var s = svc || {
      slug: '', name: '', emoji: '', duration: 30, displayOrder: editorData.services.length + 1, active: true,
      shortDescription: '', iconColorClass: 'si-1',
      heroGradient: '', heroTagline: '',
      whyTitle: '', whyParagraphs: [''],
      processTitle: '', processSteps: [{ bold: '', text: '' }],
      benefitsTitle: '', benefits: [{ emoji: '', title: '', text: '' }],
      ctaTitle: '', ctaText: ''
    };

    var m = createModalOverlay();
    var html = '<button class="editor-modal-close">&times;</button>';
    html += '<h3>' + (isNew ? 'Nowa usługa' : 'Edytuj usługę') + '</h3>';

    html += '<div class="editor-field-row">' +
      field('Slug (URL)', 'svc-slug', s.slug) +
      field('Nazwa', 'svc-name', s.name) +
    '</div>';
    html += '<div class="editor-field-row">' +
      field('Emoji', 'svc-emoji', s.emoji) +
      '<div class="editor-field"><label for="ed-svc-duration">Czas trwania wizyty (minuty)</label><input type="number" id="ed-svc-duration" value="' + (s.duration || 30) + '" min="5" step="5" required></div>' +
    '</div>';
    html += '<div class="editor-field-row">' +
      '<div class="editor-field"><label for="ed-svc-displayOrder">Kolejność</label><input type="number" id="ed-svc-displayOrder" value="' + (s.displayOrder || 1) + '" min="1"></div>' +
      field('Klasa koloru (si-1..si-6)', 'svc-iconColorClass', s.iconColorClass) +
    '</div>';
    html += '<div class="editor-field-checkbox"><input type="checkbox" id="ed-svc-active"' + (s.active ? ' checked' : '') + '><label for="ed-svc-active">Aktywna</label></div>';

    html += fieldTA('Krótki opis (karta na stronie)', 'svc-shortDescription', s.shortDescription);
    html += field('Gradient hero', 'svc-heroGradient', s.heroGradient);
    html += fieldTA('Tagline hero', 'svc-heroTagline', s.heroTagline);

    // Why section
    html += '<fieldset class="editor-fieldset"><legend>Sekcja "Dlaczego"</legend>';
    html += field('Tytuł', 'svc-whyTitle', s.whyTitle);
    html += '<div id="svc-why-paras">';
    (s.whyParagraphs || []).forEach(function(p, i) {
      html += '<div class="editor-field" style="display:flex;gap:.5rem;align-items:start"><textarea style="flex:1" data-svc-why-para>' + esc(p) + '</textarea><button class="editor-remove-item-btn" onclick="this.parentElement.remove()">×</button></div>';
    });
    html += '</div>';
    html += '<button class="editor-add-btn" id="svc-add-why-para">+ Dodaj akapit</button>';
    html += '</fieldset>';

    // Process steps
    html += '<fieldset class="editor-fieldset"><legend>Przebieg</legend>';
    html += field('Tytuł sekcji', 'svc-processTitle', s.processTitle);
    html += '<div id="svc-process-steps">';
    (s.processSteps || []).forEach(function(step) {
      html += '<div class="editor-dynamic-item" style="grid-template-columns:1fr 2fr auto">' +
        '<input type="text" value="' + esc(step.bold) + '" placeholder="Nagłówek" data-field="a">' +
        '<input type="text" value="' + esc(step.text) + '" placeholder="Opis" data-field="b">' +
        '<button class="editor-remove-item-btn" onclick="this.parentElement.remove()">×</button></div>';
    });
    html += '</div>';
    html += '<button class="editor-add-btn" id="svc-add-step">+ Dodaj krok</button>';
    html += '</fieldset>';

    // Benefits
    html += '<fieldset class="editor-fieldset"><legend>Korzyści</legend>';
    html += field('Tytuł sekcji', 'svc-benefitsTitle', s.benefitsTitle);
    html += '<div id="svc-benefits">';
    (s.benefits || []).forEach(function(b) {
      html += '<div class="editor-dynamic-item" style="grid-template-columns:auto 1fr 2fr auto">' +
        '<input type="text" value="' + esc(b.emoji) + '" placeholder="Emoji" style="width:50px" data-field="emoji">' +
        '<input type="text" value="' + esc(b.title) + '" placeholder="Tytuł" data-field="a">' +
        '<input type="text" value="' + esc(b.text) + '" placeholder="Opis" data-field="b">' +
        '<button class="editor-remove-item-btn" onclick="this.parentElement.remove()">×</button></div>';
    });
    html += '</div>';
    html += '<button class="editor-add-btn" id="svc-add-benefit">+ Dodaj korzyść</button>';
    html += '</fieldset>';

    // CTA
    html += '<fieldset class="editor-fieldset"><legend>CTA</legend>';
    html += field('Tytuł CTA', 'svc-ctaTitle', s.ctaTitle);
    html += fieldTA('Tekst CTA', 'svc-ctaText', s.ctaText);
    html += '</fieldset>';

    html += '<div class="editor-modal-actions">' +
      '<button class="editor-save-btn" id="svc-modal-save">' + (isNew ? 'Dodaj usługę' : 'Zapisz zmiany') + '</button></div>';

    m.modal.innerHTML = html;
    m.modal.querySelector('.editor-modal-close').addEventListener('click', m.close);

    // Wire add para/step/benefit buttons
    m.modal.querySelector('#svc-add-why-para').addEventListener('click', function() {
      var list = m.modal.querySelector('#svc-why-paras');
      var div = document.createElement('div');
      div.className = 'editor-field';
      div.style.cssText = 'display:flex;gap:.5rem;align-items:start';
      div.innerHTML = '<textarea style="flex:1" data-svc-why-para></textarea><button class="editor-remove-item-btn" onclick="this.parentElement.remove()">×</button>';
      list.appendChild(div);
    });
    m.modal.querySelector('#svc-add-step').addEventListener('click', function() {
      var list = m.modal.querySelector('#svc-process-steps');
      var div = document.createElement('div');
      div.className = 'editor-dynamic-item';
      div.style.gridTemplateColumns = '1fr 2fr auto';
      div.innerHTML = '<input type="text" placeholder="Nagłówek" data-field="a"><input type="text" placeholder="Opis" data-field="b"><button class="editor-remove-item-btn" onclick="this.parentElement.remove()">×</button>';
      list.appendChild(div);
    });
    m.modal.querySelector('#svc-add-benefit').addEventListener('click', function() {
      var list = m.modal.querySelector('#svc-benefits');
      var div = document.createElement('div');
      div.className = 'editor-dynamic-item';
      div.style.gridTemplateColumns = 'auto 1fr 2fr auto';
      div.innerHTML = '<input type="text" placeholder="Emoji" style="width:50px" data-field="emoji"><input type="text" placeholder="Tytuł" data-field="a"><input type="text" placeholder="Opis" data-field="b"><button class="editor-remove-item-btn" onclick="this.parentElement.remove()">×</button>';
      list.appendChild(div);
    });

    // Save
    m.modal.querySelector('#svc-modal-save').addEventListener('click', function() {
      var db = window.PawsomeDB;
      var slug = val('svc-slug').trim();
      if (!slug) { alert('Slug jest wymagany'); return; }
      var dur = parseInt(document.getElementById('ed-svc-duration').value) || 30;
      if (dur < 5) { alert('Czas trwania musi wynosić co najmniej 5 minut'); return; }

      var whyParas = [];
      m.modal.querySelectorAll('[data-svc-why-para]').forEach(function(ta) {
        if (ta.value.trim()) whyParas.push(ta.value.trim());
      });
      var steps = [];
      m.modal.querySelectorAll('#svc-process-steps .editor-dynamic-item').forEach(function(row) {
        var a = row.querySelector('[data-field="a"]').value.trim();
        var b = row.querySelector('[data-field="b"]').value.trim();
        if (a || b) steps.push({ bold: a, text: b });
      });
      var benefits = [];
      m.modal.querySelectorAll('#svc-benefits .editor-dynamic-item').forEach(function(row) {
        var emoji = row.querySelector('[data-field="emoji"]').value.trim();
        var a = row.querySelector('[data-field="a"]').value.trim();
        var b = row.querySelector('[data-field="b"]').value.trim();
        if (a || b) benefits.push({ emoji: emoji, title: a, text: b });
      });

      var data = {
        slug: slug,
        name: val('svc-name'),
        emoji: val('svc-emoji'),
        duration: dur,
        displayOrder: parseInt(document.getElementById('ed-svc-displayOrder').value) || 1,
        active: document.getElementById('ed-svc-active').checked,
        shortDescription: val('svc-shortDescription'),
        iconColorClass: val('svc-iconColorClass'),
        heroGradient: val('svc-heroGradient'),
        heroTagline: val('svc-heroTagline'),
        whyTitle: val('svc-whyTitle'),
        whyParagraphs: whyParas,
        processTitle: val('svc-processTitle'),
        processSteps: steps,
        benefitsTitle: val('svc-benefitsTitle'),
        benefits: benefits,
        ctaTitle: val('svc-ctaTitle'),
        ctaText: val('svc-ctaText')
      };

      this.disabled = true;
      var self = this;
      db.collection('services').doc(slug).set(data).then(function() {
        data._id = slug;
        if (isNew) {
          editorData.services.push(data);
        } else {
          var idx = editorData.services.findIndex(function(x) { return x._id === s._id; });
          if (idx !== -1) editorData.services[idx] = data;
          // If slug changed, delete old doc
          if (s._id && s._id !== slug) {
            db.collection('services').doc(s._id).delete();
          }
        }
        editorData.services.sort(function(a, b) { return (a.displayOrder || 0) - (b.displayOrder || 0); });
        refreshList('services-list', editorData.services, 'service', function(x) { return x.emoji + ' ' + x.name; }, function(x) { return x.active ? 'Aktywna' : 'Nieaktywna'; });
        m.close();
      }).catch(function(e) {
        alert('Błąd: ' + e.message);
        self.disabled = false;
      });
    });
  }

  // ── Create Firebase Auth account + assign doctor role ──
  function createDoctorAuthAccount(email) {
    return new Promise(function(resolve, reject) {
      var secondaryApp = firebase.initializeApp(firebase.app().options, 'secondary');
      var secondaryAuth = secondaryApp.auth();
      var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
      var tempPassword = '';
      for (var i = 0; i < 24; i++) tempPassword += chars.charAt(Math.floor(Math.random() * chars.length));

      secondaryAuth.createUserWithEmailAndPassword(email, tempPassword)
        .then(function(cred) {
          var uid = cred.user.uid;
          return secondaryAuth.signOut().then(function() {
            return secondaryApp.delete();
          }).then(function() {
            // Assign doctor role in Firestore
            return window.PawsomeDB.collection('roles').doc(uid).set({ role: 'doctor' });
          }).then(function() {
            resolve(uid);
          });
        })
        .catch(function(err) {
          secondaryApp.delete().catch(function() {});
          reject(err);
        });
    });
  }

  // ── Doctor Modal ──
  function openDoctorModal(doc) {
    var isNew = !doc;
    var d = doc || {
      _id: null, name: '', specialty: '', bio: '', photoURL: '',
      displayOrder: editorData.doctors.length + 1, showOnWebsite: true,
      email: '', canEditWebsite: false
    };
    // Backward compat: existing doctors without canEditWebsite field get true
    var docCanEdit = (!isNew && d.canEditWebsite === undefined) ? true : !!d.canEditWebsite;

    var m = createModalOverlay();
    var html = '<button class="editor-modal-close">&times;</button>';
    html += '<h3>' + (isNew ? 'Dodaj lekarza do strony' : 'Edytuj lekarza') + '</h3>';

    // Photo preview
    if (d.photoURL) {
      html += '<img src="' + esc(d.photoURL) + '" class="editor-photo-preview" id="doctor-photo-preview">';
    } else {
      html += '<div class="editor-photo-placeholder" id="doctor-photo-preview">👩‍⚕️</div>';
    }
    html += '<div class="editor-field"><label>Zdjęcie</label><input type="file" id="doctor-photo-input" accept="image/*"></div>';

    // Email field
    html += '<div class="editor-field"><label for="ed-doc-email">Email (login)</label>' +
      '<input type="email" id="ed-doc-email" value="' + esc(d.email || '') + '"' +
      (!isNew && d.email ? ' readonly style="opacity:0.6;cursor:not-allowed"' : '') +
      ' placeholder="np. jan@klinika.pl"></div>';

    html += field('Imię i tytuł', 'doc-name', d.name);
    html += field('Specjalizacja', 'doc-specialty', d.specialty);
    html += fieldTA('Bio', 'doc-bio', d.bio);
    html += '<div class="editor-field-row">' +
      '<div class="editor-field"><label for="ed-doc-displayOrder">Kolejność</label><input type="number" id="ed-doc-displayOrder" value="' + (d.displayOrder || 1) + '" min="1"></div>' +
      '<div></div>' +
    '</div>';
    html += '<div class="editor-field-checkbox"><input type="checkbox" id="ed-doc-showOnWebsite"' + (d.showOnWebsite !== false ? ' checked' : '') + '><label for="ed-doc-showOnWebsite">Pokaż na stronie</label></div>';
    html += '<div class="editor-field-checkbox"><input type="checkbox" id="ed-doc-canEditWebsite"' + (docCanEdit ? ' checked' : '') + '><label for="ed-doc-canEditWebsite">Może edytować stronę</label></div>';

    html += '<div class="editor-modal-actions">' +
      '<button class="editor-save-btn" id="doc-modal-save">' + (isNew ? 'Dodaj lekarza' : 'Zapisz zmiany') + '</button></div>';

    m.modal.innerHTML = html;
    m.modal.querySelector('.editor-modal-close').addEventListener('click', m.close);

    // Photo preview on file select
    var photoInput = m.modal.querySelector('#doctor-photo-input');
    photoInput.addEventListener('change', function() {
      if (this.files && this.files[0]) {
        var reader = new FileReader();
        reader.onload = function(e) {
          var preview = m.modal.querySelector('#doctor-photo-preview');
          if (preview.tagName === 'IMG') {
            preview.src = e.target.result;
          } else {
            var img = document.createElement('img');
            img.src = e.target.result;
            img.className = 'editor-photo-preview';
            img.id = 'doctor-photo-preview';
            preview.parentNode.replaceChild(img, preview);
          }
        };
        reader.readAsDataURL(this.files[0]);
      }
    });

    // Save
    m.modal.querySelector('#doc-modal-save').addEventListener('click', function() {
      var db = window.PawsomeDB;
      var storage = window.PawsomeStorage;
      var name = val('doc-name').trim();
      if (!name) { alert('Imię jest wymagane'); return; }

      this.disabled = true;
      var self = this;
      var email = document.getElementById('ed-doc-email').value.trim();
      var photoFile = photoInput.files && photoInput.files[0];

      function saveDoc(docId, photoURL) {
        var data = {
          name: val('doc-name'),
          specialty: val('doc-specialty'),
          bio: val('doc-bio'),
          photoURL: photoURL || d.photoURL || '',
          displayOrder: parseInt(document.getElementById('ed-doc-displayOrder').value) || 1,
          showOnWebsite: document.getElementById('ed-doc-showOnWebsite').checked,
          email: email || d.email || '',
          canEditWebsite: document.getElementById('ed-doc-canEditWebsite').checked
        };

        var editWebsite = document.getElementById('ed-doc-canEditWebsite').checked;
        db.collection('doctors').doc(docId).set(data, { merge: true }).then(function() {
          // Update canEditWebsite in roles doc
          return db.collection('roles').doc(docId).set({ canEditWebsite: editWebsite }, { merge: true });
        }).then(function() {
          data._id = docId;
          if (isNew) {
            editorData.doctors.push(data);
          } else {
            var idx = editorData.doctors.findIndex(function(x) { return x._id === d._id; });
            if (idx !== -1) editorData.doctors[idx] = data;
          }
          editorData.doctors.sort(function(a, b) { return (a.displayOrder || 0) - (b.displayOrder || 0); });
          refreshList('doctors-list', editorData.doctors, 'doctor', function(x) { return x.name; }, function(x) { return x.specialty || ''; });
          m.close();
        }).catch(function(e) {
          alert('Błąd: ' + e.message);
          self.disabled = false;
        });
      }

      function uploadAndSave(docId) {
        if (photoFile && storage) {
          var ref = storage.ref('doctors/' + docId + '.jpg');
          ref.put(photoFile).then(function(snapshot) {
            return snapshot.ref.getDownloadURL();
          }).then(function(url) {
            saveDoc(docId, url);
          }).catch(function(e) {
            alert('Błąd uploadu zdjęcia: ' + e.message);
            self.disabled = false;
          });
        } else {
          saveDoc(docId, null);
        }
      }

      if (isNew && email) {
        // New doctor with email → create Firebase Auth account
        createDoctorAuthAccount(email).then(function(uid) {
          uploadAndSave(uid);
        }).catch(function(err) {
          if (err.code === 'auth/email-already-in-use') {
            alert('To konto email już istnieje w systemie');
          } else if (err.code === 'auth/invalid-email') {
            alert('Nieprawidłowy format adresu email');
          } else {
            alert('Błąd tworzenia konta: ' + err.message);
          }
          self.disabled = false;
        });
      } else {
        // Existing doctor or new doctor without email
        var docId = d._id || db.collection('doctors').doc().id;
        uploadAndSave(docId);
      }
    });
  }

  // ── Testimonial Modal ──
  function openTestimonialModal(t, editIdx) {
    var isNew = (editIdx === undefined || editIdx === null);
    var d = t || { stars: 5, quote: '', authorName: '', authorPet: '', authorEmoji: '🐶' };

    var m = createModalOverlay();
    var html = '<button class="editor-modal-close">&times;</button>';
    html += '<h3>' + (isNew ? 'Nowa opinia' : 'Edytuj opinię') + '</h3>';

    html += '<div class="editor-field"><label for="ed-test-stars">Gwiazdki</label><select id="ed-test-stars">';
    for (var i = 1; i <= 5; i++) {
      html += '<option value="' + i + '"' + (d.stars === i ? ' selected' : '') + '>' + i + '</option>';
    }
    html += '</select></div>';
    html += fieldTA('Treść opinii', 'test-quote', d.quote);
    html += '<div class="editor-field-row">' +
      field('Autor', 'test-authorName', d.authorName) +
      field('Pupil', 'test-authorPet', d.authorPet) +
    '</div>';
    html += field('Emoji autora', 'test-authorEmoji', d.authorEmoji);

    html += '<div class="editor-modal-actions">' +
      '<button class="editor-save-btn" id="test-modal-save">' + (isNew ? 'Dodaj opinię' : 'Zapisz zmiany') + '</button></div>';

    m.modal.innerHTML = html;
    m.modal.querySelector('.editor-modal-close').addEventListener('click', m.close);

    m.modal.querySelector('#test-modal-save').addEventListener('click', function() {
      var db = window.PawsomeDB;
      var data = {
        stars: parseInt(document.getElementById('ed-test-stars').value) || 5,
        quote: val('test-quote'),
        authorName: val('test-authorName'),
        authorPet: val('test-authorPet'),
        authorEmoji: val('test-authorEmoji')
      };

      if (!editorData.testimonials.items) editorData.testimonials.items = [];
      if (isNew) {
        editorData.testimonials.items.push(data);
      } else {
        editorData.testimonials.items[editIdx] = data;
      }

      this.disabled = true;
      var self = this;
      db.collection('siteContent').doc('testimonials').set(editorData.testimonials)
        .then(function() {
          refreshTestimonialsList();
          m.close();
        }).catch(function(e) {
          alert('Błąd: ' + e.message);
          self.disabled = false;
        });
    });
  }

  // ── INIT ──
  initAuth();
})();
