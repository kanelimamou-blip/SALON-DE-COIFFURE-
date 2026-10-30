# Tests de bout en bout

Parcours complet (patron, client, coiffeur) sur les émulateurs Firebase, avec les vraies règles `../firestore.rules`. Rien n'est écrit dans le vrai projet.

```
cd tests && npm install
npm run emulateurs                           # terminal 1 (Java requis)
cd ../docs && python3 -m http.server 8765    # terminal 2
cd tests && npm test                         # terminal 3
```
