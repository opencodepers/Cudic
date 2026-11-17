/* file: public/next.js
 * what: The Next workspace shell — feature index, search/filter, stage renderer, deep links and delegated actions.
 * invariants: the stage is the only place a specimen renders; actions live on the feature object, never in this file.
 * see: public/next-core.js, public/next-chat.js, public/next-server.js.
 */
(function () {
  'use strict';

  var NX = window.CudicNext;
  var stage = NX.stage = document.getElementById('nxStage');
  var index = document.getElementById('nxIndex');
  var empty = document.getElementById('nxEmpty');
  var search = document.getElementById('nxSearch');
  var jump = document.getElementById('nxJump');
  var reset = document.getElementById('nxReset');
  var e = NX.esc;
  var chevronLeft = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m15 18-6-6 6-6"/></svg>';
  var chevronRight = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9 18 6-6-6-6"/></svg>';
  var features = NX.features;
  var filter = 'all';
  var query = '';
  var active = '';

  function sideLabel(feature) { return feature.side === 'chat' ? 'Chat & community' : 'Server'; }

  function matches(feature) {
    if (filter !== 'all' && feature.side !== filter) return false;
    var q = query.trim().toLowerCase();
    if (!q) return true;
    return [feature.title, feature.blurb, feature.group, feature.why, 'plan ' + feature.plan, String(feature.plan)]
      .join(' ').toLowerCase().indexOf(q) !== -1;
  }

  function renderIndex() {
    if (!index) return;
    var visible = features.filter(matches);
    var groups = [];
    visible.forEach(function (feature) {
      var group = groups[groups.length - 1];
      if (!group || group.name !== feature.group) groups.push({ name: feature.group, items: [feature] });
      else group.items.push(feature);
    });
    index.innerHTML = groups.map(function (group) {
      return '<div class="nx-group"><div class="nx-group-label">' + e(group.name) + '</div>'
        + group.items.map(function (feature) {
          var isActive = feature.id === active;
          return '<button type="button" class="nx-row" data-id="' + e(feature.id) + '" aria-current="' + isActive + '">'
            + '<span class="nx-row-no">' + String(features.indexOf(feature) + 1).padStart(2, '0') + '</span>'
            + '<span class="nx-row-copy"><span class="nx-row-title">' + e(feature.title) + '</span>'
            + '<span class="nx-row-meta">Plan #' + feature.plan + ' · ' + e(sideLabel(feature)) + '</span></span>'
            + '<span class="nx-row-pip" aria-hidden="true"></span></button>';
        }).join('') + '</div>';
    }).join('');
    if (empty) empty.hidden = visible.length !== 0;
    NX.$$('[data-id]', index).forEach(function (button) {
      button.addEventListener('click', function () { selectFeature(button.getAttribute('data-id'), { scroll: true, focusIndex: true }); });
    });
  }

  function renderJump() {
    if (!jump) return;
    jump.innerHTML = features.map(function (feature) {
      return '<option value="' + e(feature.id) + '">' + String(features.indexOf(feature) + 1).padStart(2, '0') + ' · ' + e(feature.title) + '</option>';
    }).join('');
    jump.value = active;
  }

  function renderStage() {
    var feature = NX.byId(active) || features[0];
    if (!feature) {
      stage.innerHTML = '<p class="nx-muted">No features loaded.</p>';
      return;
    }
    var order = features.indexOf(feature);
    var body = '';
    try { body = feature.render(); }
    catch (err) {
      console.error('Next specimen failed:', err);
      body = '<p class="nx-muted">This specimen could not render. The rest of the workspace is intact.</p>';
    }
    stage.innerHTML = '<header class="nx-stage-head">'
      + '<div class="nx-stage-tools">'
      + '<button type="button" class="nx-step" id="nxPrev" aria-label="Previous feature"' + (order === 0 ? ' disabled' : '') + '>' + chevronLeft + '</button>'
      + '<button type="button" class="nx-step" id="nxNext" aria-label="Next feature"' + (order === features.length - 1 ? ' disabled' : '') + '>' + chevronRight + '</button>'
      + '</div>'
      + '<div class="nx-stage-kicker"><span class="nx-stage-no">' + String(order + 1).padStart(2, '0') + '</span>' + e(sideLabel(feature)) + ' · ' + e(feature.group) + '</div>'
      + '<h2 id="nxStageTitle">' + e(feature.title) + '</h2>'
      + '<p class="nx-stage-blurb">' + e(feature.blurb) + '</p></header>'
      + '<div class="nx-stage-grid"><div class="nx-demo"><div class="nx-demo-head"><div><div class="nx-demo-title">Live specimen</div>'
      + '<p class="nx-demo-sub">' + e(feature.group) + ' · plan #' + feature.plan + '</p></div><span class="nx-badge">Working model</span></div>'
      + '<div class="nx-demo-body">' + body + '</div></div>'
      + '<aside class="nx-notes"><h3>Why this, now</h3><p>' + e(feature.why) + '</p>'
      + '<h3>Definition of done</h3><ul class="nx-proof">' + feature.proof.map(function (line) { return '<li>' + e(line) + '</li>'; }).join('') + '</ul>'
      + '<div class="nx-gate"><span>Ship gate</span><p>' + e(feature.gate) + '</p></div></aside></div>';

    var prev = document.getElementById('nxPrev');
    var next = document.getElementById('nxNext');
    if (prev) prev.onclick = function () { selectFeature(features[order - 1].id, { scroll: true }); };
    if (next) next.onclick = function () { selectFeature(features[order + 1].id, { scroll: true }); };
    decorate();
  }

  function decorate() {
    var art = document.getElementById('nxBgArt');
    if (art && NX.state.bg && NX.state.bg.url) {
      art.style.backgroundImage = 'url("' + NX.state.bg.url.replace(/["\\\n]/g, '') + '")';
      art.style.backgroundSize = 'cover';
      art.style.backgroundPosition = 'center';
    }
  }

  NX.rerender = renderStage;

  function selectFeature(id, options) {
    if (!NX.byId(id)) id = features[0] && features[0].id;
    if (!id) return;
    active = id;
    if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
    renderIndex();
    renderJump();
    if (jump) jump.value = id;
    renderStage();
    if (options && options.scroll && window.innerWidth <= 980) {
      stage.scrollIntoView({ block: 'start' });
    }
    if (options && options.focusIndex) {
      var row = index && index.querySelector('[data-id="' + id + '"]');
      if (row) row.focus({ preventScroll: true });
    }
  }

  NX.$$('[data-filter]').forEach(function (button) {
    button.addEventListener('click', function () {
      filter = button.getAttribute('data-filter') || 'all';
      NX.$$('[data-filter]').forEach(function (other) { other.setAttribute('aria-selected', String(other === button)); });
      renderIndex();
    });
  });

  if (search) {
    search.addEventListener('input', function () {
      query = search.value;
      renderIndex();
    });
  }

  if (jump) {
    jump.addEventListener('change', function () { selectFeature(jump.value, { scroll: true }); });
  }

  stage.addEventListener('click', function (event) {
    var button = event.target.closest('[data-act]');
    if (!button || button.disabled) return;
    var feature = NX.byId(active);
    var action = feature && feature.actions && feature.actions[button.getAttribute('data-act')];
    if (!action) return;
    event.preventDefault();
    try { action(button, event); }
    catch (err) {
      console.error('Next action failed:', err);
      NX.toast('That action could not complete.');
    }
  });

  stage.addEventListener('change', function (event) {
    var input = event.target.closest('[data-change]');
    if (input) {
      var path = input.getAttribute('data-change');
      var value = input.type === 'checkbox' ? input.checked : input.value;
      NX.setPath(path, value);
      var feature = NX.byId(active);
      if (feature && typeof feature.change === 'function') feature.change(input, path);
      NX.save();
      renderStage();
      var restored = stage.querySelector('[data-change="' + path + '"]');
      if (restored) restored.focus({ preventScroll: true });
      return;
    }
    if (event.target && event.target.id === 'nxGalFile') {
      var file = event.target.files && event.target.files[0];
      var gallery = NX.byId('galleries');
      if (file && gallery && typeof gallery.file === 'function') gallery.file(file, event.target);
      event.target.value = '';
    }
  });

  stage.addEventListener('input', function (event) {
    var input = event.target.closest('[data-live]');
    if (!input) return;
    var path = input.getAttribute('data-live');
    NX.setPath(path, input.value);
    NX.save();
    var feature = NX.byId(active);
    if (feature && typeof feature.input === 'function') feature.input(input, path);
  });

  var resetArmed = false;
  var resetTimer = 0;
  if (reset) {
    reset.addEventListener('click', function () {
      if (!resetArmed) {
        resetArmed = true;
        reset.textContent = 'Click again to reset';
        NX.toast('This clears the model state in this browser.');
        clearTimeout(resetTimer);
        resetTimer = setTimeout(function () {
          resetArmed = false;
          reset.textContent = 'Reset models';
        }, 3200);
        return;
      }
      clearTimeout(resetTimer);
      resetArmed = false;
      reset.textContent = 'Reset models';
      NX.state = NX.clone(NX.defaults);
      NX.save();
      filter = 'all';
      query = '';
      if (search) search.value = '';
      NX.$$('[data-filter]').forEach(function (button) { button.setAttribute('aria-selected', String(button.getAttribute('data-filter') === 'all')); });
      selectFeature(features[0].id);
      NX.toast('Models reset to their seed state.');
    });
  }

  window.addEventListener('hashchange', function () {
    var id = location.hash.replace(/^#/, '');
    if (NX.byId(id) && id !== active) selectFeature(id);
  });

  var initial = location.hash.replace(/^#/, '');
  if (!NX.byId(initial)) initial = features[0] && features[0].id;
  active = initial;
  renderJump();
  if (search) search.value = '';
  selectFeature(initial);
})();
