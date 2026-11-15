// Dynamic content loader for Pawsome homepage
// Loads content from Firestore and replaces DOM elements.
// Falls back silently to hardcoded HTML if Firestore fails.
(function() {
  'use strict';

  var db = window.PawsomeDB;
  if (!db) return;

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // A field missing from Firestore keeps the hardcoded HTML instead of blanking it.
  function has(value) {
    return value !== undefined && value !== null;
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el && has(value)) el.textContent = value;
  }

  function setHtml(id, html) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = html;
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

    // ── HERO ──
    if (hero) {
      setText('hero-section-label', hero.sectionLabel);
      if (has(hero.titleBefore) || has(hero.titleEmphasis) || has(hero.titleAfter)) {
        setHtml('hero-title', escapeHtml(hero.titleBefore) + '<em>' + escapeHtml(hero.titleEmphasis) + '</em>' + escapeHtml(hero.titleAfter));
      }
      setText('hero-subtitle', hero.subtitle);
      setText('hero-cta-primary', hero.ctaPrimary);
      setText('hero-cta-secondary', hero.ctaSecondary);
    }

    // ── STATS ──
    if (stats && stats.items) {
      var statsHtml = '';
      stats.items.forEach(function(item) {
        statsHtml += '<div class="stat-item"><div class="stat-number">' + escapeHtml(item.number) + '</div><div class="stat-label">' + escapeHtml(item.label) + '</div></div>';
      });
      setHtml('stats-strip', statsHtml);
    }

    // ── SERVICES SECTION HEADER ──
    if (servicesSec) {
      setText('services-section-label', servicesSec.sectionLabel);
      setText('services-title', servicesSec.title);
      setText('services-subtitle', servicesSec.subtitle);
    }

    // ── SERVICES GRID ──
    if (services.length > 0) {
      var gridHtml = '';
      services.forEach(function(svc) {
        var cardClass = 'service-card' + (svc.active === false ? ' inactive' : '');
        gridHtml += '<a href="usluga.html?slug=' + encodeURIComponent(svc.slug) + '" class="' + cardClass + '">' +
          (svc.active === false ? '<div class="inactive-label">Niedostępna</div>' : '') +
          '<div class="service-icon ' + escapeHtml(svc.iconColorClass) + '">' + escapeHtml(svc.emoji) + '</div>' +
          '<h3>' + escapeHtml(svc.name) + '</h3>' +
          '<p>' + escapeHtml(svc.shortDescription) + '</p>' +
          '</a>';
      });
      setHtml('services-grid', gridHtml);

      // Update footer service links
      var footerHtml = '<h4>Usługi</h4>';
      services.slice(0, 5).forEach(function(svc) {
        footerHtml += '<a href="usluga.html?slug=' + encodeURIComponent(svc.slug) + '">' + escapeHtml(svc.name) + '</a>';
      });
      setHtml('footer-services-col', footerHtml);
    }

    // ── ABOUT ──
    if (about) {
      setText('about-section-label', about.sectionLabel);
      if (has(about.title)) setHtml('about-title', escapeHtml(about.title).replace(', ', ',<br>'));
      setText('about-emoji', about.emoji);
      setText('about-p1', about.paragraph1);
      setText('about-p2', about.paragraph2);
      if (about.values) {
        var valHtml = '';
        about.values.forEach(function(v, i) {
          // Only four dot colours (vd-1..vd-4) exist — cycle through them
          valHtml += '<div class="value-item"><div class="value-dot vd-' + (i % 4 + 1) + '"></div><div><strong>' + escapeHtml(v.title) + '</strong><span>' + escapeHtml(v.text) + '</span></div></div>';
        });
        setHtml('about-values', valHtml);
      }
    }

    // ── TEAM ──
    if (doctors.length > 0) {
      var teamHtml = '';
      doctors.forEach(function(doc, i) {
        // Only four avatar gradients (ta-1..ta-4) exist — cycle through them
        var avatarClass = 'team-avatar ta-' + (i % 4 + 1);
        teamHtml += '<div class="team-member">';
        if (doc.photoURL) {
          teamHtml += '<div class="' + avatarClass + '"><img src="' + escapeHtml(doc.photoURL) + '" alt="' + escapeHtml(doc.name) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%"></div>';
        } else {
          teamHtml += '<div class="' + avatarClass + '">👩‍⚕️</div>';
        }
        teamHtml += '<h3>' + escapeHtml(doc.name) + '</h3>';
        teamHtml += '<p>' + escapeHtml(doc.specialty) + '</p>';
        if (doc.bio) teamHtml += '<div class="bio">' + escapeHtml(doc.bio) + '</div>';
        teamHtml += '</div>';
      });
      setHtml('team-grid', teamHtml);
    }

    // ── TESTIMONIALS ──
    if (testimonials) {
      setText('testimonials-section-label', testimonials.sectionLabel);
      setText('testimonials-title', testimonials.title);
      if (testimonials.items) {
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
        setHtml('testimonials-grid', testHtml);
      }
    }

    // ── CONTACT ──
    if (contact) {
      setText('contact-section-label', contact.sectionLabel);
      setText('contact-title', contact.title);
      setText('contact-subtitle', contact.subtitle);
      if (has(contact.address)) {
        setHtml('contact-address', '<strong>' + escapeHtml(contact.address) + '</strong><br>' + escapeHtml(contact.addressCity));
      }
      if (has(contact.phone)) {
        var phone = String(contact.phone);
        setHtml('contact-phone', '<strong><a href="tel:' + escapeHtml(phone.replace(/\s/g,'')) + '" style="color:inherit;text-decoration:none;">' + escapeHtml(phone) + '</a></strong><br>' + escapeHtml(contact.phoneNote));
      }
      if (has(contact.email)) {
        setHtml('contact-email', '<strong><a href="mailto:' + escapeHtml(contact.email) + '" style="color:inherit;text-decoration:none;">' + escapeHtml(contact.email) + '</a></strong><br>' + escapeHtml(contact.emailNote));
      }
      if (has(contact.hours)) {
        setHtml('contact-hours', '<strong>' + escapeHtml(contact.hours) + '</strong><br>' + escapeHtml(contact.hoursNote));
      }
      setText('contact-cta-title', contact.ctaTitle);
      setText('contact-cta-text', contact.ctaText);
      setText('contact-cta-btn', contact.ctaButtonText);
    }

    // Report success. Firestore rules only let site editors write here, so for
    // anonymous visitors this is rejected — swallow that instead of logging an
    // unhandled rejection on every page view.
    db.collection('siteContent').doc('_health').set({
      lastSuccess: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(function() {});

  }).catch(function(err) {
    // Silent failure — hardcoded content remains visible
    console.warn('Site content load failed:', err);
    db.collection('siteErrors').add({
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      page: 'index',
      error: err.message || String(err)
    }).catch(function() {});
  });
})();
