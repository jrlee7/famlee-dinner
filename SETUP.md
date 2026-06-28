# FamLee Dinner — Setup & Deploy Guide

## Prerequisites
Install these once on your computer:

```bash
# 1. Install Node.js from https://nodejs.org (get LTS version)
# Verify it worked:
node --version   # should show v18 or v20
npm --version    # should show 9 or 10

# 2. Install Firebase CLI globally
npm install -g firebase-tools

# Verify:
firebase --version
```

---

## Step 1 — Download the project
Download the `famlee-dinner` folder from Claude and put it somewhere on your computer, like:
```
C:\Users\YourName\Documents\famlee-dinner\
```

---

## Step 2 — Open a terminal in the project folder
- Windows: Open the folder in File Explorer → right-click → "Open in Terminal"
- Mac: Open Terminal → drag the folder in → hit Enter

---

## Step 3 — Log into Firebase
```bash
firebase login
```
This opens a browser — sign in with the Google account you used to create the Firebase project.

---

## Step 4 — Install dependencies
```bash
# Install the main app dependencies
npm install

# Install the Cloud Functions dependencies
cd functions
npm install
cd ..
```

---

## Step 5 — Set your secret keys
These never go in code — Firebase stores them securely:

```bash
# Your Anthropic API key (paste when prompted — it won't show on screen)
firebase functions:secrets:set ANTHROPIC_KEY

# Your Kroger client secret (paste when prompted)
firebase functions:secrets:set KROGER_CLIENT_SECRET
```

When prompted, paste:
- ANTHROPIC_KEY → your sk-ant-... key
- KROGER_CLIENT_SECRET → WKZimA6evQfs1F02FM0VTyTDel7re66PpxCl85lT

---

## Step 6 — Enable Firebase services in the console
Go to console.firebase.google.com → famlee-dinner-374bd, then enable:

1. **Authentication** → Sign-in method → Google → Enable → Add your domain
2. **Firestore Database** → Create database → Start in production mode → Pick a region (us-east1 is fine)
3. **Storage** → Get started → Default rules → Done
4. **Blaze plan** → Click "Spark" in the bottom-left → Upgrade to Blaze
   (Required for Cloud Functions — add a credit card, you won't be charged at family scale)

---

## Step 7 — Add your domain to Google Auth
In Firebase Console:
- Authentication → Settings → Authorized domains
- Add: `famlee-dinner-374bd.web.app`
- Add: `famlee-dinner-374bd.firebaseapp.com`

Also in Google Cloud Console (console.cloud.google.com):
- APIs & Services → Credentials → OAuth 2.0 Client → Web client
- Add to Authorized redirect URIs:
  - `https://famlee-dinner-374bd.firebaseapp.com/__/auth/handler`

---

## Step 8 — Add Kroger redirect URI
Go to developer.kroger.com → your app settings → Add redirect URI:
```
https://famlee-dinner-374bd.web.app/kroger-callback
```

---

## Step 9 — Deploy everything
```bash
npm run deploy
```

This runs `vite build` then `firebase deploy` — deploys hosting + functions + rules.

Your app will be live at:
**https://famlee-dinner-374bd.web.app**

---

## Step 10 — Future updates
Any time you change the code, just run:
```bash
npm run deploy
```
Takes about 60 seconds. The live site updates immediately.

---

## Troubleshooting

**"firebase: command not found"**
```bash
npm install -g firebase-tools
```

**"Must have a Blaze plan"**
Upgrade in Firebase console — required for Cloud Functions.

**"Permission denied" on Firestore**
Go to Firestore → Rules → make sure the rules from `firestore.rules` are published.

**Kroger OAuth not working**
Make sure the redirect URI `https://famlee-dinner-374bd.web.app/kroger-callback` is added in the Kroger developer portal.

**AI features not working**
Check that ANTHROPIC_KEY secret is set:
```bash
firebase functions:secrets:get ANTHROPIC_KEY
```

---

## Project structure
```
famlee-dinner/
├── src/
│   ├── main.jsx          ← React entry
│   ├── App.jsx           ← Full app (1700 lines)
│   └── firebase.js       ← Firebase config + helpers
├── functions/
│   ├── index.js          ← Cloud Functions (AI proxy, Kroger, scraper)
│   └── package.json
├── public/
│   └── index.html
├── firestore.rules       ← Database security
├── storage.rules         ← Photo storage security
├── firebase.json         ← Firebase config
├── vite.config.js        ← Build config
└── package.json          ← npm scripts
```

## Sharing with your wife
Once deployed, she goes to **https://famlee-dinner-374bd.web.app** on any device, signs in with her Google account, and then:
1. Click your avatar → "Join a Family"
2. Paste your Family ID (shown in the user menu)
3. Done — she sees all the same recipes, meal plan, and shopping list in real time

Her macro goals and daily logs are personal (not shared).
