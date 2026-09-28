# Past seasons

One file per finished season (`season-YYYY.json`), saved once by
`scripts/fetch-history.js` during the daily ESPN update: teams, final ranks,
playoff seeds and every game's score. `scripts/build-record-book.js` combines
them with the current season into `data/current/record-book.json`.

Managers are linked across seasons by a short hash of their ESPN account id;
no names or account details are stored. To re-fetch a season, delete its file.
