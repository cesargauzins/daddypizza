# Daddy Pizz'IMT

Site de vente de pizzas : les clients choisissent leurs pizzas et un créneau de retrait, sans compte. L'admin crée les pizzas et les ventes, et suit les commandes en direct.

En ligne sur **https://daddypizza.sudoo.fr**

## Fonctionnement

- **`/`** : la vente en cours (pizzas, stock restant, créneaux libres). Mise à jour toutes les 4 secondes.
- **`/<code secret>`** : l'espace admin. Il n'y a pas de page `/admin`. Toute adresse inconnue affiche `404.html`, qui demande au serveur si le chemin correspond au code secret. Si oui, elle affiche la connexion ; sinon, une page introuvable.

## Stack

- Front statique (HTML, CSS, JS, sans build) hébergé sur GitHub Pages.
- Données dans [Supabase](https://supabase.com) (Postgres). Le navigateur n'a accès à aucune table : il n'appelle que les fonctions de [`supabase/schema.sql`](supabase/schema.sql). Le stock et les places sont vérifiés côté serveur, sous verrou.
- Le mot de passe admin et le code secret ne sont **pas** dans ce dépôt. Ils sont stockés hachés (bcrypt) dans la table `pizza_admin`. La connexion donne un jeton de session valable 30 jours. Après 10 échecs en 15 minutes, la connexion est bloquée pendant 15 minutes.

## Installation

1. Dans Supabase → **SQL Editor**, coller le contenu de `supabase/schema.sql`, puis cliquer sur **Run**.
2. Toujours dans le SQL Editor, définir le mot de passe et le code secret (la requête est en tête de `schema.sql`). Ne jamais committer cette requête une fois remplie.
3. Dans `config.js`, mettre l'URL du projet et la clé publique (`publishable`).
4. GitHub → **Settings → Pages** : source *Deploy from a branch*, `main` / `root`.
5. Chez le registrar de sudoo.fr, ajouter un enregistrement DNS `CNAME` : `daddypizza` → `cesargauzins.github.io`.

## En local

```sh
npx serve .
```
