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
  var isAdmin = false;           // only admins may write `doctors` and `roles`
  var acceptedById = {};   // id → booking, for the click-to-edit modal
  var doctorScheduleCache = {};  // doctorId → schedule doc data
  var allDoctors = [];           // [{id, name, specialty}] sorted by name

  // Clinic opening hours per JS day-of-week — the default vertical range of the
  // day timeline (stretched when a visit falls outside it)
  var CLINIC_HOURS = {
    1: { open: '08:00', close: '20:00' },
    2: { open: '08:00', close: '20:00' },
    3: { open: '08:00', close: '20:00' },
    4: { open: '08:00', close: '20:00' },
    5: { open: '08:00', close: '20:00' },
    6: { open: '08:00', close: '20:00' },
    0: { open: '09:00', close: '17:00' }
  };

  var servicesBySlug = {};
  window.PawsomeServices.forEach(function(s) { servicesBySlug[s.slug] = s; });

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
          isAdmin = role === 'admin';
          resetDoctorsView();
          loginView.style.display = 'none';
          dashboard.classList.add('visible');
          // Reload on every sign-in — a different user may log in without a page reload
          loadDoctorInfo(user.uid, function() {
            if (!dashboardInitialized) {
              initDashboard();
              dashboardInitialized = true;
            } else {
              loadBookings();
            }
          });
        }).catch(function() {
          auth.signOut();
          loginError.textContent = 'Błąd weryfikacji uprawnień. Spróbuj ponownie.';
          loginError.classList.add('visible');
        });
      } else {
        currentUser = null;
        doctorName = '';
        isAdmin = false;
        loginView.style.display = '';
        dashboard.classList.remove('visible');
        if (unsubscribePending) { unsubscribePending(); unsubscribePending = null; }
        if (unsubscribeDate) { unsubscribeDate(); unsubscribeDate = null; }
      }
    });
  }

  // ── LOAD DOCTOR INFO ──
  function loadDoctorInfo(uid, callback) {
    function done() {
      var labelEl = document.getElementById('doctor-label');
      if (labelEl) labelEl.textContent = 'Zalogowany jako: ' + doctorName;
      callback();
    }
    window.PawsomeDB.collection('doctors').doc(uid).get().then(function(doc) {
      doctorName = (doc.exists && doc.data().name) || 'Lekarz';
      done();
    }).catch(function() {
      doctorName = 'Lekarz';
      done();
    });
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

    loadAllDoctors().catch(function() {});
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

    // Build acceptedById for the click-to-edit handlers (always date-specific)
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

    var date = new Date(dateStr + 'T00:00:00');
    var dayOfWeek = date.getDay();
    var h = CLINIC_HOURS[dayOfWeek];
    if (!h) { timelineEl.innerHTML = ''; return; }

    var openMin = timeToMins(h.open);
    var closeMin = timeToMins(h.close);
    // Doctors' own schedules may start earlier / end later than the clinic —
    // stretch the range (to full hours) so every accepted visit is drawn
    acceptedBookings.forEach(function(b) {
      var bStart = timeToMins(b.time);
      if (!b.time || isNaN(bStart)) return;
      var bEnd = bStart + (b.duration || getServiceDuration(b.service) || 20);
      openMin = Math.min(openMin, Math.floor(bStart / 60) * 60);
      closeMin = Math.max(closeMin, Math.ceil(bEnd / 60) * 60);
    });
    closeMin = Math.min(closeMin, 24 * 60);
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
      if (isNaN(startMin) || startMin < openMin || startMin >= closeMin) return '';
      var apptDur = b.duration || getServiceDuration(b.service) || 20;
      var endMin = Math.min(startMin + apptDur, closeMin);
      var topPx = Math.round((startMin - openMin) * PX_PER_MIN);
      var heightPx = Math.round((endMin - startMin) * PX_PER_MIN);
      var endTimeStr = minsToTime(endMin);
      var cls = isSingle ? 'sch-color-mine' : ('sch-color-' + (colorIdx % 6));

      var inner = '<div class="sch-appt-time">' + escapeHtml(b.time) + ' – ' + escapeHtml(endTimeStr) + '</div>' +
        '<div class="sch-appt-patient">' + escapeHtml(b.patientName) + ' · ' + escapeHtml(b.petName) + '</div>' +
        '<div class="sch-appt-service">' + escapeHtml(getServiceName(b.service)) + ' · ' + apptDur + ' min</div>' +
        (b.comment ? '<div class="sch-appt-comment">' + escapeHtml(b.comment) + '</div>' : '');

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
      // Mouse drag-to-scroll for desktop
      (function() {
        var s = timelineEl.querySelector('.sched-scroll');
        if (!s) return;
        var isDown = false, startX, scrollLeft;
        s.addEventListener('mousedown', function(e) {
          if (e.button !== 0) return;
          isDown = true;
          startX = e.pageX - s.offsetLeft;
          scrollLeft = s.scrollLeft;
          s.style.cursor = 'grabbing';
          s.style.userSelect = 'none';
        });
        s.addEventListener('mouseleave', function() {
          isDown = false;
          s.style.cursor = 'grab';
          s.style.userSelect = '';
        });
        s.addEventListener('mouseup', function() {
          isDown = false;
          s.style.cursor = 'grab';
          s.style.userSelect = '';
        });
        s.addEventListener('mousemove', function(e) {
          if (!isDown) return;
          e.preventDefault();
          var x = e.pageX - s.offsetLeft;
          s.scrollLeft = scrollLeft - (x - startX);
        });
      })();
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
  // Slot cells — the same contract as booking.js: the day is a 10-minute grid
  // and a pending/accepted visit holds one `slots` doc per grid cell that
  // overlaps [start, start + duration), with the id doctorId_date_HH:MM.
  var SLOT_CELL_MIN = 10;
  var SLOT_CELL_ID_RE = /_\d{4}-\d{2}-\d{2}_\d{2}:\d{2}$/;
  var SLOT_TAKEN_MSG = 'Ten termin jest już zajęty przez inną rezerwację (potwierdzoną lub oczekującą).';

  // Start times ('HH:MM') of the grid cells a visit occupies. Floor/ceil
  // because staff can set off-grid times such as 09:35.
  function visitCellTimes(time, duration) {
    var start = timeToMins(time);
    var from = Math.floor(start / SLOT_CELL_MIN) * SLOT_CELL_MIN;
    var to = Math.ceil((start + duration) / SLOT_CELL_MIN) * SLOT_CELL_MIN;
    var times = [];
    for (var m = from; m < to; m += SLOT_CELL_MIN) times.push(minsToTime(m));
    return times;
  }

  function slotCellId(doctorId, date, cellTime) {
    return doctorId + '_' + date + '_' + cellTime;
  }

  function saveErrorMessage(err) {
    return err && err.code === 'slot-taken' ? SLOT_TAKEN_MSG : 'Błąd zapisu — spróbuj ponownie.';
  }

  // Applies `changes` (any of status / date / time / duration) to a visit and
  // moves its slot cells in one transaction. Rejects with code 'slot-taken'
  // when a cell the visit needs is held by another (pending or accepted) visit.
  function changeVisit(id, changes) {
    var db = window.PawsomeDB;
    var apptRef = db.collection('appointments').doc(id);
    var slots = db.collection('slots');

    return db.runTransaction(function(transaction) {
      // Read the visit inside the transaction: the modal's copy may be stale
      // if another staff member has just moved or rejected it.
      return transaction.get(apptRef).then(function(apptDoc) {
        if (!apptDoc.exists) throw new Error('appointment-missing');
        var b = apptDoc.data();

        // Legacy bookings hold ONE slot doc with a random id for the whole
        // visit. `slotId` cannot be updated (rules), so a cell-shaped one goes
        // stale after a move and may now be another visit's cell — never
        // touch it; the visit's cells are always computed instead.
        var legacyId = b.slotId || id;
        var legacyRef = SLOT_CELL_ID_RE.test(legacyId) ? null : slots.doc(legacyId);

        return (legacyRef ? transaction.get(legacyRef) : Promise.resolve(null)).then(function(legacyDoc) {
          // While its legacy doc exists the visit owns no cells yet
          var hasLegacySlot = !!(legacyDoc && legacyDoc.exists);
          var doctorId = b.doctorId || '';
          var curDur = b.duration || getServiceDuration(b.service) || 20;
          var newStatus = changes.status || b.status;
          var newDate = changes.date || b.date;
          var newTime = changes.time || b.time;
          var newDur = changes.duration || curDur;

          // Cells the visit may hold: computed from its stored time and
          // duration, then confirmed by their owner field, so a visit whose
          // stored range covers other visits' cells never releases them.
          var curIds = (b.status === 'rejected' || hasLegacySlot) ? [] :
            visitCellTimes(b.time, curDur).map(function(t) { return slotCellId(doctorId, b.date, t); });
          var newTimes = newStatus === 'rejected' ? [] : visitCellTimes(newTime, newDur);
          var newIds = newTimes.map(function(t) { return slotCellId(doctorId, newDate, t); });
          var toRead = curIds.concat(newIds.filter(function(cellId) { return curIds.indexOf(cellId) === -1; }));

          return Promise.all(toRead.map(function(cellId) {
            return transaction.get(slots.doc(cellId));
          })).then(function(cellDocs) {
            var owned = {};
            cellDocs.forEach(function(cellDoc) {
              if (!cellDoc.exists) return;
              if (cellDoc.data().appointmentId === id) {
                owned[cellDoc.id] = true;
              } else if (newIds.indexOf(cellDoc.id) !== -1) {
                var taken = new Error('slot-taken');
                taken.code = 'slot-taken';
                throw taken;
              }
            });

            // All reads done — release, claim, update
            Object.keys(owned).forEach(function(cellId) {
              if (newIds.indexOf(cellId) === -1) transaction.delete(slots.doc(cellId));
            });
            if (hasLegacySlot) transaction.delete(legacyRef);
            newIds.forEach(function(cellId, idx) {
              if (owned[cellId]) return;
              transaction.set(slots.doc(cellId), {
                date: newDate,
                time: newTimes[idx],
                doctorId: doctorId,
                duration: SLOT_CELL_MIN,
                appointmentId: id
              });
            });
            transaction.update(apptRef, changes);
          });
        });
      });
    });
  }

  function confirmAccept(id, duration) {
    return changeVisit(id, { status: 'accepted', duration: duration });
  }

  function rejectBooking(id) {
    return changeVisit(id, { status: 'rejected' });
  }

  // A rejected visit holds no cells, so this claims them all again
  function restoreBooking(id, duration) {
    return changeVisit(id, { status: 'accepted', duration: duration });
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
      var btn = this;
      var durVal = parseInt(modal.querySelector('.pending-dur-input').value) || dur;
      var errorEl = modal.querySelector('.rejected-modal-error');
      function fail(msg) {
        errorEl.textContent = msg;
        errorEl.style.display = '';
        btn.disabled = false;
      }
      var schedErr = validateAgainstDoctorSchedule(booking.time, durVal, booking.date, booking.doctorId);
      if (schedErr) { fail(schedErr); return; }
      errorEl.style.display = 'none';
      btn.disabled = true;
      var newStart = timeToMins(booking.time);
      findConflict(booking.doctorId, booking.date, newStart, newStart + durVal, booking.id)
        .then(function(conflictTime) {
          if (conflictTime) {
            fail('Czas wizyty koliduje z wizytą o godz. ' + conflictTime + '. Skróć czas trwania.');
            return;
          }
          return restoreBooking(booking.id, durVal).then(closeRejectedModal);
        })
        .catch(function(err) { fail(saveErrorMessage(err)); });
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

    var pendingErrorEl = modal.querySelector('.pending-modal-error');

    modal.querySelector('.pending-btn-accept').addEventListener('click', function() {
      var btn = this;
      var durVal = parseInt(modal.querySelector('.pending-dur-input').value) || dur;
      function fail(msg) {
        pendingErrorEl.textContent = msg;
        pendingErrorEl.style.display = '';
        btn.disabled = false;
      }
      var schedErr = validateAgainstDoctorSchedule(booking.time, durVal, booking.date, booking.doctorId);
      if (schedErr) { fail(schedErr); return; }
      pendingErrorEl.style.display = 'none';
      btn.disabled = true;
      var newStart = timeToMins(booking.time);
      findConflict(booking.doctorId, booking.date, newStart, newStart + durVal, booking.id)
        .then(function(conflictTime) {
          if (conflictTime) {
            fail('Czas wizyty koliduje z wizytą o godz. ' + conflictTime + '. Skróć czas trwania.');
            return;
          }
          return confirmAccept(booking.id, durVal).then(closePendingModal);
        })
        .catch(function(err) { fail(saveErrorMessage(err)); });
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
      var btn = this;
      btn.disabled = true;
      rejectBooking(booking.id).then(closePendingModal).catch(function(err) {
        pendingErrorEl.textContent = saveErrorMessage(err);
        pendingErrorEl.style.display = '';
        btn.disabled = false;
      });
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

    var serviceKeys = window.PawsomeServices.map(function(s) { return s.slug; });
    // Keep the visit's current service selectable even if it has since been removed
    if (booking.service && serviceKeys.indexOf(booking.service) === -1) serviceKeys.push(booking.service);
    var serviceOptions = serviceKeys.map(function(key) {
      return '<option value="' + escapeAttr(key) + '"' + (booking.service === key ? ' selected' : '') + '>' + escapeHtml(getServiceName(key)) + '</option>';
    }).join('');

    overlay.innerHTML =
      '<div class="appt-modal">' +
        '<div class="appt-modal-header">' +
          '<h3 class="appt-modal-title">' + escapeHtml(booking.patientName) + ' — ' + escapeHtml(booking.petName) + '</h3>' +
          '<button class="appt-modal-close">&times;</button>' +
        '</div>' +
        '<div class="appt-modal-body">' +
          '<p class="appt-modal-meta">' + escapeHtml(getServiceName(booking.service)) + ' &bull; ' + escapeHtml(booking.time) + ' \u2013 ' + escapeHtml(endTime) + ' &bull; ' + dur + ' min' + (booking.comment ? '<br><span class="pending-comment">\uD83D\uDCAC ' + escapeHtml(booking.comment) + '</span>' : '') + '</p>' +
          '<div class="appt-form-error appt-modal-error" style="display:none"></div>' +
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

    // Shown above whichever panel is open (actions, reject confirm, either form)
    var modalErrorEl = modal.querySelector('.appt-modal-error');
    function showError(msg) {
      modalErrorEl.textContent = msg;
      modalErrorEl.style.display = '';
    }

    function showActions() {
      modalErrorEl.style.display = 'none';
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
      var btn = this;
      btn.disabled = true;
      rejectBooking(booking.id).then(closeApptModal).catch(function(err) {
        showError(saveErrorMessage(err));
        btn.disabled = false;
      });
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
      var schedErr = validateAgainstDoctorSchedule(newTime, newDur, newDate, booking.doctorId);
      if (schedErr) { errorEl.textContent = schedErr; errorEl.style.display = ''; return; }
      errorEl.style.display = 'none';
      var saveBtn = form.querySelector('.appt-btn-save');
      saveBtn.disabled = true;
      function fail(msg) {
        errorEl.textContent = msg;
        errorEl.style.display = '';
        saveBtn.disabled = false;
      }
      var newStart = timeToMins(newTime);
      findConflict(booking.doctorId, newDate, newStart, newStart + newDur, booking.id)
        .then(function(conflictTime) {
          if (conflictTime) {
            fail('Czas wizyty koliduje z wizytą o godz. ' + conflictTime + '. Zmień godzinę lub skróć czas trwania.');
            return;
          }
          return amendAppt(booking.id, {
            date: newDate,
            time: newTime,
            duration: newDur
          }, true);
        })
        .catch(function(err) { fail(saveErrorMessage(err)); });
    });

    modal.querySelector('.appt-entry-form').addEventListener('submit', function(e) {
      e.preventDefault();
      var form = this;
      var saveBtn = form.querySelector('.appt-btn-save');
      saveBtn.disabled = true;
      amendAppt(booking.id, {
        patientName: form.elements.patientName.value.trim(),
        petName: form.elements.petName.value.trim(),
        phone: form.elements.phone.value.trim(),
        email: form.elements.email.value.trim(),
        service: form.elements.service.value,
        comment: form.elements.comment.value.trim()
      }).catch(function() {
        showError('Błąd zapisu — spróbuj ponownie.');
        saveBtn.disabled = false;
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

  // Resolves once saved (and closes the modal); rejects on failure so the
  // caller can show the error next to the form that triggered it.
  // `movesSlots`: the fields change date/time/duration, so the visit's slot
  // cells must move with it; patient-data edits touch no slots.
  function amendAppt(id, fields, movesSlots) {
    var saved = movesSlots
      ? changeVisit(id, fields)
      : window.PawsomeDB.collection('appointments').doc(id).update(fields);
    return saved.then(closeApptModal);
  }

  // ── HELPERS ──
  function getServiceDuration(service) {
    var s = servicesBySlug[service];
    return (s && s.duration) || 10;
  }

  function getServiceName(slug) {
    var s = servicesBySlug[slug];
    return (s && s.name) || slug || '';
  }

  // Start time of an accepted visit of the same doctor overlapping
  // [startMin, endMin) on `date`, or null. Asks Firestore rather than the
  // in-memory list, which only holds the date selected in the date picker
  // (and, in "mine" view, only the signed-in doctor's visits).
  function findConflict(doctorId, date, startMin, endMin, excludeId) {
    return window.PawsomeDB.collection('appointments').where('date', '==', date).get()
      .then(function(snap) {
        var conflictTime = null;
        snap.forEach(function(doc) {
          var b = doc.data();
          if (doc.id === excludeId || b.status !== 'accepted' || b.doctorId !== doctorId) return;
          var bStart = timeToMins(b.time);
          var bEnd = bStart + (b.duration || getServiceDuration(b.service) || 20);
          if (startMin < bEnd && endMin > bStart) conflictTime = b.time;
        });
        return conflictTime;
      });
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

  // Doctor's config for a date: per-day entry > weekly template (only inside
  // its validity period). Null when nothing is set for that date.
  // Mirrors resolveDoctorDay() in booking.js — keep the two in sync.
  function resolveDayConfig(sched, dateStr, dow) {
    if (!sched) return null;
    var day = sched.days && sched.days[dateStr];
    if (day) return day;
    if (sched.validFrom && dateStr < sched.validFrom) return null;
    if (sched.validUntil && dateStr > sched.validUntil) return null;
    return (sched.defaultWeek && sched.defaultWeek[String(dow)]) ||
           (sched.weeklyHours && sched.weeklyHours[String(dow)]) || null;
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
    var day = resolveDayConfig(sched, date, dateStrToDow(date));
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
    // Prefill only: `lastWeek` is the weekly form as last saved. The hours that
    // actually apply are the per-day entries in `days`.
    var defaultWeek = sched.lastWeek || sched.defaultWeek || sched.weeklyHours || {};
    // Copy — edits must not leak into the cached schedule if the save is cancelled or rejected
    var days = Object.assign({}, sched.days);
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
            '<div class="sched-period-hint">Godziny pracy zostan\u0105 zapisane dla ka\u017cdego dnia w wybranym okresie.</div>' +
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

    // The weekly rows as they stand in the form ('0'..'6' → day config)
    function readWeekRows() {
      var wh = {};
      modal.querySelectorAll('.sched-day-row').forEach(function(row) {
        var dow = row.dataset.dow;
        var active = row.querySelector('.sched-day-check').checked;
        wh[dow] = active ? {
          active: true,
          start: row.querySelector('.sched-time-start').value || '08:00',
          end: row.querySelector('.sched-time-end').value || '18:00',
          pauses: weekPauses[parseInt(dow)].map(function(p) { return { start: p.start, end: p.end }; })
        } : { active: false };
      });
      return wh;
    }
    // What the form was prefilled with — to tell "hours edited" from "hours left alone"
    var prefilledWeekJson = JSON.stringify(readWeekRows());

    modal.querySelector('.sched-btn-save').addEventListener('click', function() {
      var saveErrorEl = modal.querySelector('.sched-save-error');
      function invalid(msg) {
        saveErrorEl.textContent = msg;
        saveErrorEl.style.display = '';
      }

      var wh = readWeekRows();
      var weekChanged = JSON.stringify(wh) !== prefilledWeekJson;

      var vFrom = modal.querySelector('#sched-valid-from').value || null;
      var vUntil = modal.querySelector('#sched-valid-until').value || null;
      var hasPeriod = !!(vFrom && vUntil);

      if (!!vFrom !== !!vUntil) { invalid('Podaj obie daty okresu (od i do).'); return; }

      var cur = null, end = null;
      if (hasPeriod) {
        var parts = vFrom.split('-');
        cur = new Date(+parts[0], +parts[1] - 1, +parts[2]);
        var endParts = vUntil.split('-');
        end = new Date(+endParts[0], +endParts[1] - 1, +endParts[2]);
        if (cur > end) { invalid('Data „do” nie może być wcześniejsza niż „od”.'); return; }
        // Inclusive day count (rounded: a DST change makes a day 23 or 25 hours)
        if (Math.round((end - cur) / 86400000) + 1 > 366) { invalid('Okres może obejmować najwyżej rok.'); return; }
      }

      if (hasPeriod || weekChanged) {
        var fullDayNames = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
        for (var i = 0; i < dayOrder.length; i++) {
          var cfg = wh[String(dayOrder[i])];
          if (cfg.active && cfg.end <= cfg.start) {
            invalid('Godzina zakończenia pracy musi być późniejsza niż rozpoczęcia (' + fullDayNames[dayOrder[i]] + ').');
            return;
          }
        }
      }

      if (!hasPeriod && weekChanged) {
        invalid('Wybierz okres (od–do), w którym mają obowiązywać te godziny. Bez okresu można zapisać tylko blokady czasu.');
        return;
      }

      // Fresh copy on every attempt — a save refused because of a conflict
      // must not leave its expansion behind for the next attempt
      var newDays = Object.assign({}, days);

      // Expand weekly template into per-day entries for the specified date range
      if (hasPeriod) {
        while (cur <= end) {
          var dateStr = cur.getFullYear() + '-' +
            String(cur.getMonth() + 1).padStart(2, '0') + '-' +
            String(cur.getDate()).padStart(2, '0');
          var dow = String(cur.getDay());
          var dayConfig = wh[dow];
          newDays[dateStr] = dayConfig.active
            ? { active: true, start: dayConfig.start, end: dayConfig.end,
                pauses: dayConfig.pauses.map(function(p) { return { start: p.start, end: p.end }; }) }
            : { active: false };
          cur.setDate(cur.getDate() + 1);
        }
      }

      // Prune per-day entries older than 7 days
      var pruneDate = new Date();
      pruneDate.setDate(pruneDate.getDate() - 7);
      var pruneDateStr = pruneDate.getFullYear() + '-' +
        String(pruneDate.getMonth() + 1).padStart(2, '0') + '-' +
        String(pruneDate.getDate()).padStart(2, '0');
      Object.keys(newDays).forEach(function(key) {
        if (key < pruneDateStr) delete newDays[key];
      });

      saveSchedule({
        // Applying hours to a period makes the per-day entries the source of
        // truth, so an old weekly template is dropped. A blocks-only save must
        // leave whatever hours the doctor already has untouched.
        defaultWeek: hasPeriod ? null : (sched.defaultWeek || sched.weeklyHours || null),
        validFrom: hasPeriod ? null : (sched.validFrom || null),
        validUntil: hasPeriod ? null : (sched.validUntil || null),
        // The hours last applied: prefills this form next time, and tells the
        // booking page that this doctor keeps a schedule (see booking.js)
        lastWeek: hasPeriod ? wh : (sched.lastWeek || null),
        busyBlocks: busyBlocks.slice(),
        days: newDays
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
    return window.PawsomeDB.collection('doctors').get().then(function(snap) {
      allDoctors = [];
      snap.forEach(function(doc) {
        var d = doc.data();
        allDoctors.push({ id: doc.id, name: d.name || 'Lekarz', specialty: d.specialty || '' });
      });
      allDoctors.sort(function(a, b) { return a.name.localeCompare(b.name); });
    });
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

    function countStats(year, month, doctorId) {
      var sched = doctorScheduleCache[doctorId];
      var lastDate = new Date(year, month + 1, 0).getDate();
      var working = 0, off = 0, blocks = 0;
      for (var d = 1; d <= lastDate; d++) {
        var dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        var dow = new Date(year, month, d).getDay();
        var cfg = resolveDayConfig(sched, dateStr, dow);
        if (cfg && cfg.active) working++;
        else if (cfg && !cfg.active) off++;
        if (sched && sched.busyBlocks) {
          blocks += sched.busyBlocks.filter(function(bb) { return bb.date === dateStr; }).length;
        }
      }
      return { working: working, off: off, blocks: blocks };
    }

    function renderCalendar(year, month, doctorId) {
      var sched = doctorScheduleCache[doctorId];
      var firstDay = new Date(year, month, 1);
      var lastDate = new Date(year, month + 1, 0).getDate();
      var startOffset = (firstDay.getDay() + 6) % 7;
      var totalCells = 42; // always 6 rows
      var prevMonthLastDate = new Date(year, month, 0).getDate();

      var html = '<div class="vs-cal-header">';
      hdrNames.forEach(function(h) {
        var isWeekend = (h === 'Sb' || h === 'Nd');
        html += '<div class="vs-cal-hdr-cell' + (isWeekend ? ' vs-cal-hdr-weekend' : '') + '">' + escapeHtml(h) + '</div>';
      });
      html += '</div><div class="vs-cal-grid">';

      function renderCell(cellYear, cellMonth, d, isOtherMonth) {
        var dateStr = cellYear + '-' + String(cellMonth + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        var dow = new Date(cellYear, cellMonth, d).getDay();
        var cfg = isOtherMonth ? null : resolveDayConfig(sched, dateStr, dow);
        var dayBusy = (!isOtherMonth && sched && sched.busyBlocks)
          ? sched.busyBlocks.filter(function(bb) { return bb.date === dateStr; })
          : [];
        var isToday = dateStr === todayStr;
        var isActive = cfg && cfg.active;
        var isOff = cfg && !cfg.active;

        var cls = 'vs-cal-cell' +
          (isOtherMonth ? ' vs-cal-other-month' : '') +
          (isToday ? ' vs-cal-today' : '') +
          (isActive ? ' vs-cal-active' : isOff ? ' vs-cal-off' : ' vs-cal-nosched');

        var inner = '<div class="vs-cal-day-num">' + d;
        if (isToday) inner += '<span class="vs-today-dot"></span>';
        inner += '</div>';

        if (!isOtherMonth) {
          if (isActive) {
            inner += '<div class="vs-cal-hours">' + escapeHtml(cfg.start) + '\u2009\u2013\u2009' + escapeHtml(cfg.end) + '</div>';
            (cfg.pauses || []).forEach(function(p) {
              inner += '<div class="vs-cal-pause">przerwa ' + escapeHtml(p.start) + '\u2013' + escapeHtml(p.end) + '</div>';
            });
          } else if (isOff) {
            inner += '<div class="vs-cal-off-label">Wolny</div>';
          }
          dayBusy.forEach(function(bb) {
            inner += '<div class="vs-cal-busy">' + escapeHtml(bb.startTime) + '\u2013' + escapeHtml(bb.endTime) + '</div>';
          });
        }
        return '<div class="' + cls + '">' + inner + '</div>';
      }

      // Previous month trailing days
      for (var i = startOffset - 1; i >= 0; i--) {
        var prevD = prevMonthLastDate - i;
        var prevM = month - 1, prevY = year;
        if (prevM < 0) { prevM = 11; prevY--; }
        html += renderCell(prevY, prevM, prevD, true);
      }
      // Current month days
      for (var d = 1; d <= lastDate; d++) {
        html += renderCell(year, month, d, false);
      }
      // Next month leading days
      var filled = startOffset + lastDate;
      var nextD = 1;
      var nextM = month + 1, nextY = year;
      if (nextM > 11) { nextM = 0; nextY++; }
      while (filled < totalCells) {
        html += renderCell(nextY, nextM, nextD++, true);
        filled++;
      }
      return html + '</div>';
    }

    function refresh() {
      overlay.querySelector('#vs-month-label').textContent = monthNames[viewMonth] + ' ' + viewYear;
      overlay.querySelector('#view-sched-content').innerHTML = renderCalendar(viewYear, viewMonth, selectedDoctorId);

      var stats = countStats(viewYear, viewMonth, selectedDoctorId);
      var statsEl = overlay.querySelector('#vs-stats');
      statsEl.innerHTML =
        '<span class="vs-stat"><span class="vs-stat-num vs-stat-working">' + stats.working + '</span> dni pracy</span>' +
        '<span class="vs-stat-sep"></span>' +
        '<span class="vs-stat"><span class="vs-stat-num vs-stat-off">' + stats.off + '</span> wolne</span>' +
        (stats.blocks > 0 ? '<span class="vs-stat-sep"></span><span class="vs-stat"><span class="vs-stat-num vs-stat-blocks">' + stats.blocks + '</span> blokad</span>' : '');
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
          '<div class="vs-toolbar">' +
            '<div class="view-sched-selector">' +
              '<select id="view-sched-doctor" class="view-sched-select">' + doctorOptions + '</select>' +
            '</div>' +
            '<div class="vs-nav">' +
              '<button class="vs-nav-btn" id="vs-prev-month">&#8249;</button>' +
              '<span class="vs-month-label" id="vs-month-label"></span>' +
              '<button class="vs-nav-btn" id="vs-next-month">&#8250;</button>' +
              '<button class="vs-nav-today" id="vs-today">Dzi\u015b</button>' +
            '</div>' +
          '</div>' +
          '<div id="view-sched-content"></div>' +
          '<div class="vs-footer">' +
            '<div class="vs-stats" id="vs-stats"></div>' +
            '<div class="vs-legend">' +
              '<span class="vs-leg-item vs-leg-active">Pracuje</span>' +
              '<span class="vs-leg-item vs-leg-off">Wolny</span>' +
              '<span class="vs-leg-item vs-leg-nosched">Brak grafiku</span>' +
              '<span class="vs-leg-item vs-leg-busy">Blokada</span>' +
            '</div>' +
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
    overlay.querySelector('#vs-today').addEventListener('click', function() {
      viewYear = now.getFullYear();
      viewMonth = now.getMonth();
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
  function getWeekDates(weekOffset) {
    weekOffset = weekOffset || 0;
    var today = new Date();
    var dow = today.getDay();
    var diffToMon = (dow === 0) ? -6 : 1 - dow;
    var monday = new Date(today);
    monday.setDate(today.getDate() + diffToMon + weekOffset * 7);
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

    // Polish plural: 1 wizyta, 2–4 wizyty, 5–21 wizyt, 22–24 wizyty…
    function apptCountLabel(n) {
      if (n === 1) return '1 wizyta';
      var last = n % 10, lastTwo = n % 100;
      if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return n + ' wizyty';
      return n + ' wizyt';
    }

    var html = '<div class="week-sched-grid">';

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
      var cfg = filterDoctorId ? resolveDayConfig(sched, dateStr, jsdow) : null;
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
      html += '<div class="week-day-name-row">';
      html += '<span class="week-day-name">' + escapeHtml(dayNames[idx]) + '</span>';
      if (isToday) html += '<span class="week-day-today-badge">Dziś</span>';
      html += '</div>';
      html += '<span class="week-day-date">' + escapeHtml(dateLabel) + '</span>';
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
          var endTime = minsToTime(timeToMins(a.time) + (a.duration || getServiceDuration(a.service) || 20));
          var statusCls = a.status === 'accepted' ? 'week-appt-status-accepted' : 'week-appt-status-pending';
          var itemBorder = a.status === 'accepted' ? 'week-appt-accent-accepted' : 'week-appt-accent-pending';
          var statusLabel = a.status === 'accepted' ? 'Potw.' : 'Oczek.';
          html += '<div class="week-appt-item ' + itemBorder + '">';
          html += '<div class="week-appt-top">';
          html += '<span class="week-appt-time">' + escapeHtml(a.time) + '\u2013' + escapeHtml(endTime) + '</span>';
          html += '<span class="week-appt-status ' + statusCls + '">' + statusLabel + '</span>';
          html += '</div>';
          if (!filterDoctorId && doctorNameMap) {
            var dname = doctorNameMap[a.doctorId] || '';
            if (dname) html += '<div class="week-appt-doctor">' + escapeHtml(dname) + '</div>';
          }
          html += '<div class="week-appt-patient">' + escapeHtml(a.patientName || '') + ' / ' + escapeHtml(a.petName || '') + '</div>';
          html += '<div class="week-appt-service">' + escapeHtml(getServiceName(a.service)) + '</div>';
          html += '</div>';
        });
        html += '</div>';
      } else if (!filterDoctorId || !isOff) {
        html += '<div class="week-day-empty"><span class="week-day-empty-icon">\u2014</span>Brak wizyt</div>';
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

    var weekOffset = 0;
    var weekDates = getWeekDates(weekOffset);
    var todayStr = formatDateInput(new Date());
    var myId = currentUser.uid;
    var selectedDoctorId = 'all';

    var doctorList = allDoctors.length > 0 ? allDoctors : [{ id: myId, name: doctorName || 'Mój grafik' }];
    var doctorOptions = '<option value="all" selected>Wszyscy lekarze</option>' +
      doctorList.map(function(d) {
        return '<option value="' + escapeAttr(d.id) + '">' + escapeHtml(d.name) + '</option>';
      }).join('');

    var doctorNameMap = {};
    doctorList.forEach(function(d) { doctorNameMap[d.id] = d.name; });

    var overlay = document.createElement('div');
    overlay.id = 'week-sched-modal-overlay';
    overlay.className = 'appt-modal-overlay';
    overlay.innerHTML =
      '<div class="appt-modal week-sched-modal">' +
        '<div class="appt-modal-header">' +
          '<h3 class="appt-modal-title">Harmonogram tygodniowy</h3>' +
          '<button class="appt-modal-close">&times;</button>' +
        '</div>' +
        '<div class="appt-modal-body">' +
          '<div class="week-toolbar">' +
            '<div class="view-sched-selector">' +
              '<label class="view-sched-label">Lekarz:</label>' +
              '<select id="week-sched-doctor" class="view-sched-select">' + doctorOptions + '</select>' +
            '</div>' +
            '<div class="week-nav">' +
              '<button class="vs-nav-btn" id="week-prev" title="Poprzedni tydzień">&#8249;</button>' +
              '<span class="week-nav-label" id="week-nav-label"></span>' +
              '<button class="vs-nav-btn" id="week-next" title="Następny tydzień">&#8250;</button>' +
              '<button class="week-nav-today" id="week-today">Dziś</button>' +
            '</div>' +
          '</div>' +
          '<div id="week-sched-content"><div class="week-sched-loading">Ładowanie wizyt\u2026</div></div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    requestAnimationFrame(function() { overlay.classList.add('visible'); });

    var modal = overlay.querySelector('.week-sched-modal');
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeWeekScheduleModal(); });
    modal.querySelector('.appt-modal-close').addEventListener('click', closeWeekScheduleModal);

    function updateNavLabel() {
      var labelEl = overlay.querySelector('#week-nav-label');
      if (labelEl) labelEl.textContent = buildWeekLabel(weekDates[0], weekDates[6]);
    }

    function fetchAndRender(doctorId) {
      var contentEl = overlay.querySelector('#week-sched-content');
      contentEl.innerHTML = '<div class="week-sched-loading">Ładowanie wizyt\u2026</div>';

      var requestedWeek = weekDates;
      // One range query for the whole week (single-field index, no composite needed)
      window.PawsomeDB.collection('appointments')
        .where('date', '>=', requestedWeek[0])
        .where('date', '<=', requestedWeek[6])
        .get()
        .then(function(snap) {
          // Ignore a response that arrives after the user moved to another week/doctor
          if (requestedWeek !== weekDates || doctorId !== selectedDoctorId) return;
          var apptsByDate = {};
          snap.forEach(function(doc) {
            var a = doc.data();
            if (a.status !== 'accepted' && a.status !== 'pending') return;
            if (doctorId !== 'all' && a.doctorId !== doctorId) return;
            if (!apptsByDate[a.date]) apptsByDate[a.date] = [];
            apptsByDate[a.date].push(a);
          });
          var filterArg = doctorId !== 'all' ? doctorId : null;
          contentEl.innerHTML = buildWeekGrid(requestedWeek, apptsByDate, filterArg, todayStr, doctorNameMap);
        })
        .catch(function(err) {
          console.error('Week schedule fetch error:', err);
          contentEl.innerHTML = '<div class="week-sched-loading">Błąd ładowania wizyt.</div>';
        });
    }

    function refreshWeek() {
      weekDates = getWeekDates(weekOffset);
      updateNavLabel();
      fetchAndRender(selectedDoctorId);
    }

    overlay.querySelector('#week-sched-doctor').addEventListener('change', function() {
      selectedDoctorId = this.value;
      fetchAndRender(selectedDoctorId);
    });

    overlay.querySelector('#week-prev').addEventListener('click', function() {
      weekOffset--;
      refreshWeek();
    });
    overlay.querySelector('#week-next').addEventListener('click', function() {
      weekOffset++;
      refreshWeek();
    });
    overlay.querySelector('#week-today').addEventListener('click', function() {
      weekOffset = 0;
      refreshWeek();
    });

    updateNavLabel();
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
  var doctorsTab = document.getElementById('main-tab-doctors');
  var viewBookings = document.getElementById('view-bookings');
  var viewDoctors = document.getElementById('view-doctors');
  var doctorsContainer = document.getElementById('doctors-container');
  var doctorsLoaded = false;

  mainTabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      mainTabs.forEach(function(t) { t.classList.remove('active'); });
      this.classList.add('active');
      var showDoctors = this.dataset.mainTab === 'doctors';
      viewBookings.style.display = showDoctors ? 'none' : '';
      viewDoctors.style.display = showDoctors ? '' : 'none';
      if (showDoctors && !doctorsLoaded) {
        doctorsLoaded = true;
        loadDoctorsView();
      }
    });
  });

  // Called on every sign-in: a different user may sign in without a page
  // reload. The Doctors tab is admin-only because the rules let only admins
  // write `doctors` and `roles`.
  function resetDoctorsView() {
    doctorsLoaded = false;
    doctorsContainer.innerHTML = '';
    document.querySelectorAll('.editor-modal-overlay').forEach(function(el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    doctorsTab.style.display = isAdmin ? '' : 'none';
    mainTabs.forEach(function(t) {
      t.classList.toggle('active', t.dataset.mainTab === 'bookings');
    });
    viewBookings.style.display = '';
    viewDoctors.style.display = 'none';
  }

  // ══════════════════════════════════════════════════════════
  // ── DOCTORS ──
  // ══════════════════════════════════════════════════════════
  function loadDoctorsView() {
    doctorsContainer.innerHTML = '<div style="text-align:center;padding:2rem;color:#888">Ładowanie lekarzy...</div>';
    loadAllDoctors().then(renderDoctorsView, function(err) {
      doctorsContainer.innerHTML = '<div style="text-align:center;padding:2rem;color:#C62828">Błąd ładowania lekarzy: ' + escapeHtml(err.message || String(err)) + '</div>';
    });
  }

  function renderDoctorsView() {
    doctorsContainer.innerHTML = '<div class="editor-section">' +
      allDoctors.map(function(d) {
        return '<div class="editor-list-item">' +
          '<div class="editor-list-item-info"><strong>' + escapeHtml(d.name) + '</strong><small>' + escapeHtml(d.specialty) + '</small></div>' +
          '<div class="editor-list-item-actions">' +
            '<button class="editor-edit-btn" data-edit-id="' + escapeAttr(d.id) + '">Edytuj</button>' +
            '<button class="editor-delete-btn" data-del-id="' + escapeAttr(d.id) + '">Usuń</button>' +
          '</div></div>';
      }).join('') +
      '<button class="editor-add-btn" data-add-doctor>+ Dodaj lekarza</button>' +
    '</div>';
  }

  doctorsContainer.addEventListener('click', function(e) {
    var btn = e.target;
    if (btn.hasAttribute('data-add-doctor')) {
      openDoctorModal(null);
    } else if (btn.dataset.editId) {
      var doctor = allDoctors.find(function(d) { return d.id === btn.dataset.editId; });
      if (doctor) openDoctorModal(doctor);
    } else if (btn.dataset.delId) {
      deleteDoctor(btn.dataset.delId);
    }
  });

  function deleteDoctor(id) {
    // Deleting the role is what revokes panel access, and the rules need the
    // caller's own admin role for the remaining deletes
    if (currentUser && id === currentUser.uid) {
      alert('Nie możesz usunąć własnego profilu — utraciłbyś dostęp do panelu.');
      return;
    }
    if (!confirm('Na pewno usunąć?')) return;
    var db = window.PawsomeDB;
    // Visits and their slot cells would be orphaned — refuse while the doctor
    // still has upcoming ones. Single-field filter: no composite index needed.
    db.collection('appointments').where('doctorId', '==', id).get().then(function(snap) {
      var todayStr = formatDateInput(new Date());
      var upcoming = 0;
      snap.forEach(function(apptDoc) {
        var a = apptDoc.data();
        if ((a.status === 'pending' || a.status === 'accepted') && (a.date || '') >= todayStr) upcoming++;
      });
      if (upcoming > 0) {
        alert(upcomingVisitsMessage(upcoming));
        return;
      }
      // Role first, so access is gone even if a later step fails
      return db.collection('roles').doc(id).delete().then(function() {
        return db.collection('doctorSchedules').doc(id).delete();
      }).then(function() {
        return db.collection('doctors').doc(id).delete();
      }).then(function() {
        allDoctors = allDoctors.filter(function(d) { return d.id !== id; });
        delete doctorScheduleCache[id];
        renderDoctorsView();
        refreshDisplay(datePicker.value);
        alert('Lekarz został usunięty. Jego konto logowania można usunąć tylko w konsoli Firebase (Authentication) — bez roli nie zaloguje się już do panelu.');
      });
    }).catch(function(e) {
      alert('Błąd usuwania: ' + ((e && e.message) || 'spróbuj ponownie.'));
    });
  }

  // Polish plural forms: 1 wizytę, 2–4 wizyty, 5+ wizyt (12–14 → wizyt)
  function upcomingVisitsMessage(n) {
    var last = n % 10, lastTwo = n % 100;
    if (n === 1) {
      return 'Ten lekarz ma 1 nadchodzącą wizytę (oczekującą lub potwierdzoną). Odrzuć ją lub przenieś przed usunięciem lekarza.';
    }
    if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) {
      return 'Ten lekarz ma ' + n + ' nadchodzące wizyty (oczekujące lub potwierdzone). Odrzuć je lub przenieś przed usunięciem lekarza.';
    }
    return 'Ten lekarz ma ' + n + ' nadchodzących wizyt (oczekujących lub potwierdzonych). Odrzuć je lub przenieś przed usunięciem lekarza.';
  }

  function field(label, id, value) {
    return '<div class="editor-field"><label for="ed-' + id + '">' + escapeHtml(label) + '</label><input type="text" id="ed-' + id + '" value="' + escapeAttr(value) + '"></div>';
  }

  function val(id) {
    var el = document.getElementById('ed-' + id);
    return el ? el.value : '';
  }

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

  // `doctor` is an entry of allDoctors, or null to add a new doctor
  function openDoctorModal(doctor) {
    var isNew = !doctor;

    var m = createModalOverlay();
    var html = '<button class="editor-modal-close">&times;</button>';
    html += '<h3>' + (isNew ? 'Dodaj lekarza' : 'Edytuj lekarza') + '</h3>';
    // The email is only the login; it is never stored in the publicly readable doctors doc
    if (isNew) {
      html += '<div class="editor-field"><label for="ed-doc-email">Email (login)</label>' +
        '<input type="email" id="ed-doc-email" placeholder="np. jan@klinika.pl"></div>';
    }
    html += field('Imię i tytuł', 'doc-name', isNew ? '' : doctor.name);
    html += field('Specjalizacja', 'doc-specialty', isNew ? '' : doctor.specialty);
    html += '<div class="editor-modal-actions">' +
      '<button class="editor-save-btn" id="doc-modal-save">' + (isNew ? 'Dodaj lekarza' : 'Zapisz zmiany') + '</button></div>';

    m.modal.innerHTML = html;
    m.modal.querySelector('.editor-modal-close').addEventListener('click', m.close);

    m.modal.querySelector('#doc-modal-save').addEventListener('click', function() {
      var db = window.PawsomeDB;
      var data = { name: val('doc-name').trim(), specialty: val('doc-specialty').trim() };
      var email = val('doc-email').trim();
      if (!data.name) { alert('Imię jest wymagane'); return; }
      if (isNew && !email) { alert('Email jest wymagany — to login lekarza do panelu'); return; }

      this.disabled = true;
      var self = this;
      // Set once a login account has been created: how the doctor gets a password
      var accountNote = '';

      function saveDoc(docId) {
        db.collection('doctors').doc(docId).set(data).then(function() {
          if (isNew) {
            allDoctors.push({ id: docId, name: data.name, specialty: data.specialty });
          } else {
            doctor.name = data.name;
            doctor.specialty = data.specialty;
          }
          allDoctors.sort(function(a, b) { return a.name.localeCompare(b.name); });
          renderDoctorsView();
          refreshDisplay(datePicker.value);
          m.close();
          if (accountNote) alert(accountNote);
        }).catch(function(e) {
          alert('Błąd: ' + e.message + (accountNote ? '\n\n' + accountNote : ''));
          self.disabled = false;
        });
      }

      if (!isNew) {
        saveDoc(doctor.id);
        return;
      }
      createDoctorAuthAccount(email).then(function(uid) {
        // The account has a random password nobody knows — send a link to set
        // one (best effort; the login page offers the same reset).
        return window.PawsomeAuth.sendPasswordResetEmail(email).then(function() {
          accountNote = 'Konto lekarza zostało utworzone. Link do ustawienia hasła wysłano na adres ' + email + '.';
        }, function() {
          accountNote = 'Konto lekarza zostało utworzone, ale nie udało się wysłać linku do ustawienia hasła. Lekarz powinien użyć opcji „Zapomniałeś hasła?” na stronie logowania (adres: ' + email + ').';
        }).then(function() {
          saveDoc(uid);
        });
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
    });
  }

  // ── INIT ──
  initAuth();
})();
