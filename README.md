# Budget App

Static HTML/CSS/JS budget app shell using Firebase Authentication and GitHub Pages.

## Setup

1. Create a Firebase web app in your existing Firebase project.
2. Copy `firebase-config.example.js` to `firebase-config.js`.
3. Paste your Firebase config values into `firebase-config.js`.
4. In Firebase Authentication, enable Google sign-in.
5. Add your GitHub Pages domain to Firebase Authentication authorized domains.
6. Push to GitHub.
7. In GitHub repo Settings → Pages, choose **Deploy from a branch** and publish from `main` and `/root`.

## Local testing

Because this app uses ES modules, test it with a local server instead of opening the file directly.

Example:
- VS Code Live Server, or
- `python -m http.server 8080`

## Deploy URL

If your repository is named `budget-app`, your site URL will usually be:

`https://dennismzanetti.github.io/budget-app/`

Add `YOUR_USERNAME.github.io` to Firebase authorized domains.
