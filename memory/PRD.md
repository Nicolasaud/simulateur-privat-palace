# Simulateur Palace Comedy — Suivi développement

## Contexte
Outil interne de privatisation pour Palace Comedy : simulation de devis et facturation.
- **Stack** : HTML/JS vanilla (ESM modules) + Netlify Functions + Netlify Blobs
- **Auth** : code partagé scrypt + cookie de session HMAC
- **Repo** : https://github.com/Nicolasaud/simulateur-privat-palace
- **Prod** : https://privat-palacecomedy.netlify.app/
- **Copie de travail** : `/app/simulateur` (pour itérer sans toucher la prod)

## Architecture
- `public/` : frontend statique (index.html + js modulaire)
- `netlify/functions/` : serverless functions (CRUD via blobs)
- `netlify/lib/` : helpers partagés (auth-guard, session, blobs)

## Implémenté dans cette itération (2026-01)
- ✅ Page CRM avec consignes process commercial (7 étapes)
- ✅ CRUD prospects backend (`netlify/functions/crm.js`)
- ✅ Vue tableau filtrable (recherche, statut, source, type)
- ✅ Vue kanban avec drag & drop entre statuts
- ✅ Modal éditeur prospect (12 champs : société, contact, source,
   type évent, nb pers, date envisagée, budget, statut, relance, notes)
- ✅ Lien CRM → fiche devis : bouton "Créer fiche devis" pré-remplit
   le simulateur (société, email, tel, date, nom de fiche)
- ✅ Lien fiche → CRM : après save, le prospect mémorisé est lié
   automatiquement (fichesIds) + bascule auto en "devis_envoyé"
- ✅ Affichage des devis liés dans la fiche prospect (cliquables)
- ✅ Traçabilité : created_by/at, updated_by/at (depuis cookie session)

## Architecture nouvelles données
- Blob `crm/_index` : liste légère des prospects (pour table/kanban)
- Blob `crm/<id>` : prospect complet (avec notes, fichesIds…)
- Endpoint `/api/crm` (LIST) et `/api/crm/:id` (GET/PUT/DELETE)

## À faire (backlog)
- P1 : Tests sur Netlify Dev local (lance `netlify dev` côté user)
- P1 : Commit + push sur le repo GitHub user → déploiement Netlify auto
- P1 : Étape 4 refactor Items Libres — feature flag UI legacy ↔ libre + cross-validation A/B au runtime
- P1 : Étape 5 refactor Items Libres — bascule prod + suppression du code legacy (`calcul.js`, endpoints/UI obsolètes)
- P1 : Synchro GitHub `programmation` (fichiers `netlify/functions/programmation.js`, `public/js/programmation.js`) — repoussé à une session dédiée
- P2 : Export CSV de la liste prospects
- P2 : Statistiques CRM (taux de conversion par source/type évent)
- P2 : Rappels automatiques (alerte si dateProchainContact < today)
- P3 : Templates d'emails de qualification / relance

## Refactor Items Libres — Progrès
- ✅ Étape 1 (2026-01) — UI Bibliothèque libre + endpoints `categories` / `items-lib` / `formules-lib`
- ✅ Étape 2 (2026-01) — Items système publics (`sys_personnel`, `sys_frais_resa`)
- ✅ Étape 3 (2026-02) — Nouveau moteur `calcul-libre.js` reproduisant les 5 formules legacy
  - 7 items système "legacy" internes (spectacle, salle-seule, atelier-inter, atelier-mat, impro-inter, impro-particip, groupe-billet, user-resto-items)
  - Seed idempotent des 5 formules `fl_legacy_*` dans `formules-lib` au boot
  - UI biblio : formules legacy en lecture seule + badge 🔒 LEGACY
  - Script `scripts/test-libre-vs-legacy.js` : parité 100% confirmée sur les fiches valides (Nicolas 5775€, Cointreau CSE 3135.60€, AutoSync 4917.60€) — tolérance 0.01€
- ⏳ Étape 4 — feature flag UI (À faire)
- ⏳ Étape 5 — bascule prod + delete legacy (À faire)

## Fichiers clés Étape 3 (2026-02)
- `public/js/calcul-libre.js` — moteur pur (aucune lecture DOM/state) : `calculerFicheLibre(fiche, ctx)` → `{ lignes, totalHT, prixPers, ... }`
- `public/js/items-systeme.js` — étendu avec `LEGACY_SYSTEM_ITEMS` (constantes internes, non-seedés dans le blob items-lib pour éviter la pollution)
- `public/js/formules-lib-seed.js` — `LEGACY_FORMULES_LIB` + `seedLegacyFormulesLibIfMissing()`
- `public/js/bibliotheque-libre.js` — hook du seed + rendu spécial cartes legacy
- `public/styles/main.css` — styles `.bibFormuleLegacy` + `.bibLegacyBadge`
- `scripts/test-libre-vs-legacy.js` — comparateur libre ↔ snapshot legacy sur toutes les fiches


## Notes techniques
- Le module `crm.js` réutilise les patterns de `fiches.js` (index léger
  + fetch complet à la demande)
- L'import dynamique de `fiches.js` dans `crm.js::openFicheFromCrm()`
  évite les cycles d'import (les deux modules se référencent mutuellement)
- `window._pendingProspectLink` : variable globale temporaire pour passer
  le prospectId entre l'ouverture de la fiche et son save
