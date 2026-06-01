# SPARTA field deploy package

This folder is the clean static web app for deployment.

## Files included

- `index.html`
- `styles.css`
- `app.js`
- `supabase-config.js`
- `assets/`
- `vercel.json`

## Deploy through Vercel

1. Open https://vercel.com
2. Sign in with GitHub, Google, or email.
3. Create a new project.
4. Upload/import this folder: `deploy/sparta-field`.
5. Framework preset: `Other`.
6. Build command: leave empty.
7. Output directory: leave empty.
8. Deploy.

After deploy, open the Vercel URL on phone and desktop.

## Supabase

The app uses the public Supabase publishable key in `supabase-config.js`.
Do not put `service_role` keys into this frontend app.
