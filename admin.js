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

  // ── AUTH ──
  function initAuth() {
    var auth = window.PawsomeAuth;
    if (!auth) return;

    auth.onAuthStateChanged(function(user) {
      if (user) {
        loginView.style.display = 'none';
        dashboard.classList.add('visible');
        if (!dashboardInitialized) {
          initDashboard();
          dashboardInitialized = true;
        } else {
          loadBookings();
        }
      } else {
        loginView.style.display = '';
        dashboard.classList.remove('visible');
        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      }
    });
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

    loadBookings();
  }

  // ── LOAD BOOKINGS (single unfiltered listener) ──
  function loadBookings() {
    var db = window.PawsomeDB;
    if (!db) return;

    if (unsubscribe) unsubscribe();

    var dateStr = datePicker.value;

    // Single unfiltered listener for the entire day
    unsubscribe = db.collection('appointments')
      .where('date', '==', dateStr)
      .onSnapshot(function(snapshot) {
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
        var accepted = {};
        allBookings.forEach(function(b) {
          if (b.status === 'accepted') accepted[b.time] = b;
        });
        renderTimeline(dateStr, accepted);
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

      return '<div class="booking-card status-' + escapeAttr(b.status) + '">' +
        '<div class="booking-info">' +
          '<span class="booking-status ' + escapeAttr(b.status) + '">' + statusLabel + '</span>' +
          '<h3>' + escapeHtml(b.patientName) + ' — ' + escapeHtml(b.petName) + '</h3>' +
          '<div class="booking-meta">' +
            '<span>🕐 ' + escapeHtml(b.time) + '</span>' +
            '<span>📞 ' + escapeHtml(b.phone) + '</span>' +
            '<span>✉️ ' + escapeHtml(b.email) + '</span>' +
            '<span>🩺 ' + escapeHtml(getServiceName(b.service)) + '</span>' +
          '</div>' +
        '</div>' +
        (showActions ?
          '<div class="booking-actions">' +
            '<button class="btn-accept" data-id="' + escapeAttr(b.id) + '">Potwierdź</button>' +
            '<button class="btn-reject" data-id="' + escapeAttr(b.id) + '">Odrzuć</button>' +
          '</div>' : '') +
      '</div>';
    }).join('');

    // Attach event listeners instead of inline onclick
    bookingsList.querySelectorAll('.btn-accept').forEach(function(btn) {
      btn.addEventListener('click', function() { acceptBooking(this.dataset.id); });
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

  // ── RENDER TIMELINE (from pre-filtered data) ──
  function renderTimeline(dateStr, accepted) {
    if (!timelineEl) return;

    // Use shared config if available, otherwise fallback
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

    // Use shared slot generator if available
    var slots;
    if (window.PawsomeBooking && window.PawsomeBooking.generateTimeSlots) {
      slots = window.PawsomeBooking.generateTimeSlots(dayOfWeek, null);
    } else {
      slots = [];
      var startParts = h.open.split(':');
      var endParts = h.close.split(':');
      var mins = parseInt(startParts[0]) * 60 + parseInt(startParts[1]);
      var endMins = parseInt(endParts[0]) * 60 + parseInt(endParts[1]);
      while (mins + 30 <= endMins) {
        slots.push(String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0'));
        mins += 30;
      }
    }

    var html = '<h3 style="margin-bottom:1rem">Harmonogram dnia</h3>';
    slots.forEach(function(timeStr) {
      var appt = accepted[timeStr];
      html += '<div class="timeline-slot">' +
        '<div class="timeline-time">' + timeStr + '</div>' +
        '<div class="timeline-content' + (appt ? ' booked' : '') + '">' +
          (appt ? escapeHtml(appt.patientName) + ' — ' + escapeHtml(appt.petName) + ' (' + escapeHtml(getServiceName(appt.service)) + ')' : '—') +
        '</div>' +
      '</div>';
    });
    timelineEl.innerHTML = html;
  }

  // ── ACTIONS ──
  function acceptBooking(id) {
    var db = window.PawsomeDB;
    db.collection('appointments').doc(id).update({ status: 'accepted' });
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

  // ── HELPERS ──
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
