# Hybrid Forge

Web app personnelle de gestion d'entraînement pour athlète hybride : course à pied, musculation, WOD type CrossFit et mobilité.

**App :** https://julodurden.github.io/hybrid-forge/

## Principes

- **Plusieurs sources, un seul endroit** : séances Garmin Connect (Forerunner 965) et Apple Watch / Fitness+ (via HealthFit) remontent automatiquement.
- **Bibliothèque de mouvements large**, chaque mouvement relié automatiquement à son équivalent dans le catalogue Garmin (1 527 exercices), pour créer des séances sur la montre sans retouche.
- **Programmation long terme** : macrocycles, semaines A/B, contrôles de charge, générateur de séances (échauffement, bloc principal, cooldown).
- **WOD** : WOD du jour CrossFit.com, benchmarks, créateur EMOM / AMRAP / For Time, scaling automatique.

## Architecture

| Élément | Où |
|---|---|
| App (ce repo, public, sans aucune donnée personnelle) | GitHub Pages |
| Données + synchros (repo privé `hybrid-forge-data`) | GitHub Actions planifiées |
| Accès de l'app aux données | API GitHub, jeton fine-grained limité au repo privé, stocké sur l'appareil |

## Développement

```bash
npm install
npm run dev
```

## Crédits

- Fiches mouvements et images : [free-exercise-db](https://github.com/yuhonas/free-exercise-db) (Unlicense).
- Vidéos de démonstration : lecteur YouTube intégré des vidéos de [CrossFit.com](https://www.crossfit.com/crossfit-movements) (liens uniquement, aucune vidéo copiée).
- Schéma des muscles : [react-body-highlighter](https://github.com/GV79/react-body-highlighter) (MIT).
- Catalogue d'exercices Garmin extrait de [python-garminconnect](https://github.com/cyberjunky/python-garminconnect) (MIT).
