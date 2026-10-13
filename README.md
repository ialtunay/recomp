# Recomp Tracker

Appli de suivi alimentaire (PWA) : on coche ses repas, l'appli calcule les calories et
les protéines du jour et de la semaine, et suit le poids et le tour de taille.
Elle s'installe sur PC et téléphone, marche hors ligne et se synchronise via Supabase.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html`, `styles.css`, `app.js` | L'appli |
| `config.js` | **À remplir** : URL et clé de ton projet Supabase |
| `supabase.js` | Client Supabase (v2.45.4, licence MIT, copié pour marcher hors ligne) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installation et fonctionnement hors ligne |
| `supabase/schema.sql` | Table, règles de sécurité et temps réel, à lancer une fois dans Supabase |

## Installation

### 1. Créer la base Supabase
1. Crée un compte sur [supabase.com](https://supabase.com) (le plus simple : « Continue with GitHub »).
2. **New project** : nom `recomp`, génère un mot de passe de base de données (garde-le), région **Europe (Paris ou Frankfurt)**, offre **Free**. Attends 1 à 2 minutes.
3. Menu **SQL Editor** > **New query** : colle tout le contenu de `supabase/schema.sql`, puis **Run**. Tu dois voir « Success. No rows returned ».

### 2. Relier l'appli à ta base
1. Dans Supabase, bouton **Connect** en haut (ou **Project Settings > API**). Copie la **Project URL** et la clé **anon** (ou **publishable**, qui commence par `sb_publishable_`).
2. Ouvre `config.js` avec un éditeur de texte et remplace les deux valeurs.

La clé anon/publishable est faite pour être publique : les règles de sécurité (RLS)
font que chaque compte ne voit que ses propres données. Ne mets **jamais** la clé
`service_role` / `secret` dans l'appli.

### 3. Mettre l'appli en ligne avec GitHub Pages
1. Sur GitHub : **New repository**, nom `recomp`, **Public**, puis **Create repository**.
2. Clique sur **uploading an existing file** et glisse **tout le contenu** du dossier (fichiers + dossiers `icons` et `supabase`). **Commit changes**.
3. **Settings > Pages** : Source **Deploy from a branch**, branche **main**, dossier **/ (root)**, **Save**.
4. Après 1 à 2 minutes, l'appli est sur `https://TON-PSEUDO.github.io/recomp/`.

### 4. Autoriser l'adresse de l'appli dans Supabase
**Authentication > URL Configuration** : mets `https://TON-PSEUDO.github.io/recomp/`
dans **Site URL** et ajoute-la dans **Redirect URLs**. C'est là que mène le lien de
l'e-mail de confirmation.

### 5. Créer ton compte
1. Ouvre l'appli, **Première fois ? Créer un compte**, confirme avec le lien reçu par e-mail, puis connecte-toi.
2. La liste d'aliments et les objectifs (2 200 kcal, 160 g) sont créés automatiquement.
3. Pour récupérer tes premiers jours : onglet **Aliments > Sauvegarde > Importer**, et choisis `recomp-import-12-13-octobre.json`.
4. Ensuite, dans Supabase : **Authentication > Sign In / Providers**, désactive **Allow new users to sign up**. Personne d'autre ne pourra créer de compte sur ton appli.

### 6. Installer sur tes appareils
- **PC (Chrome ou Edge)** : icône « Installer » à droite de la barre d'adresse.
- **iPhone (Safari)** : Partager > **Sur l'écran d'accueil**.
- **Android (Chrome)** : menu ⋮ > **Installer l'application**.

Connecte-toi une fois sur chaque appareil. Une modification sur l'un apparaît sur
l'autre en quelques secondes. Hors ligne, tout reste utilisable et se synchronise
au retour du réseau.

## À savoir
- **Mise en veille Supabase** : un projet gratuit sans aucune activité pendant 7 jours est mis en pause. Si tu utilises l'appli tous les jours, ça n'arrive pas. Si c'est le cas, va sur le tableau de bord Supabase et clique sur **Restore project**.
- **Sauvegarde** : de temps en temps, **Aliments > Sauvegarde > Exporter** pour garder une copie de tes données.
- **Modifier le code** : modifie le fichier sur GitHub (icône crayon), puis augmente `VERSION` dans `sw.js` (ex. `recomp-v2`) pour que les appareils récupèrent la nouvelle version.

## Données
Une seule table `docs` (`user_id`, `path`, `data` en JSON) :
`foods/<id>`, `days/<AAAA-MM-JJ>`, `weeks/<lundi>`, `settings/main`.
