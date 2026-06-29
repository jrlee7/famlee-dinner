# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Vite dev server (localhost:5173)
npm run build      # Production build → dist/
npm run deploy     # build + firebase deploy (hosting + functions)

# Firebase emulators (run before testing locally with real Firestore/Auth)
firebase emulators:start

# Deploy only functions
firebase deploy --only functions

# Set Firebase Functions secrets
firebase functions:secrets:set ANTHROPIC_API_KEY
firebase functions:secrets:set KROGER_CLIENT_ID
firebase functions:secrets:set KROGER_CLIENT_SECRET
```

## Environment

Copy `.env.example` → `.env` and fill in `VITE_ANTHROPIC_API_KEY` for local dev. This key is used directly from the browser via `anthropic-dangerous-direct-browser-access`.

Firebase emulator ports: Firestore 8080, Functions 5001, Hosting 5000, Storage 9199.

## Architecture

**Single-file frontend.** Almost all UI lives in `src/App.jsx` (~1900 lines). No component files, no routing library, no CSS files — all styles are inline via a theme object `C`. `src/firebase.js` contains all Firestore/Auth/Storage helpers.

**Theme system.** `THEMES` object at the top of App.jsx defines 5 color themes (`famlee`, `forest`, `modern`, `midnight`, `rose`). The mutable `C` object is reassigned on every render to the active theme — all inline styles reference `C.*` properties. Theme persisted in `localStorage`.

**Data model.** Firestore structure:
- `/users/{uid}` — familyId, role, joinedAt
- `/users/{uid}/profile/macros` — nutrition goals
- `/users/{uid}/macrologs/{dateKey}` — daily food log entries
- `/families/{familyId}` — owner, createdAt
- `/families/{familyId}/recipes/{recipeId}` — recipe objects
- `/families/{familyId}/mealplan/current` — weekly meal plan `{day_meal: recipeId}`
- `/families/{familyId}/shopping/current` — `{items: [...]}`
- `/families/{familyId}/pantry/current` — `{items: [...]}`
- `/families/{familyId}/settings/main` — custom tags, categories

Family sharing: first login creates a family using the user's UID as the familyId. Others join via that ID. Firestore rules enforce membership via `isFamilyMember()` lookup.

**Tabs (rendered inside `App()`):**
- `recipes` → `RecipesTab` — browse/filter/search vault
- `plan` → `MealPlanTab` — weekly grid, AI meal plan builder
- `shopping` → `ShoppingTab` — smart list with Kroger cart integration
- `pantry` → `PantryTab` — ingredient tracking
- `book` → `BookTab` — favorites/cookbook
- `macros` → `MacrosTab` + `FoodLogger` — daily nutrition tracking
- `goals` → `GoalsTab` — macro goal settings

**AI calls.** `callAI(system, user, tokens)` hits Anthropic directly from the browser (`claude-sonnet-4-5`). Used for: meal plan generation, recipe import from URL, ingredient price lookup suggestions. A second AI call block near line 1883 handles recipe import specifically.

**Cloud Functions (`functions/index.js`).** Node 20, plain `https` module (no SDK). Only used for Kroger OAuth flow and cart operations — secrets must be set via Firebase secrets manager. The `FN` constant in App.jsx points to the deployed functions URL.

**Recipe object shape** (defined in `BLANK()`): includes `ingredients[]` with per-store price fields (`pK`, `pW`, `pA`, `pS`, `pC` for Kroger/Walmart/Aldi/Sam's/Costco), `macros{}`, `cookLog[]`, `tags[]`.

**Kroger OAuth.** Client-side PKCE flow — `KROGER_CLIENT_ID` is public (safe in frontend). Token exchange happens via cloud function to keep `KROGER_CLIENT_SECRET` server-side.
