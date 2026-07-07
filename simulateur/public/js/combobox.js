// Combobox filtrable minimaliste — remplace un <select> par un champ
// texte avec dropdown filtrable (recherche live sur le libellé) et support
// de tags visuels (emojis) par option.
//
// Étape 7 (2026-02). Concu pour être utilisé sur le sélecteur "Formule"
// des blocs de fiche, mais restera générique pour d'autres cas d'usage.
//
// Usage :
//   const combo = createCombobox({
//     onChange: (value) => { ... },
//     placeholder: 'Rechercher une formule...',
//     groups: [
//       { label: 'Formules classiques', items: [
//         { value: 'fp_xxx', label: 'Privatisation show + repas', tag: '🎭' }
//       ]},
//       { label: '🧩 Formules composables', items: [...] }
//     ],
//     value: 'fp_xxx'   // pré-sélection
//   });
//   parent.appendChild(combo.el);
//   combo.setValue('fp_yyy');
//   combo.setGroups([...]);

let cboxCount = 0;

export function createCombobox({ groups = [], value = '', placeholder = 'Rechercher…', onChange = () => {}, className = '', name = '' } = {}) {
  const id = `cbox-${++cboxCount}`;
  const el = document.createElement('div');
  el.className = `combobox ${className}`;
  el.dataset.cboxId = id;
  el.innerHTML = `
    <input class="combobox-input" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" placeholder="${escapeHtml(placeholder)}" data-cbox-input autocomplete="off">
    <button class="combobox-toggle" type="button" tabindex="-1" aria-label="Ouvrir la liste">▾</button>
    <div class="combobox-dropdown" data-cbox-dropdown role="listbox" hidden></div>
  `;

  const input = el.querySelector('[data-cbox-input]');
  const dropdown = el.querySelector('[data-cbox-dropdown]');
  const toggle = el.querySelector('.combobox-toggle');
  if (name) input.name = name;

  let state = {
    groups: normalizeGroups(groups),
    value,
    filter: '',
    open: false,
    activeIdx: -1
  };

  function normalizeGroups(gs) {
    return (gs || []).map(g => ({
      label: g.label,
      items: (g.items || []).map(it => ({
        value: String(it.value),
        label: String(it.label || ''),
        tag: it.tag || ''
      }))
    })).filter(g => g.items.length > 0);
  }

  function findItemByValue(v) {
    for (const g of state.groups) for (const it of g.items) if (it.value === String(v)) return it;
    return null;
  }

  function refreshInputText() {
    if (state.open) return;   // filtre en cours, ne pas écraser
    const it = findItemByValue(state.value);
    input.value = it ? formatOptionLabel(it) : '';
  }

  function formatOptionLabel(it) {
    return it.tag ? `${it.tag}  ${it.label}` : it.label;
  }

  function renderDropdown() {
    const f = state.filter.trim().toLowerCase();
    const html = [];
    let flatIdx = 0;
    let anyMatch = false;
    state.groups.forEach(g => {
      const matches = g.items.filter(it =>
        !f || it.label.toLowerCase().includes(f) || (it.tag && it.tag.toLowerCase().includes(f))
      );
      if (matches.length === 0) return;
      anyMatch = true;
      html.push(`<div class="combobox-group-title">${escapeHtml(g.label)}</div>`);
      matches.forEach(it => {
        const active = flatIdx === state.activeIdx ? ' combobox-option-active' : '';
        const selected = it.value === String(state.value) ? ' combobox-option-selected' : '';
        html.push(`<div class="combobox-option${active}${selected}" role="option" data-cbox-value="${escapeHtml(it.value)}" data-cbox-idx="${flatIdx}">
          <span class="combobox-tag">${it.tag || ''}</span>
          <span class="combobox-label">${highlight(it.label, f)}</span>
        </div>`);
        flatIdx++;
      });
    });
    if (!anyMatch) {
      html.push(`<div class="combobox-empty">Aucun résultat pour « ${escapeHtml(state.filter)} »</div>`);
    }
    dropdown.innerHTML = html.join('');
  }

  function highlight(text, term) {
    if (!term) return escapeHtml(text);
    const t = text.toLowerCase();
    const i = t.indexOf(term);
    if (i < 0) return escapeHtml(text);
    return escapeHtml(text.substring(0, i))
      + '<mark>' + escapeHtml(text.substring(i, i + term.length)) + '</mark>'
      + escapeHtml(text.substring(i + term.length));
  }

  function flatItems() {
    const f = state.filter.trim().toLowerCase();
    const out = [];
    state.groups.forEach(g => {
      g.items.forEach(it => {
        if (!f || it.label.toLowerCase().includes(f) || (it.tag && it.tag.toLowerCase().includes(f))) out.push(it);
      });
    });
    return out;
  }

  function openDropdown() {
    if (state.open) return;
    state.open = true;
    state.filter = '';
    state.activeIdx = -1;
    input.value = '';
    input.setAttribute('aria-expanded', 'true');
    dropdown.hidden = false;
    renderDropdown();
  }

  function closeDropdown() {
    if (!state.open) return;
    state.open = false;
    state.activeIdx = -1;
    input.setAttribute('aria-expanded', 'false');
    dropdown.hidden = true;
    refreshInputText();
  }

  function selectValue(v) {
    if (v === state.value) { closeDropdown(); return; }
    state.value = String(v);
    closeDropdown();
    onChange(state.value);
  }

  // === Handlers ============================================================
  input.addEventListener('focus', openDropdown);
  input.addEventListener('click', openDropdown);
  toggle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (state.open) closeDropdown();
    else {
      // Reset explicite du filtre pour toujours afficher toutes les options
      // à l'ouverture par toggle (bug UX detected par testing agent 2026-02).
      state.filter = '';
      input.value = '';
      input.focus();
    }
  });
  input.addEventListener('input', () => {
    state.filter = input.value;
    state.activeIdx = 0;
    renderDropdown();
  });
  input.addEventListener('keydown', (e) => {
    const items = flatItems();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!state.open) { openDropdown(); return; }
      state.activeIdx = Math.min(items.length - 1, state.activeIdx + 1);
      renderDropdown();
      scrollActiveIntoView();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      state.activeIdx = Math.max(0, state.activeIdx - 1);
      renderDropdown();
      scrollActiveIntoView();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (state.activeIdx >= 0 && items[state.activeIdx]) {
        selectValue(items[state.activeIdx].value);
      }
    } else if (e.key === 'Escape') {
      closeDropdown();
    }
  });
  dropdown.addEventListener('mousedown', (e) => {
    const opt = e.target.closest('.combobox-option');
    if (!opt) return;
    e.preventDefault();
    selectValue(opt.dataset.cboxValue);
  });
  // Fermer sur click extérieur
  document.addEventListener('mousedown', (e) => {
    if (!el.contains(e.target)) closeDropdown();
  });

  function scrollActiveIntoView() {
    const active = dropdown.querySelector('.combobox-option-active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  // === API publique ========================================================
  refreshInputText();

  return {
    el,
    setValue(v) { state.value = String(v || ''); refreshInputText(); },
    getValue() { return state.value; },
    setGroups(gs) {
      state.groups = normalizeGroups(gs);
      if (state.open) renderDropdown();
      else refreshInputText();
    },
    focus() { input.focus(); },
    destroy() { el.remove(); }
  };
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
