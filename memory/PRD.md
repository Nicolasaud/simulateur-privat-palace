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
- P1 : Synchro GitHub `programmation` (fichiers `netlify/functions/programmation.js`, `public/js/programmation.js`) — repoussé à une session dédiée
- P2 : Onboarding équipe commerciale sur les formules composables (guide 5min visuel intégré à la biblio)
- P2 : Étape 8 CRM — Export CSV prospects, statistiques (taux conversion par source/type), rappels auto (alerte dateProchainContact < today), templates emails de qualification/relance
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
- ✅ Étape 4 (2026-02) — Feature flag UI + cross-validation A/B live
- ✅ Étape 5 (2026-02) — Bascule prod + suppression du code legacy
  - Fonction `calculerBloc()` legacy (~200 lignes de dispatch hardcodé) **supprimée** de `calcul.js`
  - Remplacée par un shim qui délègue au moteur libre bloc par bloc
  - Hook A/B + fonction `renderEngineBanner()` supprimés (plus utiles, tout est libre)
  - Section "⚙️ Moteur de calcul" retirée de la Bibliothèque libre
  - Fichier `public/js/engine-flag.js` supprimé complètement
  - CSS `.engineBanner` + `.engineToggleBox` retirés
  - `window.recalculNow` orphelin retiré de `main.js`
  - Bilan : **-427 lignes** au total (dont 271 dans calcul.js, soit -35%)
  - Le moteur est désormais 100% data-driven (items + formules libres)
  - Benchmark Nicolas 5775€ toujours OK + toutes les fiches produisent des résultats identiques à l'ancien snapshot legacy
- ✅ Étape 6 (2026-02) — Formules composables (hybrides) utilisateur
  - Sélecteur "Formule" du bloc enrichi avec un optgroup "🧩 Formules composables (Bibliothèque libre)" listant les formules libres non-legacy
  - Nouveau champ `bloc.formuleLibId` (persisté avec la fiche) pour référencer une formule libre
  - Handler `updateBlocField('formuleId')` détecte via préfixe `fl_` si l'ID pointe vers une formule libre ou une V2 classique
  - Le moteur libre utilise `formuleLibId` en priorité via `resolveFormuleLibForBloc`, fallback sur `_legacyTypeId`
  - `onglets.js` re-render `renderBlocs()` au retour sur l'onglet Simulateur (synchronise les nouvelles formules créées dans la biblio)
  - Test end-to-end : création "Combo Hybride" avec `sys_personnel` + `sys_frais_resa` → sélection dans un bloc → calcul correct (4917,60€ / 98,35€/p) — Nicolas 5775€ intact
- ✅ Étape 7 (2026-02) — Combobox filtrable + tags visuels + templates + typeIdRendu
  - Nouveau composant `combobox.js` (~200 lignes) : dropdown filtrable avec surlignage jaune des matches, navigation clavier (↑↓ Enter Esc), groupements + tags emoji par option
  - Sélecteur formule du bloc migré de `<select>` vers `<combobox>` — recherche live "impro" filtre à 1 option en 200ms
  - Tags visuels par formule : 💼 Corporate, 🎂 Anniversaire, 🍸 Team-building, 🎭 Show, 🏢 Séminaire, 🎬 Impro, 🥂 Cocktail, 🎉 Fête (mapping auto pour legacy via `TYPE_TAG_EMOJI`, éditable pour customs)
  - Nouveau champ `_typeIdRendu` sur formules libres custom → contrôle le comportement de rendu (couverture, alertes, plafonds capacité)
  - Section `bibFormuleConfig` (fond violet) dans chaque formule custom pour éditer tag + typeIdRendu
  - 4 templates pré-configurés dans la biblio : Séminaire corporate, Anniversaire cocktail, Team-building impro, Cocktail apéritif — 1 clic → formule créée avec items + tag + typeIdRendu pré-remplis
  - Message adaptatif dans les totaux : "Coûts calculés à la volée" si tous les items sont système, ou disclaimer "(hors items auto ⚡)" si mix
  - Test end-to-end : template "Team-building impro + apéro" → formule créée avec tag 🎬 + typeIdRendu `formation-impro` + 2 items → visible dans combobox du simulateur avec filtre "impro" fonctionnel

## Fichiers clés Étapes 3-5 (2026-02)
- `public/js/calcul-libre.js` — moteur pur (aucune lecture DOM/state)
- `public/js/calcul-libre-bridge.js` — pont runtime state → ctx pur + shims `calculerCurrentFicheLibre` & `calculerBlocLibreForCurrentFiche`
- `public/js/items-systeme.js` — `SYSTEM_ITEMS` publics + `LEGACY_SYSTEM_ITEMS` internes
- `public/js/formules-lib-seed.js` — `LEGACY_FORMULES_LIB` + `seedLegacyFormulesLibIfMissing()`
- `public/js/bibliotheque-libre.js` — CRUD biblio + rendu formules legacy en lecture seule
- `public/js/calcul.js` — rendu uniquement (KPIs, tableaux, alertes, couverture) + shim `calculerBloc()` de 3 lignes
- `scripts/test-libre-vs-legacy.js` — comparateur libre ↔ snapshot legacy (utilisé pour non-régression future)


## Notes techniques
- Le module `crm.js` réutilise les patterns de `fiches.js` (index léger
  + fetch complet à la demande)
- L'import dynamique de `fiches.js` dans `crm.js::openFicheFromCrm()`
  évite les cycles d'import (les deux modules se référencent mutuellement)
- `window._pendingProspectLink` : variable globale temporaire pour passer
  le prospectId entre l'ouverture de la fiche et son save
