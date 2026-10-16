# Offer Optimization Dashboard: going live

## 1. Put it on GitHub Pages

1. Create a new public repo, for example `offer-optimization-dashboard`.
2. Upload `index.html`, `styles.css`, `app.js` and `_headers`.
3. Settings > Pages > Deploy from branch > `main` > `/ (root)`.
4. It goes live at `https://conversionalchemy.github.io/offer-optimization-dashboard/`.

The dashboard works fully at this point. Numbers save in each person's own browser.

## 2. Switch on Google Drive saving (about 20 minutes, plus Google's review)

1. Go to https://console.cloud.google.com and create a project called "Conversion Alchemy Tools".
2. APIs & Services > Library > search "Google Drive API" > Enable.
3. APIs & Services > OAuth consent screen (Google Auth Platform):
   - User type: External.
   - App name: Offer Optimization Dashboard. Support email: yours. Logo: the Conversion Alchemy mark.
   - App domain / homepage: https://conversionalchemy.com
   - Privacy policy: a page on conversionalchemy.com saying the tool only saves to the user's own Google Drive, and only the files it creates. Google requires this link.
   - Authorised domains: `conversionalchemy.com` and `github.io`.
   - Scopes: add `https://www.googleapis.com/auth/drive.file` only. This lets the tool see files it created and nothing else in anyone's Drive.
4. APIs & Services > Credentials > Create credentials > OAuth client ID:
   - Application type: Web application.
   - Authorised JavaScript origins: `https://conversionalchemy.github.io`
   - Copy the Client ID it gives you.
5. In `app.js`, find `const DRIVE_CLIENT_ID = "";` and paste the Client ID between the quotes. Upload the changed `app.js`.
6. Back on the consent screen, click Publish App, then submit for brand verification. Because the tool only uses `drive.file`, this is the light review (usually a few days), not a security audit.

Until Google approves it, people see a "Google hasn't verified this app" warning when they connect. While the app is in Testing mode, only the Google accounts you add as test users can connect, so test with your own account first.

## How it works for students

On Data Input, the **Google Drive** menu works like draw.io's File menu:

- **Save to Google Drive** (Cmd+S / Ctrl+S): the first time, they name the file and it lands in their Drive as `Name.json`. After that, every change saves automatically and the bottom bar shows "Saved to Drive".
- **Save As**: saves a copy under a new name, for example one file per store.
- **Open**: lists every dashboard they've saved, newest first, with a search box. It works on any computer they sign in on.
- **Open Recent**: the last files they opened or saved in this browser, one click to reopen.
- **New Dashboard**: a blank sheet, ready to save as a new file.
- If they're about to replace numbers that aren't saved anywhere, it asks first.
- When they come back, the bottom bar shows "Drive • Name • Reconnect". One click signs them in and opens their latest copy.
