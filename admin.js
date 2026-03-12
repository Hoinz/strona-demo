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
  var unsubscribe = null;
  var dashboardInitialized = false;
  var currentUser = null;
  var viewMode = 'mine';   // 'mine' | 'all'
  var doctorName = '';
  var acceptedById = {};   // id → booking, for the click-to-edit modal

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
        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
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
        loadBookings();
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
        loadBookings();
      });
      btnViewAll.addEventListener('click', function() {
        viewMode = 'all';
        btnViewAll.classList.add('active');
        btnViewMine.classList.remove('active');
        loadBookings();
      });
    }

    loadBookings();
  }

  // ── LOAD BOOKINGS (single unfiltered listener) ──
  function loadBookings() {
    var db = window.PawsomeDB;
    if (!db) return;

    if (unsubscribe) unsubscribe();

    var dateStr = datePicker.value;

    var query = db.collection('appointments').where('date', '==', dateStr);
    if (viewMode === 'mine' && currentUser) {
      query = query.where('doctorId', '==', currentUser.uid);
    }

    unsubscribe = query.onSnapshot(function(snapshot) {
      var allBookings = [];
      snapshot.forEach(function(doc) {
        allBookings.push({ id: doc.id, ...doc.data() });
      });
      allBookings.sort(function(a, b) { return (a.time || '').localeCompare(b.time || ''); });

      // Derive counts from in-memory data
      var counts = { pending: 0, accepted: 0, rejected: 0, all: allBookings.length };
      allBookings.forEach(function(b) {
        counts[b.status] = (counts[b.status] || 0) + 1;
      });
      updateCountsFromData(counts);

      // Filter for display
      var filtered = currentFilter === 'all'
        ? allBookings
        : allBookings.filter(function(b) { return b.status === currentFilter; });
      renderBookings(filtered);

      // Render timeline from accepted bookings (no extra query)
      var acceptedArr = allBookings.filter(function(b) { return b.status === 'accepted'; });
      acceptedById = {};
      acceptedArr.forEach(function(b) { acceptedById[b.id] = b; });
      renderTimeline(dateStr, acceptedArr);
    }, function() {
      bookingsList.innerHTML = '<div class="no-bookings">Błąd ładowania danych</div>';
    });
  }

  // ── RENDER BOOKINGS ──
  function renderBookings(bookings) {
    if (bookings.length === 0) {
      bookingsList.innerHTML = '<div class="no-bookings">Brak rezerwacji do wyświetlenia</div>';
      return;
    }

    bookingsList.innerHTML = bookings.map(function(b) {
      var statusLabel = { pending: 'Oczekuje', accepted: 'Potwierdzona', rejected: 'Odrzucona' }[b.status] || b.status;
      var showActions = b.status === 'pending';
      var dur = b.duration || getServiceDuration(b.service) || 20;
      var durLabel = dur + ' min';
      var endTime = minsToTime(timeToMins(b.time) + dur);

      var dataAttrs = ' data-id="' + escapeAttr(b.id) + '"' +
        ' data-slotid="' + escapeAttr(b.slotId || b.id) + '"' +
        ' data-service="' + escapeAttr(b.service || '') + '"' +
        ' data-duration="' + escapeAttr(String(b.duration || '')) + '"';

      return '<div class="booking-card status-' + escapeAttr(b.status) + '">' +
        '<div class="booking-info">' +
          '<span class="booking-status ' + escapeAttr(b.status) + '">' + statusLabel + '</span>' +
          '<h3>' + escapeHtml(b.patientName) + ' — ' + escapeHtml(b.petName) + '</h3>' +
          '<div class="booking-meta">' +
            '<span>🕐 ' + escapeHtml(b.time) + ' – ' + escapeHtml(endTime) + '</span>' +
            '<span>⏱ ' + escapeHtml(durLabel) + '</span>' +
            '<span>📞 ' + escapeHtml(b.phone) + '</span>' +
            '<span>✉️ ' + escapeHtml(b.email) + '</span>' +
            '<span>🩺 ' + escapeHtml(getServiceName(b.service)) + '</span>' +
            '<span>👨‍⚕️ ' + escapeHtml(b.doctorName || '') + '</span>' +
          '</div>' +
        '</div>' +
        (showActions ?
          '<div class="booking-actions">' +
            '<button class="btn-accept"' + dataAttrs + '>Potwierdź</button>' +
            '<button class="btn-accept-change-time"' + dataAttrs + '>Potwierdź zmień czas</button>' +
            '<button class="btn-reject" data-id="' + escapeAttr(b.id) + '">Odrzuć</button>' +
          '</div>' : '') +
      '</div>';
    }).join('');

    // Attach event listeners instead of inline onclick
    bookingsList.querySelectorAll('.btn-accept').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var defaultDur = getServiceDuration(this.dataset.service) || parseInt(this.dataset.duration) || 10;
        confirmAccept(this.dataset.id, this.dataset.slotid, defaultDur);
      });
    });
    bookingsList.querySelectorAll('.btn-accept-change-time').forEach(function(btn) {
      btn.addEventListener('click', function() {
        showDurationInput(
          this.dataset.id,
          this.dataset.slotid,
          this.dataset.service,
          parseInt(this.dataset.duration) || 0,
          this.closest('.booking-actions')
        );
      });
    });
    bookingsList.querySelectorAll('.btn-reject').forEach(function(btn) {
      btn.addEventListener('click', function() { rejectBooking(this.dataset.id); });
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
    if (viewMode === 'all' && acceptedBookings.length > 0) {
      var doctorMap = {};
      acceptedBookings.forEach(function(b) {
        var key = b.doctorId || b.doctorName || 'unknown';
        if (!doctorMap[key]) doctorMap[key] = { name: b.doctorName || 'Lekarz', bookings: [] };
        doctorMap[key].bookings.push(b);
      });
      columns = [];
      Object.keys(doctorMap).forEach(function(k) { columns.push(doctorMap[k]); });
      columns.sort(function(a, b) { return a.name.localeCompare(b.name); });
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
        (acceptedBookings.length === 0 ? '<p class="sch-empty">Brak potwierdzonych wizyt</p>' : '') +
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
  function showDurationInput(id, slotId, service, currentDuration, actionsEl) {
    var defaultDur = getServiceDuration(service) || currentDuration || 10;
    actionsEl.innerHTML =
      '<div class="duration-confirm">' +
        '<label>Czas (min):</label>' +
        '<input type="number" class="duration-input" value="' + defaultDur + '" min="10" max="240" step="10">' +
        '<button class="btn-confirm-accept">Zatwierdź</button>' +
        '<button class="btn-cancel-accept">Anuluj</button>' +
      '</div>';
    actionsEl.querySelector('.btn-confirm-accept').addEventListener('click', function() {
      var dur = parseInt(actionsEl.querySelector('.duration-input').value) || defaultDur;
      confirmAccept(id, slotId, dur);
    });
    actionsEl.querySelector('.btn-cancel-accept').addEventListener('click', function() {
      loadBookings();
    });
  }

  function confirmAccept(id, slotId, duration) {
    var db = window.PawsomeDB;
    var batch = db.batch();
    batch.update(db.collection('appointments').doc(id), { status: 'accepted', duration: duration });
    if (slotId) {
      batch.update(db.collection('slots').doc(slotId), { duration: duration });
    }
    batch.commit();
  }

  function rejectBooking(id) {
    var db = window.PawsomeDB;
    // Read the appointment to get the slotId
    db.collection('appointments').doc(id).get().then(function(doc) {
      if (!doc.exists) return;
      var slotId = doc.data().slotId || id;
      var batch = db.batch();
      batch.update(db.collection('appointments').doc(id), { status: 'rejected' });
      batch.delete(db.collection('slots').doc(slotId));
      return batch.commit();
    });
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
          '<p class="appt-modal-meta">' + escapeHtml(getServiceName(booking.service)) + ' &bull; ' + escapeHtml(booking.time) + ' – ' + escapeHtml(endTime) + ' &bull; ' + dur + ' min</p>' +
          '<div class="appt-modal-actions">' +
            '<button class="appt-btn-amend">Edytuj wizytę</button>' +
            '<button class="appt-btn-delete">Usuń wizytę</button>' +
          '</div>' +
          '<div class="appt-delete-confirm" style="display:none">' +
            '<p class="appt-delete-warn">Czy na pewno chcesz trwale usunąć tę wizytę?</p>' +
            '<div class="appt-delete-confirm-actions">' +
              '<button class="appt-btn-delete-confirm">Tak, usuń</button>' +
              '<button class="appt-btn-delete-cancel">Anuluj</button>' +
            '</div>' +
          '</div>' +
          '<form class="appt-amend-form" style="display:none">' +
            '<div class="appt-form-row"><label>Imię właściciela</label><input type="text" name="patientName" value="' + escapeAttr(booking.patientName || '') + '" required></div>' +
            '<div class="appt-form-row"><label>Imię zwierzęcia</label><input type="text" name="petName" value="' + escapeAttr(booking.petName || '') + '" required></div>' +
            '<div class="appt-form-row"><label>Telefon</label><input type="tel" name="phone" value="' + escapeAttr(booking.phone || '') + '"></div>' +
            '<div class="appt-form-row"><label>Email</label><input type="email" name="email" value="' + escapeAttr(booking.email || '') + '"></div>' +
            '<div class="appt-form-row"><label>Usługa</label><select name="service">' + serviceOptions + '</select></div>' +
            '<div class="appt-form-row"><label>Godzina</label><input type="text" name="time" value="' + escapeAttr(booking.time || '') + '" placeholder="HH:MM" required></div>' +
            '<div class="appt-form-row"><label>Czas trwania (min)</label><input type="number" name="duration" value="' + dur + '" min="10" max="240" step="10" required></div>' +
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
      var newTime = form.elements.time.value.trim();
      if (!/^\d{2}:\d{2}$/.test(newTime)) {
        errorEl.textContent = 'Nieprawidłowy format godziny (HH:MM)';
        errorEl.style.display = '';
        return;
      }
      errorEl.style.display = 'none';
      amendAppt(booking.id, booking.slotId || booking.id, {
        patientName: form.elements.patientName.value.trim(),
        petName: form.elements.petName.value.trim(),
        phone: form.elements.phone.value.trim(),
        email: form.elements.email.value.trim(),
        service: form.elements.service.value,
        time: newTime,
        duration: parseInt(form.elements.duration.value) || dur
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
    var db = window.PawsomeDB;
    var batch = db.batch();
    batch.delete(db.collection('appointments').doc(id));
    if (slotId) batch.delete(db.collection('slots').doc(slotId));
    batch.commit().then(closeApptModal);
  }

  function amendAppt(id, slotId, fields) {
    var db = window.PawsomeDB;
    var batch = db.batch();
    batch.update(db.collection('appointments').doc(id), fields);
    if (slotId) batch.update(db.collection('slots').doc(slotId), { time: fields.time, duration: fields.duration });
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

  function formatDateInput(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // ── INIT ──
  initAuth();
})();
