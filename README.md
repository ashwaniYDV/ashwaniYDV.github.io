# ashwaniYDV.github.io

[Let's go to the website](https://ashwaniydv.github.io/)

React (Vite) rewrite of the original static site (still available on the `v1` branch). Same Solid State theme, same content.

## Develop

```sh
npm install
npm run dev      # local dev server
npm run build    # production build in dist/
npm run preview  # serve the built dist/ locally
```

## Editing content

All text, links and images live in `src/data.jsx`. Images are in `src/assets/images/`, theme CSS in `src/assets/css/`.

## Deploy

Every push to `master` builds and deploys via `.github/workflows/deploy.yml`.
One-time setup: repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
