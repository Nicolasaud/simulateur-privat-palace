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

## Implémenté 2026-02 — Simulateur : nettoyage UX (fiche vierge + biblio)
- ✅ **Nouvelle fiche = 0 €** : plus d'items par défaut (Apéritif/Plat/Dessert/Boissons), plus de fallback `typeId: 'privat-full'` qui ramenait les briques auto (Spectacle/Personnel/Frais résa)
- ✅ Nouveau bloc "+ Ajouter une formule" : idem, part de zéro
- ✅ Suppression du sélecteur **"Rendu comme"** dans la Bibliothèque de formules (héritage de typeId legacy, source de confusion). Les formules existantes conservent leur `_typeIdRendu`; les nouvelles n'en ont plus besoin.
- ✅ Colonne **TVA élargie** dans la Bibliothèque d'items (110px → 150px)
- ✅ Alertes de marge (< 50% plancher, < 60% objectif) silencieuses si `totalHT === 0` — évite le bruit sur une fiche vide
- ✅ Benchmark Fiche Nicolas préservé (5 775,00 € HT / 115,50 €/pers)
- ✅ Section « Items restauration » renommée en « Items » dans chaque bloc
- ✅ Nouvelle colonne « Mode » sur chaque item du bloc : `× nb pers` (variable) ou `Fixe`
  - Défaut : `× nb pers` (préserve le benchmark Fiche Nicolas 5 775 € HT)
  - En mode Fixe : coût/prix sont des totaux indépendants du nb pers
- ✅ Layout item en carte 2 lignes (libellé + delete au-dessus, coût/prix/tva/mode en dessous) — libellé bien lisible même dans la sidebar
- ✅ Encart « ⚡ Briques auto incluses dans la formule » listant les briques système (Spectacle, Personnel, Frais résa) — non-éditables, info transparence
- ✅ Champ `mode: 'perPers'|'unit'` ajouté aux items nouveaux (bouton "+ Vide" et import BDD)
- ✅ TVA select élargi aux 4 catégories (Resto 10%, Bar 20%, Presta 20%, Spec 5,5%)
- ✅ Moteur `items-systeme.js#user_resto_items` respecte `it.mode`
- ✅ **Bibliothèque d'items — colonne Mode** ajoutée (perPers/unit) : chaque item du catalogue peut être toggle Fixe / × nb pers dès sa création
- ✅ **Matérialisation** : quand une formule libre est sélectionnée dans une fiche, ses items non-système (ex : « Accueil café ») sont copiés dans `bloc.items[]` avec leur `mode` — ils deviennent éditables et le toggle Fixe/Variable fonctionne directement dans le devis
- ✅ Anti-double-comptage : le moteur `calcul-libre.js` skip les itemIds déjà matérialisés (via `bloc.materializedItemIds`) et ajoute virtuellement `sys_user_resto_items` si besoin
- ✅ Recap « Autres lignes issues de la formule » filtre les items déjà matérialisés (ne montre que les briques ⚡ système)
- ✅ Benchmark Fiche Nicolas 5 775,00 € HT / 115,50 €/pers préservé (test-fiche-nicolas.js vert)
- ✅ Test e2e complet : Accueil café (5 €/pers, TVA prestation, × nb pers, 30 pers) → 150 € HT correctement calculé

## Architecture nouvelles données
- Blob `crm/_index` : liste légère des prospects (pour table/kanban)
- Blob `crm/<id>` : prospect complet (avec notes, fichesIds…)
- Endpoint `/api/crm` (LIST) et `/api/crm/:id` (GET/PUT/DELETE)

## À faire (backlog)
- P1 : Tests sur Netlify Dev local (lance `netlify dev` côté user)
- P1 : Commit + push sur le repo GitHub user → déploiement Netlify auto
- P1 : Synchro GitHub `programmation` (fichiers `netlify/functions/programmation.js`, `public/js/programmation.js`) — repoussé à une session dédiée
- P2 : Widget "Top formules vendues ce mois-ci" dans le dashboard accueil (agrégat `bloc.formuleLibId` sur les fiches acceptées/facturées)
- P3 : Programmateur d'emails (envoi direct via Mailto ou intégration SMTP future)
- P2 : Export CSV de la liste prospects
- P2 : Statistiques CRM (taux de conversion par source/type évent)
- P2 : Rappels automatiques (alerte si dateProchainContact < today)
- P3 : Templates d'emails de qualification / relance

## Refonte UI Post-Refactor (2026-02) — Bugs utilisateur ✅
Correctifs suite aux retours de Nicolas (session actuelle) :
- ✅ CRM statuts complets : 7 statuts au lieu de 5 (À contacter, En discussion, Devis envoyé, Gagné, **Acompte facturé**, **Facture soldée**, Perdu) — visibles dans le filtre toolbar, les colonnes Kanban et la modale d'édition prospect
- ✅ Helpers `isStatutGagne` / `isStatutClos` : les 2 nouveaux statuts comptent comme "gagnés" pour les stats de conversion, et ne déclenchent pas de rappels
- ✅ Suppression totale des 5 formules legacy `fl_legacy_*` de l'UI Bibliothèque : filtre `!_builtIn` dans `renderFormules()` + purge cloud one-shot au boot via `purgeLegacyFormulesLibFromCloud()` + `seedLegacyFormulesLibIfMissing()` devenu no-op
- ✅ Rétro-compat invisible : le moteur libre garde `LEGACY_FORMULES_LIB` en fallback interne (constantes JS), Nicolas 5775€ intact
- ✅ Onglet "Bibliothèque libre" renommé en "**Bibliothèque de formules**"
- ✅ Nouvel onglet "**Bibliothèque d'items**" créé (position 5 dans la barre) contenant : Catégories + Items + Base d'items restauration (ancienne) + Types internes (paramètres système)
- ✅ Suppression des 2 sections `<details>` du Simulateur : "Base d'items restauration — bibliothèque réutilisable" + "Bibliothèque & paramètres de formules"
- ✅ Sélecteur formule du bloc simulateur épuré : uniquement `state.bibFormules.filter(!_builtIn)`, plus de groupe "Formules classiques" V2. Rétro-compat : si `bloc.formuleId` pointe vers un fp_xxx historique, une option "🔒 Formule héritée" est injectée en tête du dropdown
- ✅ Bug UX combobox résolu : clic sur toggle ▾ force reset du filtre → toutes les options visibles

Validation testing_agent (iteration_1.json) : **11/11 scénarios frontend PASS**.
Benchmark Nicolas : **5 775,00 € HT / 115,50 €/pers / 2 875,00 € marge / 49,8% taux** — intact.

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
- ✅ Étape 7bis (2026-02) — Guide onboarding Bibliothèque libre
  - Nouveau module `onboarding.js` : modale 5 slides (Bienvenue → Items → Formules → Templates → Simulateur)
  - Animation entrée/sortie, navigation clavier (← → Esc), progression via dots cliquables
  - Auto-affichage au premier accès (localStorage `palace_biblib_onboarding_seen`)
  - Bouton "❓ Guide" toujours accessible en haut de la biblio pour ré-ouvrir
- ✅ Étape 8 (2026-02) — CRM : Export CSV + Stats + Rappels en retard + Templates emails
  - **8a Export CSV** : bouton "📥 Export CSV" génère `crm-prospects-YYYY-MM-DD.csv` avec 14 colonnes (BOM UTF-8 pour Excel, séparateur `;`)
  - **8b Stats CRM** : card dépliable "📊 Statistiques CRM" avec 2 KPIs (prospects total, taux global colorisé) + 2 blocs (taux par source, taux par type événement) avec barres de progression vertes/oranges/rouges
  - **8c Rappels en retard** : `renderCrmTodoSemaine()` détecte les prospects avec `dateProchainContact < today` (hors gagnés/perdus) → bandeau rouge "⚠️ N relances en retard" + liste avec pastille 🔴 et libellé "il y a Xj"
  - **8d Templates emails** : bouton "📧 Copier email…" dans l'éditeur prospect ouvre menu de 4 templates (🎯 Qualification, ⏰ Relance J+7, ✅ Confirmation post-signature, 💐 Remerciement post-événement) — placeholders `{societe}` `{contactPrenom_slot}` `{dateEvent}` `{nbPersonnes}` substitués — copie automatique dans le presse-papiers via `navigator.clipboard.writeText()`

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
