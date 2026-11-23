# Relay

Relay est un launcher desktop Windows pour regrouper une bibliothèque de jeux locale dans une interface unique. Le projet est construit avec Electron, React, TypeScript, Vite, Tailwind CSS, Lucide et SQLite/WASM.

## État des fonctionnalités

- **Bibliothèque persistante** : SQLite est stocké dans le dossier de données utilisateur Electron. Favoris, préférences et historique de lancements sont conservés localement.
- **Steam (détection et jeux installés)** : recherche du chemin Steam dans le registre Windows et les emplacements habituels, lecture de `libraryfolders.vdf` et des manifestes `appmanifest_*.acf` sur tous les volumes déclarés.
- **Jeux possédés Steam** : import optionnel via `IPlayerService/GetOwnedGames` de la Steam Web API. Le profil doit être visible et les identifiants configurés dans Paramètres.
- **Epic Games** : détection des jeux installés à partir des manifestes officiels du launcher, contrôle du dossier et de l’exécutable, puis lancement via le protocole `com.epicgames.launcher`. L’import Epic couvre les jeux installés présents localement, pas l’ensemble des jeux possédés.
- **Riot Games** : lecture de `RiotClientInstalls.json` et import de League of Legends, VALORANT et 2XKO lorsque leurs exécutables correspondent aux chemins déclarés. Les jeux sont lancés par le protocole officiel `riotclient://`; Relay n’exécute pas directement les fichiers du manifeste.
- **Jeux locaux** : glissez le fichier `.exe` qui lance le jeu dans **Jeux locaux**, ou choisissez-le avec le bouton dédié. Le nom du jeu est basé sur le nom de l’exécutable. Pour son illustration, Relay recherche d’abord sur IGDB à partir de ce nom (en tenant compte des suffixes Windows courants, des noms alternatifs IGDB et des différences d’espacement), puis essaie une correspondance exacte sur Steam. Si aucune jaquette n’est trouvée, l’icône Windows intégrée à l’exécutable sert de visuel de secours. Configurez IGDB dans Paramètres avec les identifiants de votre application Twitch, chiffrés localement avec `safeStorage`. Depuis la fiche du jeu, **Actualiser les illustrations** relance la recherche. Le lancement vérifie de nouveau que le fichier existe toujours dans son dossier. Vous pouvez retirer le jeu de Relay après confirmation; ses fichiers sur le disque ne sont jamais supprimés.
- **Illustrations Riot** : jaquette VALORANT au format portrait pour les cartes et key art horizontal fournis par l’utilisateur; les images de League of Legends et 2XKO sont téléchargées depuis les sites de Riot et mises en cache localement. Les formats JPEG, PNG et WebP des images téléchargées sont contrôlés avant affichage.
- **Lancement** : les jeux Steam installés utilisent `steam://run/<appid>`; les jeux importés non installés ouvrent la méthode officielle `steam://install/<appid>`. Pour les jeux locaux, seul le fichier `.exe` sélectionné lors de l’import peut être lancé depuis son dossier.
- **Illustrations** : recherche à la demande dans plusieurs variantes du CDN Steam, puis utilisation des images de couverture, d’en-tête et d’arrière-plan publiées par la Steam Store API. Pour Epic, Relay privilégie les visuels officiels présents dans le cache de catalogue local du launcher, associés à l’identifiant Epic exact; à défaut, les correspondances Steam puis IGDB sont tentées. IGDB utilise l’API Twitch, nécessite un Client ID et un Client Secret fournis par l’utilisateur et est prévu pour un usage non commercial. Les résultats sont mis en cache localement; les jeux sans image correspondante conservent un visuel neutre jusqu’à actualisation.
- **Logos** : icônes SVG locales intégrées aux menus et badges de plateformes. Les marques appartiennent à leurs propriétaires respectifs; plusieurs icônes sont issues de Simple Icons (CC0).
- **Sécurité** : fenêtre avec `contextIsolation`, `sandbox` et `nodeIntegration: false`; API preload limitée; validation IPC; identifiants Steam et Twitch/IGDB chiffrés par `safeStorage` et jamais transmis à React.
- **Gestion des jeux** : fiche détaillée (tiroir latéral) et menu contextuel (clic droit) pour lancer, mettre en favori, **renommer** (le nom d’origine reste récupérable), **masquer** (filtre « Masqués »), ouvrir le dossier d’installation, désinstaller via Steam (la confirmation est affichée par Steam) ou retirer un jeu local. Compteur de lancements et tri « Plus lancés ». Ajout de jeux locaux par glisser-déposer de un ou plusieurs `.exe` n’importe où dans la fenêtre, ou via **Ajouter un jeu**. Raccourcis : `Ctrl+K` (recherche), `Échap` (fermer la fiche).
- **Images et descriptions** : chaque jeu est d'abord *identifié* (jamais deviné) : identifiant Steam officiel pour Steam ; namespace du manifeste local + **egdata** pour Epic ; sinon nom identique via IGDB, egdata ou Steam. Les images viennent ensuite, dans l'ordre, du visuel officiel (Steam/Epic/Riot), d'egdata, de **SteamGridDB** (clé optionnelle) puis d'**IGDB**. La description (en français pour Steam) vient de Steam, d'egdata ou d'IGDB. Si rien n'est sûr, aucune image n'est inventée : la fiche du jeu permet de **corriger la correspondance** (recherche IGDB/Steam avec miniatures), de choisir sa propre jaquette/bannière (JPEG/PNG/WebP, 8 Mo max, prioritaires) ou d'ouvrir la page SteamDB. SteamDB n'ayant pas d'API publique, Relay utilise les mêmes données que lui (Steam Store et CDN Steam). Les anciennes images en cache (parfois erronées) sont supprimées au premier lancement.
- **Autres plateformes** : Xbox, Ubisoft Connect, EA app, GOG Galaxy et Battle.net restent visibles comme points d’extension; leur détection, leur import et leur lancement ne sont pas encore implémentés.

La déduplication assistée entre boutiques, la détection de l’exécution réelle d’un jeu et l’importation des bibliothèques Epic possédées mais non installées ne sont pas disponibles. Aucun jeu d’exemple n’est ajouté à la bibliothèque.

## Prérequis

- Windows 10/11 (la détection Steam est conçue pour Windows).
- Node.js 22 ou plus récent et npm.
- Steam installé pour tester l’import et le lancement des jeux Steam. Les jeux locaux ne nécessitent pas Steam.

## Installation et développement

```powershell
npm install
npm run dev
```

La commande lance Vite, compile les processus Electron et ouvre la fenêtre Relay. Le profil local reste dans le dossier `userData` historique (sous Windows, généralement `%APPDATA%\\nexora`) pour conserver les bibliothèques et paramètres créés avant le changement de nom.

## Bibliothèque Steam possédée (facultatif)

1. Rendez votre profil Steam et ses informations de jeux visibles pour l’API, selon les options de confidentialité Steam.
2. Créez une clé personnelle sur [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey).
3. Trouvez votre Steam ID 64 (17 chiffres).
4. Dans Relay, ouvrez **Paramètres → Steam**, puis enregistrez l’ID et la clé. La clé est chiffrée avec le stockage sécurisé fourni par Windows.
5. Cliquez sur **Synchroniser**. Sans clé, Relay importe uniquement les jeux dont les manifestes d’installation sont présents.

La clé n’est ni nécessaire pour l’import local ni stockée dans le dépôt. `.env.example` n’inclut aucune valeur secrète.

## Illustrations IGDB (facultatif)

1. Connectez-vous au [Twitch Developer Console](https://dev.twitch.tv/console/apps) avec un compte Twitch protégé par l’authentification à deux facteurs.
2. Créez une application de type **Confidential**. Utilisez `localhost` comme URL de redirection si le formulaire le requiert.
3. Copiez le **Client ID** et générez un **Client Secret**.
4. Dans Relay, ouvrez **Paramètres → IGDB**, saisissez les deux valeurs et choisissez **Vérifier et enregistrer**. Relay valide l’accès auprès de Twitch avant de chiffrer et enregistrer les identifiants sur cet ordinateur.

Les jeux locaux recherchent d’abord leur illustration sur IGDB à partir du nom de l’exécutable, de ses variantes normalisées et des noms alternatifs IGDB, puis tentent Steam. Les secrets ne sont jamais inclus dans l’application distribuée ni exposés au renderer. L’API IGDB est gratuite pour les usages non commerciaux selon les conditions Twitch.

## Commandes

| Commande | Description |
| --- | --- |
| `npm run dev` | Démarrer l’application desktop en développement |
| `npm run typecheck` | Vérifier TypeScript (renderer et Electron) |
| `npm run lint` | Lancer Oxlint |
| `npm test` | Lancer les tests unitaires des lecteurs de manifestes, illustrations et exécutables locaux |
| `npm run build` | Vérifier les types et construire l’interface + processus Electron |
| `npm run dist:win` | Produire l’installateur Windows NSIS dans `release/` |
| `npm run dist:portable` | Produire l’application Windows portable dans `release/` |
| `npm run release:win` | Construire et publier une GitHub Release Windows |

## Site de téléchargement

Le site statique se trouve dans `website/` et est destiné à être hébergé sur Vercel. Lors de l’import du dépôt dans Vercel, définissez `website` comme **Root Directory** et utilisez le preset **Other**; le site ne nécessite pas de commande de build. La configuration `website/vercel.json` active les URL propres (`/documentation`, `/support`, `/confidentialite`) sans suffixe `.html` ni barre oblique finale. Les pushs sur `main` déclenchent ensuite automatiquement un déploiement.

Le bouton de téléchargement récupère la dernière release publique et son installateur Windows depuis GitHub. Il reste indisponible jusqu’à la publication d’une première version NSIS. Pour publier une version, incrémentez `version` dans `package.json`, poussez un tag correspondant (par exemple `v0.1.1`) et le workflow `release.yml` construira et publiera l’installateur.

## Architecture

- `src/main/` — fenêtre sécurisée, IPC, persistance SQLite et service de cache des illustrations.
- `src/preload/` — surface IPC explicitement exposée au renderer.
- `src/renderer/` — interface React et styles.
- `src/platforms/steam/`, `src/platforms/epic/`, `src/platforms/riot/` et `src/platforms/igdb/` — lecture locale des manifestes ou appels API des intégrations.
- `src/platforms/local/` — validation des exécutables de jeux ajoutés manuellement.
- `src/assets/platforms/` — logos SVG locaux intégrés à l’interface.
- `src/shared/` — contrats de types partagés entre Electron et React.

## Limites et vérifications

Les tests automatisés couvrent les lecteurs de manifestes, les illustrations et les exécutables locaux. Le build de production vérifie TypeScript et Vite. Les installations NSIS sont destinées à l’auto-mise à jour; la version portable est distribuée séparément et ne reçoit pas les mises à jour automatiques intégrées. Un lancement de jeu dépend de Steam, du compte local et du jeu concerné : Relay ne peut pas confirmer que la fenêtre du jeu s’est effectivement ouverte; l’historique est enregistré après acceptation de l’URI de lancement par le système pour les jeux installés.

La synchronisation est répétable et met à jour les jeux Steam connus sans les supprimer quand Steam ou une source est indisponible. Les jeux ne sont jamais inventés ou regroupés simplement parce que leurs noms se ressemblent.
