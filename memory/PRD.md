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
- P2 : Export CSV de la liste prospects
- P2 : Statistiques CRM (taux de conversion par source/type évent)
- P2 : Rappels automatiques (alerte si dateProchainContact < today)
- P3 : Templates d'emails de qualification / relance

## Notes techniques
- Le module `crm.js` réutilise les patterns de `fiches.js` (index léger
  + fetch complet à la demande)
- L'import dynamique de `fiches.js` dans `crm.js::openFicheFromCrm()`
  évite les cycles d'import (les deux modules se référencent mutuellement)
- `window._pendingProspectLink` : variable globale temporaire pour passer
  le prospectId entre l'ouverture de la fiche et son save
