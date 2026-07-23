import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, onSnapshot, collection, addDoc, deleteDoc, updateDoc } from "firebase/firestore";
import { getStorage, ref, uploadString, getDownloadURL } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCmIufaX88TLp2ZFuTSkDdTU95vB2bF1KI",
  authDomain: "famlee-dinner-374bd.firebaseapp.com",
  projectId: "famlee-dinner-374bd",
  storageBucket: "famlee-dinner-374bd.firebasestorage.app",
  messagingSenderId: "666287437813",
  appId: "1:666287437813:web:f0527ed83c57ac4abdd2bc",
  measurementId: "G-NJN7GZF4PQ"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

// ── Auth helpers ──────────────────────────────────────────────────────────────
export const signInWithGoogle = () => signInWithPopup(auth, googleProvider);
export const signOutUser = () => signOut(auth);

// ── Firestore helpers ─────────────────────────────────────────────────────────
// Family data lives under /families/{familyId}/
// User data lives under /users/{uid}/

export async function getFamilyId(uid) {
  const userDoc = await getDoc(doc(db, "users", uid));
  if (userDoc.exists()) {
    const familyId = userDoc.data().familyId;
    // Backfill: older owner accounts may predate the /families doc — joiners
    // need it to exist for the "family not found" check
    if (familyId === uid) {
      const famRef = doc(db, "families", familyId);
      const famDoc = await getDoc(famRef);
      if (!famDoc.exists()) await setDoc(famRef, { createdAt: new Date().toISOString(), ownerId: uid });
    }
    return familyId;
  }
  // First login — create a new family
  const familyId = uid; // owner's uid is the family ID
  await setDoc(doc(db, "users", uid), { familyId, role: "owner", joinedAt: new Date().toISOString() });
  await setDoc(doc(db, "families", familyId), { createdAt: new Date().toISOString(), ownerId: uid });
  return familyId;
}

export async function joinFamily(uid, familyId) {
  familyId = familyId.trim();
  const familyDoc = await getDoc(doc(db, "families", familyId));
  if (!familyDoc.exists()) throw new Error("Family not found");
  await setDoc(doc(db, "users", uid), { familyId, role: "member", joinedAt: new Date().toISOString() });
}

// Recipes
export const saveRecipe = (familyId, recipe) =>
  setDoc(doc(db, "families", familyId, "recipes", recipe.id), recipe);
export const deleteRecipe = (familyId, recipeId) =>
  deleteDoc(doc(db, "families", familyId, "recipes", recipeId));
export const subscribeRecipes = (familyId, cb, onErr) =>
  onSnapshot(collection(db, "families", familyId, "recipes"), snap =>
    cb(snap.docs.map(d => d.data())),
    err => { console.error("subscribeRecipes error:", err.code, err.message); onErr && onErr(err); });

// Meal plan
export const saveMealPlan = (familyId, plan) =>
  setDoc(doc(db, "families", familyId, "mealplan", "current"), plan);
export const subscribeMealPlan = (familyId, cb) =>
  onSnapshot(doc(db, "families", familyId, "mealplan", "current"), snap =>
    cb(snap.exists() ? snap.data() : {}));

// Shopping list
export const saveShoppingList = (familyId, list) =>
  setDoc(doc(db, "families", familyId, "shopping", "current"), { items: list });
export const subscribeShoppingList = (familyId, cb) =>
  onSnapshot(doc(db, "families", familyId, "shopping", "current"), snap =>
    cb(snap.exists() ? snap.data().items : []));

// Pantry
export const savePantry = (familyId, pantry) =>
  setDoc(doc(db, "families", familyId, "pantry", "current"), { items: pantry });
export const subscribePantry = (familyId, cb) =>
  onSnapshot(doc(db, "families", familyId, "pantry", "current"), snap =>
    cb(snap.exists() ? snap.data().items : []));

// User profile & macro logs (per-user, not shared)
export const saveUserProfile = (uid, profile) =>
  setDoc(doc(db, "users", uid, "profile", "macros"), profile);
export const getUserProfile = uid =>
  getDoc(doc(db, "users", uid, "profile", "macros"));
export const saveMacroLog = (uid, dateKey, entries) =>
  setDoc(doc(db, "users", uid, "macrologs", dateKey), { entries });
export const subscribeMacroLog = (uid, dateKey, cb) =>
  onSnapshot(doc(db, "users", uid, "macrologs", dateKey), snap =>
    cb(snap.exists() ? snap.data().entries : []));

// Tags & settings (shared family)
export const saveFamilySettings = (familyId, settings) =>
  setDoc(doc(db, "families", familyId, "settings", "main"), settings);
export const subscribeFamilySettings = (familyId, cb) =>
  onSnapshot(doc(db, "families", familyId, "settings", "main"), snap =>
    cb(snap.exists() ? snap.data() : {}));

// Freezer — [{recipeId, title, meals, addedAt}]
export const saveFreezer = (familyId, items) =>
  setDoc(doc(db, "families", familyId, "freezer", "current"), { items });
export const subscribeFreezer = (familyId, cb) =>
  onSnapshot(doc(db, "families", familyId, "freezer", "current"), snap =>
    cb(snap.exists() ? snap.data().items : []));

// ── Storage helpers ───────────────────────────────────────────────────────────
export async function uploadRecipePhoto(familyId, recipeId, dataUrl) {
  const storageRef = ref(storage, `families/${familyId}/recipes/${recipeId}.jpg`);
  await uploadString(storageRef, dataUrl, "data_url");
  return getDownloadURL(storageRef);
}
