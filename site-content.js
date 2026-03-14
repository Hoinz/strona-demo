// Dynamic content loader for Pawsome homepage
// Loads content from Firestore and replaces DOM elements.
// Falls back silently to hardcoded HTML if Firestore fails.
(function() {
  'use strict';

  var db = window.PawsomeDB;
  if (!db) return;

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  Promise.all([
    db.collection('siteContent').doc('hero').get(),
    db.collection('siteContent').doc('stats').get(),
    db.collection('siteContent').doc('servicesSection').get(),
    db.collection('siteContent').doc('about').get(),
    db.collection('siteContent').doc('testimonials').get(),
    db.collection('siteContent').doc('contact').get(),
    db.collection('services').orderBy('displayOrder').get(),
    db.collection('doctors').where('showOnWebsite', '==', true).orderBy('displayOrder').get()
  ]).then(function(results) {
    var hero = results[0].exists ? results[0].data() : null;
    var stats = results[1].exists ? results[1].data() : null;
    var servicesSec = results[2].exists ? results[2].data() : null;
    var about = results[3].exists ? results[3].data() : null;
    var testimonials = results[4].exists ? results[4].data() : null;
    var contact = results[5].exists ? results[5].data() : null;
    var services = [];
    results[6].forEach(function(doc) { services.push(doc.data()); });
    var doctors = [];
    results[7].forEach(function(doc) { doctors.push(Object.assign({ id: doc.id }, doc.data())); });

    var el;

    // ── HERO ──
    if (hero) {
      el = document.getElementById('hero-section-label');
      if (el) el.textContent = hero.sectionLabel;
      el = document.getElementById('hero-title');
      if (el) el.innerHTML = escapeHtml(hero.titleBefore) + '<em>' + escapeHtml(hero.titleEmphasis) + '</em>' + escapeHtml(hero.titleAfter);
      el = document.getElementById('hero-subtitle');
      if (el) el.textContent = hero.subtitle;
      el = document.getElementById('hero-cta-primary');
      if (el) el.textContent = hero.ctaPrimary;
      el = document.getElementById('hero-cta-secondary');
      if (el) el.textContent = hero.ctaSecondary;
    }

    // ── STATS ──
    if (stats && stats.items) {
      el = document.getElementById('stats-strip');
      if (el) {
        var statsHtml = '';
        stats.items.forEach(function(item) {
          statsHtml += '<div class="stat-item"><div class="stat-number">' + escapeHtml(item.number) + '</div><div class="stat-label">' + escapeHtml(item.label) + '</div></div>';
        });
        el.innerHTML = statsHtml;
      }
    }

    // ── SERVICES SECTION HEADER ──
    if (servicesSec) {
      el = document.getElementById('services-section-label');
      if (el) el.textContent = servicesSec.sectionLabel;
      el = document.getElementById('services-title');
      if (el) el.textContent = servicesSec.title;
      el = document.getElementById('services-subtitle');
      if (el) el.textContent = servicesSec.subtitle;
    }

    // ── SERVICES GRID ──
    if (services.length > 0) {
      el = document.getElementById('services-grid');
      if (el) {
        var gridHtml = '';
        services.forEach(function(svc) {
          gridHtml += '<a href="usluga.html?slug=' + encodeURIComponent(svc.slug) + '" class="service-card">' +
            '<div class="service-icon ' + escapeHtml(svc.iconColorClass) + '">' + escapeHtml(svc.emoji) + '</div>' +
            '<h3>' + escapeHtml(svc.name) + '</h3>' +
            '<p>' + escapeHtml(svc.shortDescription) + '</p>' +
            '</a>';
        });
        el.innerHTML = gridHtml;
      }

      // Update footer service links
      var footerCol = document.getElementById('footer-services-col');
      if (footerCol) {
        var footerHtml = '<h4>Usługi</h4>';
        services.slice(0, 5).forEach(function(svc) {
          footerHtml += '<a href="usluga.html?slug=' + encodeURIComponent(svc.slug) + '">' + escapeHtml(svc.name) + '</a>';
        });
        footerCol.innerHTML = footerHtml;
      }
    }

    // ── ABOUT ──
    if (about) {
      el = document.getElementById('about-section-label');
      if (el) el.textContent = about.sectionLabel;
      el = document.getElementById('about-title');
      if (el) el.innerHTML = escapeHtml(about.title).replace(', ', ',<br>');
      el = document.getElementById('about-emoji');
      if (el) el.textContent = about.emoji;
      el = document.getElementById('about-p1');
      if (el) el.textContent = about.paragraph1;
      el = document.getElementById('about-p2');
      if (el) el.textContent = about.paragraph2;
      if (about.values) {
        el = document.getElementById('about-values');
        if (el) {
          var valHtml = '';
          about.values.forEach(function(v, i) {
            valHtml += '<div class="value-item"><div class="value-dot vd-' + (i+1) + '"></div><div><strong>' + escapeHtml(v.title) + '</strong><span>' + escapeHtml(v.text) + '</span></div></div>';
          });
          el.innerHTML = valHtml;
        }
      }
    }

    // ── TEAM ──
    if (doctors.length > 0) {
      el = document.getElementById('team-grid');
      if (el) {
        var teamHtml = '';
        doctors.forEach(function(doc, i) {
          teamHtml += '<div class="team-member">';
          if (doc.photoURL) {
            teamHtml += '<div class="team-avatar ta-' + (i+1) + '"><img src="' + escapeHtml(doc.photoURL) + '" alt="' + escapeHtml(doc.name) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%"></div>';
          } else {
            teamHtml += '<div class="team-avatar ta-' + (i+1) + '">👩‍⚕️</div>';
          }
          teamHtml += '<h3>' + escapeHtml(doc.name) + '</h3>';
          teamHtml += '<p>' + escapeHtml(doc.specialty) + '</p>';
          if (doc.bio) teamHtml += '<div class="bio">' + escapeHtml(doc.bio) + '</div>';
          teamHtml += '</div>';
        });
        el.innerHTML = teamHtml;
      }
    }

    // ── TESTIMONIALS ──
    if (testimonials) {
      el = document.getElementById('testimonials-section-label');
      if (el) el.textContent = testimonials.sectionLabel;
      el = document.getElementById('testimonials-title');
      if (el) el.textContent = testimonials.title;
      if (testimonials.items) {
        el = document.getElementById('testimonials-grid');
        if (el) {
          var testHtml = '';
          testimonials.items.forEach(function(t) {
            var starsStr = '';
            for (var s = 0; s < (t.stars || 5); s++) starsStr += '★ ';
            testHtml += '<div class="testimonial-card">' +
              '<div class="stars">' + starsStr.trim() + '</div>' +
              '<blockquote>„' + escapeHtml(t.quote) + '"</blockquote>' +
              '<div class="testimonial-author">' +
                '<div class="author-avatar">' + escapeHtml(t.authorEmoji) + '</div>' +
                '<div><div class="author-name">' + escapeHtml(t.authorName) + '</div>' +
                '<div class="author-pet">' + escapeHtml(t.authorPet) + '</div></div>' +
              '</div></div>';
          });
          el.innerHTML = testHtml;
        }
      }
    }

    // ── CONTACT ──
    if (contact) {
      el = document.getElementById('contact-section-label');
      if (el) el.textContent = contact.sectionLabel;
      el = document.getElementById('contact-title');
      if (el) el.textContent = contact.title;
      el = document.getElementById('contact-subtitle');
      if (el) el.textContent = contact.subtitle;
      el = document.getElementById('contact-address');
      if (el) el.innerHTML = '<strong>' + escapeHtml(contact.address) + '</strong><br>' + escapeHtml(contact.addressCity);
      el = document.getElementById('contact-phone');
      if (el) el.innerHTML = '<strong><a href="tel:' + escapeHtml(contact.phone.replace(/\s/g,'')) + '" style="color:inherit;text-decoration:none;">' + escapeHtml(contact.phone) + '</a></strong><br>' + escapeHtml(contact.phoneNote);
      el = document.getElementById('contact-email');
      if (el) el.innerHTML = '<strong><a href="mailto:' + escapeHtml(contact.email) + '" style="color:inherit;text-decoration:none;">' + escapeHtml(contact.email) + '</a></strong><br>' + escapeHtml(contact.emailNote);
      el = document.getElementById('contact-hours');
      if (el) el.innerHTML = '<strong>' + escapeHtml(contact.hours) + '</strong><br>' + escapeHtml(contact.hoursNote);
      el = document.getElementById('contact-cta-title');
      if (el) el.textContent = contact.ctaTitle;
      el = document.getElementById('contact-cta-text');
      if (el) el.textContent = contact.ctaText;
      el = document.getElementById('contact-cta-btn');
      if (el) el.textContent = contact.ctaButtonText;
    }

    // Report success
    db.collection('siteContent').doc('_health').set({
      lastSuccess: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

  }).catch(function(err) {
    // Silent failure — hardcoded content remains visible
    console.warn('Site content load failed:', err);
    try {
      db.collection('siteErrors').add({
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        page: 'index',
        error: err.message || String(err)
      });
    } catch(e) {}
  });
})();
