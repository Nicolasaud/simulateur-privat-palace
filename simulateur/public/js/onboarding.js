// Guide onboarding "Bibliothèque libre" — 5 slides intégrées à la biblio.
// S'affiche automatiquement au premier accès (localStorage tracking).
// Réouvrable via le bouton "❓ Guide" en haut de la Bibliothèque.

const STORAGE_KEY = 'palace_biblib_onboarding_seen';

const SLIDES = [
  {
    icon: '🧰',
    title: 'Bienvenue dans la Bibliothèque libre',
    body: `<p>Cette bibliothèque est ton <strong>catalogue produit</strong> :
    à partir d'ici tu peux composer <strong>toutes les offres commerciales</strong>
    du Palace, sans passer par un développeur.</p>
    <p>Le simulateur va lire cette biblio pour calculer chaque devis.
    C'est ton nouveau super-pouvoir 🚀</p>`
  },
  {
    icon: '⚡',
    title: 'Les Items : tes briques',
    body: `<p>Un <strong>item</strong> = une prestation unitaire (une entrée, un plat, un cocktail, une animation…).
    Chaque item porte :</p>
    <ul>
      <li>💰 Un <strong>coût HT</strong> (ce que ça te coûte)</li>
      <li>💵 Un <strong>prix HT</strong> (ce que tu factures)</li>
      <li>📊 Une <strong>TVA</strong> (spectacle / resto / bar / prestation)</li>
    </ul>
    <p><em>Les items ⚡ "auto" (personnel, frais résa) sont calculés en fiche selon les params.</em></p>`
  },
  {
    icon: '🧩',
    title: 'Les Formules composables',
    body: `<p>Une <strong>formule</strong> = liste ordonnée d'items assemblés pour créer une offre.</p>
    <p>Exemple : <em>"Anniversaire cocktail"</em> = Spectacle + Personnel + Items resto + Frais réservation.</p>
    <p>Chaque formule custom peut recevoir :</p>
    <ul>
      <li>🏷️ Un <strong>tag visuel</strong> (💼 corporate, 🎂 anniv, 🍸 team-building…)</li>
      <li>🎯 Un <strong>type de rendu</strong> (couverture, alertes, plafonds hérités)</li>
    </ul>`
  },
  {
    icon: '🧪',
    title: 'Démarre en 1 clic avec les Templates',
    body: `<p>4 formules pré-configurées disponibles pour te lancer :</p>
    <ul>
      <li>💼 Séminaire corporate journée</li>
      <li>🎂 Anniversaire cocktail dînatoire</li>
      <li>🎬 Team-building impro + apéro</li>
      <li>🥂 Cocktail apéritif entreprise (2h)</li>
    </ul>
    <p>Clic sur <strong>« 🧪 Créer depuis un template »</strong> → donne un nom → c'est prêt à personnaliser 🎉</p>`
  },
  {
    icon: '✨',
    title: 'Dans le Simulateur',
    body: `<p>Toutes tes formules apparaissent dans la <strong>combobox filtrable</strong> du bloc de fiche.</p>
    <ul>
      <li>⌨️ Tape 2 lettres → filtre live avec surlignage</li>
      <li>⬆️⬇️ Navigation clavier</li>
      <li>📂 Regroupées par "Classiques" ou "🧩 Composables"</li>
    </ul>
    <p style="margin-top:14px;padding:10px;background:rgba(16,185,129,0.1);border-radius:8px">
    <strong>💡 Astuce commerciale</strong> — Crée une formule par "persona client" (💼 CSE parisien, 🎂 anniv 40 ans…) 
    pour retrouver ton offre en 3 secondes lors d'un appel prospect.</p>`
  }
];

export function hasSeenOnboarding() {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}

export function markOnboardingSeen() {
  try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* silencieux */ }
}

export function resetOnboarding() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* silencieux */ }
}

let currentSlide = 0;
let overlay = null;

export function showOnboarding(forceOpen = false) {
  if (!forceOpen && hasSeenOnboarding()) return;
  currentSlide = 0;
  buildOverlay();
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('visible'));
  document.addEventListener('keydown', onKey);
}

function closeOnboarding() {
  markOnboardingSeen();
  if (!overlay) return;
  overlay.classList.remove('visible');
  document.removeEventListener('keydown', onKey);
  setTimeout(() => {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
  }, 250);
}

function onKey(e) {
  if (e.key === 'Escape') closeOnboarding();
  else if (e.key === 'ArrowRight') nextSlide();
  else if (e.key === 'ArrowLeft') prevSlide();
}

function nextSlide() {
  if (currentSlide < SLIDES.length - 1) {
    currentSlide++;
    renderSlide();
  } else {
    closeOnboarding();
  }
}

function prevSlide() {
  if (currentSlide > 0) {
    currentSlide--;
    renderSlide();
  }
}

function buildOverlay() {
  overlay = document.createElement('div');
  overlay.className = 'obOverlay';
  overlay.innerHTML = `
    <div class="obDialog" role="dialog" aria-labelledby="obTitle">
      <button class="obClose" aria-label="Fermer" title="Passer">×</button>
      <div class="obSlide" data-slide-content></div>
      <div class="obFooter">
        <div class="obDots" data-dots></div>
        <div class="obButtons">
          <button class="obBtn secondary" data-prev>← Précédent</button>
          <button class="obBtn primary" data-next>Suivant →</button>
        </div>
      </div>
    </div>
  `;
  overlay.querySelector('.obClose').addEventListener('click', closeOnboarding);
  overlay.querySelector('[data-prev]').addEventListener('click', prevSlide);
  overlay.querySelector('[data-next]').addEventListener('click', nextSlide);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOnboarding(); });
  renderSlide();
}

function renderSlide() {
  if (!overlay) return;
  const s = SLIDES[currentSlide];
  const slot = overlay.querySelector('[data-slide-content]');
  slot.innerHTML = `
    <div class="obIcon">${s.icon}</div>
    <h2 id="obTitle">${s.title}</h2>
    <div class="obBody">${s.body}</div>
  `;
  // Progress dots
  const dots = overlay.querySelector('[data-dots]');
  dots.innerHTML = SLIDES.map((_, i) =>
    `<span class="obDot ${i === currentSlide ? 'active' : ''} ${i < currentSlide ? 'past' : ''}" data-slide-goto="${i}"></span>`
  ).join('');
  dots.querySelectorAll('.obDot').forEach(d => {
    d.addEventListener('click', () => {
      currentSlide = parseInt(d.dataset.slideGoto);
      renderSlide();
    });
  });
  // Boutons prev/next
  overlay.querySelector('[data-prev]').disabled = currentSlide === 0;
  overlay.querySelector('[data-next]').textContent =
    currentSlide === SLIDES.length - 1 ? '🚀 J\'ai compris !' : 'Suivant →';
}
