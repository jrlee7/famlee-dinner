import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { onAuthStateChanged } from "firebase/auth";
import {
  auth, db, signInWithGoogle, signOutUser,
  getFamilyId, joinFamily,
  saveRecipe, deleteRecipe as fbDeleteRecipe, subscribeRecipes,
  saveMealPlan, subscribeMealPlan,
  saveShoppingList, subscribeShoppingList,
  savePantry, subscribePantry,
  saveUserProfile, getUserProfile,
  saveMacroLog, subscribeMacroLog,
  saveFamilySettings, subscribeFamilySettings,
  uploadRecipePhoto,
} from "./firebase.js";

// Direct Anthropic API call
const callAI = async (system, user, tokens = 1400) => {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: tokens,
      system: system,
      messages: [{ role: "user", content: user }]
    })
  });
  const data = await r.json();
  return data.content?.[0]?.text || "";
};

// Cloud functions still used for Kroger cart
const FN = "https://us-central1-famlee-dinner-374bd.cloudfunctions.net";
const callFn = async (name, body) => {
  const r = await fetch(`${FN}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
};

// USDA key (public, rate-limited - safe to have in frontend)
const USDA_KEY = "jLgLIlkmkGiGw7jRc0otN54pU2XTEaE8EVaQgalb";

// --- THEMES -------------------------------------------------------------------
const THEMES = {
  famlee:   { name:"FamLee Classic", emoji:"📋", fontDisplay:"'Caveat',cursive",           fontBody:"'Nunito',sans-serif",    bg:"#F4EDD8", surface:"#EDE0C2", card:"#FBF6E8", border:"#D8C89C", borderLight:"#C4AD7C", accent:"#C04A0A", accentDim:"#983808", accentSoft:"#FAE0D0", green:"#4A7C3C", greenDim:"#387028", greenSoft:"#D8ECCC", text:"#2C1C0C", textDim:"#6C4C28", textMuted:"#A88C6C", red:"#B83020", redSoft:"#FAECE8", orange:"#C86010", orangeSoft:"#FAECD8" },
  forest:   { name:"Forest Kitchen",  emoji:"🌿", fontDisplay:"'Playfair Display',serif",   fontBody:"'Inter',sans-serif",     bg:"#0C1810", surface:"#111F15", card:"#172219", border:"#243428", borderLight:"#2E4233", accent:"#E8A838", accentDim:"#B8842A", accentSoft:"#2A1F0A", green:"#4CAF62", greenDim:"#2D7A42", greenSoft:"#152A1A", text:"#EBF0EC", textDim:"#7FA882", textMuted:"#4A6B50", red:"#C84B50", redSoft:"#2A1012", orange:"#D97B35", orangeSoft:"#2A1808" },
  modern:   { name:"Clean Modern",    emoji:"✦",  fontDisplay:"'DM Sans',sans-serif",       fontBody:"'DM Sans',sans-serif",   bg:"#0A0A0F", surface:"#111118", card:"#18181F", border:"#26262F", borderLight:"#32323E", accent:"#00D4FF", accentDim:"#00A8CC", accentSoft:"#001A22", green:"#00E5A0", greenDim:"#00B87A", greenSoft:"#00180F", text:"#F0F0F8", textDim:"#8080A0", textMuted:"#404058", red:"#FF4466", redSoft:"#1A000A", orange:"#FF8C00", orangeSoft:"#1A0E00" },
  midnight: { name:"Midnight Blue",   emoji:"🌙", fontDisplay:"'Georgia',serif",            fontBody:"'Inter',sans-serif",     bg:"#080C18", surface:"#0E1428", card:"#131B38", border:"#1E2E58", borderLight:"#2A3E78", accent:"#64B5F6", accentDim:"#42A0F0", accentSoft:"#0A1830", green:"#81C784", greenDim:"#5A9E5E", greenSoft:"#0A1E10", text:"#E8EAF6", textDim:"#7986CB", textMuted:"#3F4D8A", red:"#EF5350", redSoft:"#1A0808", orange:"#FFB74D", orangeSoft:"#1A1008" },
  rose:     { name:"Rose & Cream",    emoji:"🌸", fontDisplay:"'Georgia',serif",            fontBody:"system-ui,sans-serif",   bg:"#FDF0F3", surface:"#FAE4EA", card:"#FFFFFF", border:"#F0C4D0", borderLight:"#E0A0B4", accent:"#C2185B", accentDim:"#A0144A", accentSoft:"#FCE4EC", green:"#388E3C", greenDim:"#2E7430", greenSoft:"#E8F5E9", text:"#2C1520", textDim:"#8D5064", textMuted:"#C4A0B0", red:"#D32F2F", redSoft:"#FFEBEE", orange:"#E64A19", orangeSoft:"#FBE9E7" },
};
let C = { ...THEMES.famlee };
let FD = C.fontDisplay;
let FB = C.fontBody;

// --- CONSTANTS ----------------------------------------------------------------
const STORE_COLORS = { kroger:"#0073CF", walmart:"#0071CE", aldi:"#00843D", sams:"#0067A5", costco:"#E31837" };
const STORES = [
  { id:"kroger",  name:"Kroger",    short:"Kroger",  color:STORE_COLORS.kroger,  live:true,  cartSupport:true  },
  { id:"walmart", name:"Walmart",   short:"Walmart", color:STORE_COLORS.walmart, live:false, cartSupport:false },
  { id:"aldi",    name:"Aldi",      short:"Aldi",    color:STORE_COLORS.aldi,    live:false, cartSupport:false },
  { id:"sams",    name:"Sam's",     short:"Sam's",   color:STORE_COLORS.sams,    live:false, cartSupport:false },
  { id:"costco",  name:"Costco",    short:"Costco",  color:STORE_COLORS.costco,  live:false, cartSupport:false },
];
const CATS    = ["All","Chicken","Beef","Pork","Seafood","Vegetarian","Pasta","Soup","Salad","Side Dish","Dessert","Breakfast","Bread","Other"];
const DAYS    = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const MEALS   = ["Breakfast","Lunch","Dinner","Side Dish","Snack","Dessert","Bread"];
const AISLES  = ["Produce","Meat & Seafood","Dairy & Eggs","Bakery","Frozen","Canned & Dry","Condiments","Beverages","Snacks","Personal Care","Other"];
const DTAGS   = ["Family Favorite","Kid Friendly","Date Night","Quick Weeknight","Meal Prep","Late Night Snack","Weekend Cook","Healthy","Comfort Food","Grillable"];

// --- HELPERS ------------------------------------------------------------------
const gp  = (ing,sid) => Math.min(ing[{kroger:"pK",walmart:"pW",aldi:"pA",sams:"pS",costco:"pC"}[sid]] ?? 0, 25);
const bp  = ing => { const o=STORES.map(s=>[s.id,gp(ing,s.id)]).filter(([,p])=>p>0).sort((a,b)=>a[1]-b[1]); return o[0]||["kroger",0]; };
const rc  = (r,sid) => (r.ingredients||[]).reduce((s,i)=>s+gp(i,sid),0);
const fmt = d => new Date(d).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
const todayKey = () => new Date().toISOString().slice(0,10);

function compress(file,maxW=1200,q=0.80){
  return new Promise((res,rej)=>{
    const rd=new FileReader();
    rd.onload=ev=>{
      const img=new Image();
      img.onload=()=>{
        const sc=Math.min(1,maxW/img.width);
        const cv=document.createElement("canvas");
        cv.width=Math.round(img.width*sc); cv.height=Math.round(img.height*sc);
        cv.getContext("2d").drawImage(img,0,0,cv.width,cv.height);
        const d=cv.toDataURL("image/jpeg",q);
        res({dataUrl:d,kb:Math.round(d.length*3/4/1024)});
      };
      img.onerror=rej; img.src=ev.target.result;
    };
    rd.onerror=rej; rd.readAsDataURL(file);
  });
}

const BLANK = () => ({
  id:"", title:"", category:"Chicken", mealType:"Dinner",
  prepTime:15, cookTime:30, servings:4, rating:4,
  favorite:false, noRecipeNeeded:false, makesLeftovers:false,
  image:"", source:"manual", sourceUrl:"", videoUrl:"", notes:"", tags:[],
  ingredients:[{name:"",qty:1,unit:"",pK:0,pW:0,pA:0,pS:0,pC:0,onSale:false,saleDesc:"",aisle:"Other"}],
  instructions:"1. \n2. \n3. ",
  macros:{calories:0,protein:0,carbs:0,fat:0,fiber:0,sugar:0,sodium:0},
  cookLog:[],
});

// --- MICRO COMPONENTS ---------------------------------------------------------
const Spin = ({size=16}) => <span style={{display:"inline-block",width:size,height:size,border:"2px solid #0003",borderTopColor:C.accent,borderRadius:"50%",animation:"spin .7s linear infinite"}}/>;
const Stars = ({n,onChange}) => <span>{[1,2,3,4,5].map(i=><span key={i} onClick={onChange?()=>onChange(i):undefined} style={{color:i<=n?C.accent:C.border,fontSize:14,cursor:onChange?"pointer":"default",userSelect:"none"}}>{i<=n?"★":"☆"}</span>)}</span>;

function Btn({children,onClick,variant="ghost",disabled=false,style={}}){
  const b={display:"inline-flex",alignItems:"center",justifyContent:"center",gap:6,border:"none",borderRadius:8,padding:"7px 14px",cursor:disabled?"not-allowed":"pointer",fontSize:13,fontWeight:600,userSelect:"none",opacity:disabled?.55:1,fontFamily:"inherit",transition:"opacity .15s",...style};
  const v={primary:{...b,background:C.accent,color:"#0C1810"},secondary:{...b,background:C.greenSoft,color:C.green,border:`1px solid ${C.greenDim}`},ghost:{...b,background:C.surface,color:C.textDim,border:`1px solid ${C.border}`},danger:{...b,background:C.redSoft,color:C.red,border:`1px solid ${C.red}44`}};
  return <button onClick={disabled?undefined:onClick} style={v[variant]||v.ghost}>{children}</button>;
}

function Modal({children,onClose,width=540,noPad=false}){
  useEffect(()=>{const h=e=>e.key==="Escape"&&onClose?.();window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h);},[onClose]);
  return(
    <div onClick={onClose} style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,.75)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,width:"100%",maxWidth:width,maxHeight:"93vh",overflow:"auto",padding:noPad?0:24,animation:"fadeUp .2s ease",fontFamily:FB}}>
        {children}
      </div>
    </div>
  );
}

// --- KROGER CART SERVICE ------------------------------------------------------
const KROGER_CLIENT_ID = "famleerecipies-bbcfcxq2";
const KROGER_REDIRECT  = `${window.location.origin}/kroger-callback`;
const KROGER_SCOPE     = "product.compact cart.basic:write profile.compact";

function getKrogerAuthUrl() {
  const params = new URLSearchParams({
    scope: KROGER_SCOPE,
    client_id: KROGER_CLIENT_ID,
    redirect_uri: KROGER_REDIRECT,
    response_type: "code",
  });
  return `https://api.kroger.com/v1/connect/oauth2/authorize?${params}`;
}

// --- APP ROOT -----------------------------------------------------------------
export default function App() {
  const [themeKey, setThemeKey] = useState(() => localStorage.getItem("fl_theme") || "famlee");
  const tk = THEMES[themeKey] || THEMES.famlee;
  Object.assign(C, tk, STORE_COLORS); FD = tk.fontDisplay; FB = tk.fontBody;
  useEffect(() => localStorage.setItem("fl_theme", themeKey), [themeKey]);

  const [authUser,   setAuthUser]   = useState(null);
  const [familyId,   setFamilyId]   = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [joinCode,   setJoinCode]   = useState("");
  const [showJoin,   setShowJoin]   = useState(false);
  const [joinErr,    setJoinErr]    = useState("");

  // Shared family state (Firestore real-time)
  const [recipes,    setRecipes]    = useState([]);
  const [mealPlan,   setMealPlan]   = useState({});
  const [shopping,   setShopping]   = useState([]);
  const [pantry,     setPantry]     = useState([]);
  const [settings,   setSettings]   = useState({ tags: DTAGS });

  // Per-user state
  const [profile,    setProfile]    = useState({ name:"Me", goalCal:2000, goalProtein:150, goalCarbs:200, goalFat:65 });
  const [macroLog,   setMacroLog]   = useState([]);

  // UI state
  const [tab,        setTab]        = useState("recipes");
  const [modal,      setModal]      = useState(null);
  const [showTheme,  setShowTheme]  = useState(false);

  // Kroger OAuth state
  const [krogerToken,   setKrogerToken]   = useState(() => { try { return JSON.parse(localStorage.getItem("fl_kroger")||"null"); } catch { return null; }});
  const [krogerLoading, setKrogerLoading] = useState(false);
  const [locationId,    setLocationId]    = useState(() => localStorage.getItem("fl_kroger_loc") || "");

  // Global styles
  const gs = `
    @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Nunito:wght@400;600;700&family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@600;700&family=DM+Sans:wght@400;500;600;700&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    ::-webkit-scrollbar{width:4px;height:4px}
    ::-webkit-scrollbar-thumb{background:${C.border};border-radius:4px}
    input,select,textarea,button{outline:none;font-family:inherit}
    body{background:${C.bg};font-family:${FB}}
  `;

  // -- Auth listener -----------------------------------------------------------
  useEffect(() => {
    return onAuthStateChanged(auth, async user => {
      if (user) {
        setAuthUser(user);
        const fid = await getFamilyId(user.uid);
        setFamilyId(fid);
        // Load personal profile
        const pd = await getUserProfile(user.uid);
        if (pd.exists()) setProfile(pd.data());
      } else {
        setAuthUser(null); setFamilyId(null);
      }
      setLoading(false);
    });
  }, []);

  // -- Firestore subscriptions (when familyId is known) -----------------------
  useEffect(() => {
    if (!familyId) return;
    const unsubs = [
      subscribeRecipes(familyId, setRecipes),
      subscribeMealPlan(familyId, setMealPlan),
      subscribeShoppingList(familyId, setShopping),
      subscribePantry(familyId, setPantry),
      subscribeFamilySettings(familyId, s => setSettings({ tags: DTAGS, ...s })),
    ];
    return () => unsubs.forEach(u => u());
  }, [familyId]);

  // -- Macro log subscription (today) -----------------------------------------
  useEffect(() => {
    if (!authUser) return;
    return subscribeMacroLog(authUser.uid, todayKey(), setMacroLog);
  }, [authUser]);

  // -- Kroger callback handler -------------------------------------------------
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("error");
    if (code) {
      // Clear the URL params immediately
      window.history.replaceState({}, "", "/");
      handleKrogerCallback(code);
    } else if (state) {
      window.history.replaceState({}, "", "/");
    }
  }, []);

  async function handleKrogerCallback(code) {
    setKrogerLoading(true);
    try {
      const data = await callFn("krogerOAuthExchange", { code, redirectUri: KROGER_REDIRECT });
      console.log("Kroger OAuth response:", JSON.stringify(data));
      if (data.access_token) {
        const tokenData = { ...data, expires_at: Date.now() + (data.expires_in || 1800) * 1000 };
        setKrogerToken(tokenData);
        localStorage.setItem("fl_kroger", JSON.stringify(tokenData));
        alert("✅ Kroger account connected! Now enter your ZIP code in the Shopping tab to link your store.");
      } else if (data.error) {
        alert("Kroger error: " + data.error + " - " + (data.error_description||""));
      } else {
        alert("Kroger connection failed - unexpected response. Check console.");
      }
    } catch (e) {
      console.error("Kroger auth error:", e);
      alert("Kroger connection error: " + e.message);
    }
    setKrogerLoading(false);
  }

  async function ensureKrogerToken() {
    if (!krogerToken) return null;
    // Check if still valid (with 5 min buffer)
    if (krogerToken.expires_at && Date.now() < krogerToken.expires_at - 300000) {
      return krogerToken.access_token;
    }
    // Try refresh
    try {
      if (krogerToken.refresh_token) {
        const data = await callFn("krogerRefresh", { refreshToken: krogerToken.refresh_token });
        if (data.access_token) {
          const t = { ...data, expires_at: Date.now() + (data.expires_in || 1800) * 1000 };
          setKrogerToken(t);
          localStorage.setItem("fl_kroger", JSON.stringify(t));
          return t.access_token;
        }
      }
    } catch {}
    // Refresh failed — clear token so user knows to reconnect
    setKrogerToken(null);
    localStorage.removeItem("fl_kroger");
    return null;
  }

  // -- Recipe CRUD -------------------------------------------------------------
  async function addRecipe(recipe) {
    const id = "r" + Date.now();
    let image = recipe.image;
    if (image?.startsWith("data:") && familyId) {
      try { image = await uploadRecipePhoto(familyId, id, image); } catch {}
    }
    const r = { ...recipe, id, image, cookLog: recipe.cookLog || [], createdAt: new Date().toISOString() };
    await saveRecipe(familyId, r);
  }

  async function updateRecipe(recipe) {
    let image = recipe.image;
    if (image?.startsWith("data:") && familyId) {
      try { image = await uploadRecipePhoto(familyId, recipe.id, image); } catch {}
    }
    await saveRecipe(familyId, { ...recipe, image });
  }

  async function deleteRecipe(id) { await fbDeleteRecipe(familyId, id); }

  const dupRecipe  = r => addRecipe({ ...r, title: r.title + " (Copy)", favorite: false, cookLog: [] });
  const toggleFav  = r => updateRecipe({ ...r, favorite: !r.favorite });
  const toggleBook = r => updateRecipe({ ...r, inBook: !r.inBook });

  async function logCook(recipeId, rating, note) {
    const r = recipes.find(x => x.id === recipeId);
    if (!r) return;
    await updateRecipe({ ...r, rating: rating || r.rating, cookLog: [{ date: new Date().toISOString(), rating, note }, ...(r.cookLog || [])].slice(0, 50) });
  }

  // -- Meal plan ---------------------------------------------------------------
  const setMeal    = async (k, r) => { const p = { ...mealPlan, [k]: r }; setMealPlan(p); await saveMealPlan(familyId, p); };
  const clearMeal  = async k      => { const p = { ...mealPlan }; delete p[k]; setMealPlan(p); await saveMealPlan(familyId, p); };
  const clearAllMP = async ()     => { setMealPlan({}); await saveMealPlan(familyId, {}); };

  function buildShopping() {
    const agg = {};
    Object.values(mealPlan).filter(Boolean).forEach(r =>
      (r.ingredients || []).forEach(ing => {
        const k = ing.name.toLowerCase().trim();
        if (agg[k]) agg[k].qty += ing.qty;
        else agg[k] = { ...ing, checked: false, assignedStore: "kroger", inPantry: pantry.includes(k) };
      })
    );
    const list = Object.values(agg);
    setShopping(list); saveShoppingList(familyId, list);
    setTab("shopping");
  }

  // -- Pantry ------------------------------------------------------------------
  async function updatePantry(p) { setPantry(p); await savePantry(familyId, p); }

  // -- Tags --------------------------------------------------------------------
  async function updateTags(tags) {
    const s = { ...settings, tags };
    setSettings(s); await saveFamilySettings(familyId, s);
  }

  async function updateCats(cats) {
    const s = { ...settings, cats };
    setSettings(s); await saveFamilySettings(familyId, s);
  }

  // -- Macros ------------------------------------------------------------------
  async function saveProfile(p) {
    setProfile(p);
    await saveUserProfile(authUser.uid, p);
  }

  async function addMacroEntry(entry) {
    const dk = todayKey();
    const updated = [entry, ...macroLog];
    setMacroLog(updated);
    await saveMacroLog(authUser.uid, dk, updated);
  }

  async function removeMacroEntry(idx) {
    const dk = todayKey();
    const updated = macroLog.filter((_, i) => i !== idx);
    setMacroLog(updated);
    await saveMacroLog(authUser.uid, dk, updated);
  }

  const todayTotals = macroLog.reduce((a, e) => ({ cal: a.cal + (e.cal||0), protein: a.protein + (e.protein||0), carbs: a.carbs + (e.carbs||0), fat: a.fat + (e.fat||0) }), { cal:0, protein:0, carbs:0, fat:0 });
  const bookRecipes = recipes.filter(r => r.inBook);
  const recentIds   = recipes.flatMap(r => (r.cookLog||[]).map(l => ({ id: r.id, date: l.date }))).sort((a,b) => new Date(b.date)-new Date(a.date)).slice(0,7).map(x=>x.id);

  // -- Kroger cart -------------------------------------------------------------
  async function sendToKrogerCart(items) {
    let userToken = await ensureKrogerToken();
    if (!userToken) {
      const reconnect = window.confirm("Your Kroger session expired. Reconnect now?");
      if (reconnect) window.location.href = getKrogerAuthUrl();
      return;
    }
    if (!locationId) { alert("Set your Kroger ZIP first to find your store."); return; }
    setKrogerLoading(true);
    const krogerItems = items.filter(i => (i.assignedStore||"kroger") === "kroger" && !i.checked);
    if (!krogerItems.length) { alert("No unchecked Kroger items on your list."); setKrogerLoading(false); return; }

    // Get client credentials token for product search
    let searchToken;
    try {
      const clientTok = await callFn("krogerToken", {});
      searchToken = clientTok.access_token;
      if (!searchToken) throw new Error("No client token");
    } catch(e) {
      alert("Could not get Kroger search token: " + e.message);
      setKrogerLoading(false);
      return;
    }

    const cartItems = [];
    const notFound = [];
    for (const item of krogerItems.slice(0, 20)) {
      const cleanName = item.name
        .replace(/\s*\([^)]*\)\s*/g, "")
        .replace(/,.*$/g, "")
        .replace(/\b(boneless|skinless|fresh|frozen|dried|minced|sliced|diced|chopped|ground|whole|large|small|medium|cut into strips|florets)\b/gi, "")
        .replace(/\s+/g, " ").trim();
      try {
        const results = await callFn("krogerSearch", { query: cleanName, locationId });
        const product = results?.data?.[0];
        console.log(`"${cleanName}" first result:`, JSON.stringify(product).slice(0,200));
        if (product) {
          const upc = product.upc || (product.items||[])[0]?.itemId || (product.items||[])[0]?.upc;
          console.log(`UPC for "${cleanName}":`, upc);
          if (upc) { cartItems.push({ upc, quantity: Math.max(1, Math.ceil(item.qty||1)) }); }
          else notFound.push(cleanName);
        } else {
          notFound.push(cleanName);
        }
      } catch(e) { notFound.push(cleanName); }
    }

    if (!cartItems.length) {
      alert(`No Kroger products found for:\n${notFound.join(", ")}`);
      setKrogerLoading(false);
      return;
    }

    try {
      const result = await callFn("krogerAddToCart", { items: cartItems, userToken });
      console.log("Cart result:", JSON.stringify(result));
      if (result?.errors?.length > 0 && JSON.stringify(result.errors).toLowerCase().includes("unauthorized")) {
        setKrogerToken(null);
        localStorage.removeItem("fl_kroger");
        window.location.href = getKrogerAuthUrl();
        return;
      }
      let msg = `✅ ${cartItems.length} item${cartItems.length!==1?"s":""} added to your Kroger cart!`;
      if (notFound.length) msg += `\n\nNot found on Kroger: ${notFound.join(", ")}`;
      alert(msg);
    } catch(e) { alert("Cart error: " + e.message); }
    setKrogerLoading(false);
  }

  async function findKrogerStore(zip) {
    try {
      // Try client credentials token first (doesn't expire with user session)
      let token;
      try {
        const clientTok = await callFn("krogerToken", {});
        token = clientTok.access_token;
        console.log("Using client token for location search, len:", token?.length);
      } catch(e) {
        console.log("Client token failed, trying user token");
      }
      // Fall back to user token
      if (!token) token = krogerToken?.access_token;
      if (!token) { alert("Connect your Kroger account first, then find your store."); return null; }
      const results = await callFn("krogerLocations", { zipCode: zip, token });
      console.log("Location results:", JSON.stringify(results).slice(0,300));
      const stores = results?.data || [];
      if (!stores.length) { alert("No Kroger stores found near ZIP " + zip + ". Try a nearby ZIP code."); return null; }
      if (stores.length === 1) {
        const store = stores[0];
        setLocationId(store.locationId);
        localStorage.setItem("fl_kroger_loc", store.locationId);
        alert(`✅ Store set: ${store.name} - ${store.address?.addressLine1}`);
        return store;
      }
      const options = stores.map((s,i) => `${i+1}. ${s.name} - ${s.address?.addressLine1}, ${s.address?.city} (${s.geolocation?.distanceInMiles?.toFixed(1)||"?"}mi)`).join("\n");
      const choice = prompt(`Choose your Kroger store:\n\n${options}\n\nEnter number (1-${stores.length}):`);
      const idx = parseInt(choice) - 1;
      if (isNaN(idx) || idx < 0 || idx >= stores.length) return null;
      const store = stores[idx];
      setLocationId(store.locationId);
      localStorage.setItem("fl_kroger_loc", store.locationId);
      alert(`✅ Store set: ${store.name} - ${store.address?.addressLine1}`);
      return store;
    } catch(e) { console.error(e); alert("Store search error: " + e.message); return null; }
  }

  // -- Tabs --------------------------------------------------------------------
  const TABS = [
    { id:"recipes",   icon:"🍽",  label:"Recipes"      },
    { id:"mealplan",  icon:"📅",  label:"Meal Plan"    },
    { id:"shopping",  icon:"🛒",  label:"Shopping"     },
    { id:"sales",     icon:"🏷",  label:"Meat Sales"   },
    { id:"book",      icon:"📖",  label:"Recipe Book"  },
    { id:"pantry",    icon:"🥫",  label:"Pantry"       },
    { id:"macros",    icon:"📊",  label:"Macros"       },
  ];

  // -- Loading screen ----------------------------------------------------------
  if (loading) return (
    <div style={{ height:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:C.bg }}>
      <style>{gs}</style>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:52 }}>🍽</div>
        <div style={{ fontFamily:FD, fontSize:22, color:C.accent, marginTop:10 }}>FamLee Dinner</div>
        <Spin size={24}/>
      </div>
    </div>
  );

  // -- Sign-in screen ----------------------------------------------------------
  if (!authUser) return (
    <div style={{ height:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:C.bg, fontFamily:FB }}>
      <style>{gs}</style>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:20, padding:"44px 38px", maxWidth:400, width:"100%", textAlign:"center", boxShadow:"0 20px 60px rgba(0,0,0,.2)" }}>
        <div style={{ fontSize:52, marginBottom:12 }}>🍽</div>
        <div style={{ fontFamily:FD, fontSize:28, fontWeight:700, color:C.accent, marginBottom:6 }}>FamLee Dinner</div>
        <div style={{ fontSize:13, color:C.textDim, marginBottom:28, lineHeight:1.7 }}>Your family's recipe vault, meal planner,<br/>smart shopping list &amp; macro tracker.</div>
        <button onClick={signInWithGoogle} style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"center", gap:10, background:"#fff", color:"#3c4043", border:"1px solid #dadce0", borderRadius:10, padding:"11px 20px", cursor:"pointer", fontSize:14, fontWeight:600, marginBottom:20 }}>
          <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
          Continue with Google
        </button>
        <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:16 }}>
          <div style={{ fontSize:10, color:C.textMuted, fontWeight:700, textTransform:"uppercase", letterSpacing:.8, marginBottom:10 }}>Theme</div>
          <div style={{ display:"flex", gap:6, justifyContent:"center", flexWrap:"wrap" }}>
            {Object.entries(THEMES).map(([k,t]) => (
              <button key={k} onClick={() => setThemeKey(k)} style={{ background:themeKey===k?C.accent:C.surface, color:themeKey===k?C.bg:C.textDim, border:`2px solid ${themeKey===k?C.accent:C.border}`, borderRadius:20, padding:"4px 11px", cursor:"pointer", fontSize:11, fontWeight:600 }}>
                {t.emoji} {t.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // -- Main app ----------------------------------------------------------------
  return (
    <div style={{ height:"100vh", display:"flex", flexDirection:"column", background:C.bg, color:C.text, fontFamily:FB }}>
      <style>{gs}</style>

      {/* Nav */}
      <nav style={{ flexShrink:0, background:C.surface, borderBottom:`1px solid ${C.border}`, padding:"0 14px", height:50, display:"flex", alignItems:"center", gap:6 }}>
        <div style={{ fontFamily:FD, fontSize:15, color:C.accent, fontWeight:700, flexShrink:0, marginRight:4 }}>🍽 FamLee</div>
        <div style={{ display:"flex", gap:1, overflowX:"auto" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ background:tab===t.id?C.accentSoft:"transparent", color:tab===t.id?C.accent:C.textDim, border:"none", borderRadius:7, padding:"4px 9px", cursor:"pointer", fontSize:11, fontWeight:tab===t.id?700:500, whiteSpace:"nowrap" }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
        <div style={{ display:"flex", gap:5, marginLeft:"auto", alignItems:"center", flexShrink:0 }}>
          <Btn variant="primary" onClick={() => setModal({ type:"import" })} style={{ padding:"3px 9px", fontSize:11 }}>📋 Import</Btn>
          <div style={{ position:"relative" }}>
            <button onClick={() => setShowTheme(s=>!s)} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:6, padding:"3px 7px", cursor:"pointer", fontSize:14 }}>{tk.emoji}</button>
            {showTheme && (
              <div style={{ position:"absolute", right:0, top:32, background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:8, zIndex:500, width:185, boxShadow:"0 8px 24px rgba(0,0,0,.3)" }} onMouseLeave={() => setShowTheme(false)}>
                {Object.entries(THEMES).map(([k,t]) => (
                  <button key={k} onClick={() => { setThemeKey(k); setShowTheme(false); }} style={{ width:"100%", display:"flex", alignItems:"center", gap:8, background:themeKey===k?C.accentSoft:"transparent", color:themeKey===k?C.accent:C.text, border:"none", borderRadius:7, padding:"6px 9px", cursor:"pointer", fontSize:12, fontWeight:themeKey===k?700:400, textAlign:"left" }}>
                    <span>{t.emoji}</span>{t.name}{themeKey===k && <span style={{ marginLeft:"auto", color:C.accent }}>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <img src={authUser.photoURL} alt="" onClick={() => setModal({ type:"userMenu" })} style={{ width:26, height:26, borderRadius:"50%", cursor:"pointer", border:`2px solid ${C.border}` }} onError={e => e.target.style.display="none"} />
        </div>
      </nav>

      {/* Macro banner */}
      <MacroBanner totals={todayTotals} profile={profile} onGoTo={() => setTab("macros")} />

      {/* Content */}
      <div style={{ flex:1, overflowY:"auto" }}>
        <div style={{ maxWidth:1300, margin:"0 auto", padding:"18px 18px" }}>
          {tab==="recipes"  && <RecipesTab recipes={recipes} mealPlan={mealPlan} customTags={settings.tags||DTAGS} customCats={settings.cats||[]} onAddCat={c=>updateCats([...(settings.cats||[]),c])} recentIds={recentIds} onView={r=>setModal({type:"detail",data:r})} onEdit={r=>setModal({type:"edit",data:r})} onDup={dupRecipe} onDelete={deleteRecipe} onToggleFav={toggleFav} onToggleBook={toggleBook} onSetMeal={setMeal} setModal={setModal} onAddTag={t=>updateTags([...(settings.tags||DTAGS),t])}/>}
          {tab==="mealplan" && <MealPlanTab recipes={recipes} mealPlan={mealPlan} onSet={setMeal} onClear={clearMeal} onClearAll={clearAllMP} onBuild={buildShopping} customTags={settings.tags||DTAGS} recentIds={recentIds} setModal={setModal}/>}
          {tab==="shopping" && <ShoppingTab shopping={shopping} setShopping={s=>{setShopping(s);saveShoppingList(familyId,s);}} pantry={pantry} krogerToken={krogerToken} onSendToKroger={sendToKrogerCart} onKrogerConnect={() => window.location.href = getKrogerAuthUrl()} krogerLoading={krogerLoading} locationId={locationId} onFindStore={findKrogerStore}/>}
          {tab==="sales"    && <MeatSalesTab locationId={locationId} recipes={recipes} onSetMeal={setMeal} onFindStore={findKrogerStore} shopping={shopping} setShopping={s=>{setShopping(s);saveShoppingList(familyId,s);}}/>}
          {tab==="book"     && <BookTab recipes={bookRecipes} onRemove={toggleBook} onView={r=>setModal({type:"detail",data:r})}/>}
          {tab==="pantry"   && <PantryTab pantry={pantry} setPantry={updatePantry} recipes={recipes}/>}
          {tab==="macros"   && <MacrosTab profile={profile} onSaveProfile={saveProfile} macroLog={macroLog} todayTotals={todayTotals} addMacroEntry={addMacroEntry} removeMacroEntry={removeMacroEntry} recipes={recipes} authUser={authUser}/>}
        </div>
      </div>

      {/* Modals */}
      {modal?.type==="import"    && <ImportModal onClose={()=>setModal(null)} onParsed={(r,imgs)=>setModal({type:"review",data:r,images:imgs||[]})} customTags={settings.tags||DTAGS} customCats={settings.cats||[]} onAddTag={t=>updateTags([...(settings.tags||DTAGS),t])}/>}
      {modal?.type==="manualadd" && <ReviewModal recipe={BLANK()} onClose={()=>setModal(null)} onSave={r=>{addRecipe(r);setModal(null);}} isEdit customTags={settings.tags||DTAGS} customCats={settings.cats||[]} onAddTag={t=>updateTags([...(settings.tags||DTAGS),t])}/>}
      {modal?.type==="review"    && <ReviewModal recipe={modal.data} scrapedImages={modal.images||[]} onClose={()=>setModal(null)} onSave={r=>{addRecipe(r);setModal(null);}} customTags={settings.tags||DTAGS} customCats={settings.cats||[]} onAddTag={t=>updateTags([...(settings.tags||DTAGS),t])}/>}
      {modal?.type==="edit"      && <ReviewModal recipe={modal.data} onClose={()=>setModal(null)} onSave={r=>{updateRecipe(r);setModal(null);}} isEdit customTags={settings.tags||DTAGS} customCats={settings.cats||[]} onAddTag={t=>updateTags([...(settings.tags||DTAGS),t])}/>}
      {modal?.type==="detail"    && <DetailModal recipe={modal.data} onClose={()=>setModal(null)} onEdit={r=>setModal({type:"edit",data:r})} onToggleBook={toggleBook} onLogCook={logCook} onDup={dupRecipe} onLogMacro={entry=>{addMacroEntry(entry);setModal(null);}}/>}
      {modal?.type==="pickslot"  && <PickSlotModal ctx={modal.data} recipes={recipes} onSet={setMeal} onClose={()=>setModal(null)}/>}
      {modal?.type==="quickadd"  && <ReviewModal recipe={{...BLANK(),noRecipeNeeded:true}} onClose={()=>setModal(null)} onSave={r=>{addRecipe(r);setModal(null);}} isEdit customTags={settings.tags||DTAGS} onAddTag={t=>updateTags([...(settings.tags||DTAGS),t])}/>}
      {modal?.type==="userMenu"  && (
        <Modal onClose={()=>setModal(null)} width={280}>
          <div style={{ textAlign:"center", paddingBottom:8 }}>
            <img src={authUser.photoURL} alt="" style={{ width:52, height:52, borderRadius:"50%", marginBottom:10, border:`3px solid ${C.accent}` }} onError={e=>e.target.style.display="none"}/>
            <div style={{ fontWeight:700, fontSize:15 }}>{authUser.displayName}</div>
            <div style={{ fontSize:12, color:C.textDim, marginBottom:6 }}>{authUser.email}</div>
            <div style={{ fontSize:11, color:C.textMuted, background:C.surface, borderRadius:8, padding:"6px 10px", marginBottom:16, wordBreak:"break-all" }}>
              Family ID: <strong style={{ color:C.text }}>{familyId}</strong>
              <div style={{ fontSize:10, marginTop:3 }}>Share this ID with family members so they can join</div>
            </div>
            {!showJoin ? (
              <Btn variant="ghost" onClick={()=>setShowJoin(true)} style={{ width:"100%", justifyContent:"center", marginBottom:8 }}>🔗 Join a Family</Btn>
            ) : (
              <div style={{ marginBottom:12 }}>
                <input value={joinCode} onChange={e=>setJoinCode(e.target.value)} placeholder="Paste Family ID…" style={{ width:"100%", background:C.surface, border:`1px solid ${C.border}`, borderRadius:7, padding:"7px 10px", color:C.text, fontSize:13, marginBottom:6 }}/>
                {joinErr && <div style={{ fontSize:11, color:C.red, marginBottom:4 }}>{joinErr}</div>}
                <Btn variant="primary" onClick={async()=>{ try{ await joinFamily(authUser.uid,joinCode); setFamilyId(joinCode); setShowJoin(false); setJoinErr(""); }catch(e){setJoinErr(e.message);}}} style={{ width:"100%", justifyContent:"center" }}>Join</Btn>
              </div>
            )}
            <Btn variant="secondary" onClick={()=>setModal({type:"tagManager"})} style={{ width:"100%", justifyContent:"center", marginBottom:8 }}>🏷 Manage Tags</Btn>
            <Btn variant="danger" onClick={()=>{signOutUser();setModal(null);}} style={{ width:"100%", justifyContent:"center" }}>Sign Out</Btn>
          </div>
        </Modal>
      )}
      {modal?.type==="tagManager" && <TagManagerModal tags={settings.tags||DTAGS} onSave={updateTags} onClose={()=>setModal(null)}/>}
    </div>
  );
}

// --- MACRO BANNER -------------------------------------------------------------
function MacroBanner({ totals, profile, onGoTo }) {
  const bars = [
    { key:"cal",     color:C.accent,    goal:profile.goalCal,     unit:"kcal" },
    { key:"protein", color:"#4CAF62",   goal:profile.goalProtein, unit:"g"    },
    { key:"carbs",   color:"#E8A838",   goal:profile.goalCarbs,   unit:"g"    },
    { key:"fat",     color:"#D97B35",   goal:profile.goalFat,     unit:"g"    },
  ];
  return (
    <div style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:"6px 16px", display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
      {bars.map(b => {
        const pct = Math.min(100, Math.round((totals[b.key] / (b.goal||1)) * 100));
        const over = totals[b.key] > b.goal;
        return (
          <div key={b.key} style={{ display:"flex", alignItems:"center", gap:5, flex:"1 0 80px" }}>
            <span style={{ fontSize:10, color:b.color, fontWeight:700, width:44, flexShrink:0 }}>{b.key==="cal"?"Cal":b.key.charAt(0).toUpperCase()+b.key.slice(1)}</span>
            <div style={{ flex:1, height:5, background:C.border, borderRadius:3, minWidth:40 }}>
              <div style={{ height:"100%", width:pct+"%", background:over?"#E53935":b.color, borderRadius:3, transition:"width .3s" }}/>
            </div>
            <span style={{ fontSize:10, color:over?"#E53935":C.textMuted, fontWeight:600, width:38, flexShrink:0, textAlign:"right" }}>{totals[b.key]}{b.unit}</span>
          </div>
        );
      })}
      <button onClick={onGoTo} style={{ background:C.accentSoft, color:C.accent, border:`1px solid ${C.accent}44`, borderRadius:8, padding:"3px 10px", cursor:"pointer", fontSize:11, fontWeight:700, flexShrink:0 }}>📊 Log</button>
    </div>
  );
}

// --- PLACEHOLDER TABS ---------------------------------------------------------
// These import from separate files in src/components/ for real deployment.
// For now they're defined inline below to keep the project self-contained.

function RecipesTab({ recipes, mealPlan, customTags, customCats, onAddCat, recentIds, onView, onEdit, onDup, onDelete, onToggleFav, onToggleBook, onSetMeal, setModal, onAddTag }) {
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [fav, setFav] = useState(false);
  const [sort, setSort] = useState("newest");
  const [minStar, setMinStar] = useState(0);
  const [tagF, setTagF] = useState("All");
  const [newCat, setNewCat] = useState("");
  const [showAddCat, setShowAddCat] = useState(false);

  const allCats = ["All", ...CATS.slice(1), ...(customCats||[])];

  let list = recipes.filter(r => {
    if (fav && !r.favorite) return false;
    if (cat !== "All" && r.category !== cat) return false;
    if (q && !r.title.toLowerCase().includes(q.toLowerCase())) return false;
    if (minStar > 0 && (r.rating||0) < minStar) return false;
    if (tagF !== "All" && !(r.tags||[]).includes(tagF)) return false;
    return true;
  });
  if (sort === "rating")   list = [...list].sort((a,b) => b.rating - a.rating);
  if (sort === "az")       list = [...list].sort((a,b) => a.title.localeCompare(b.title));
  if (sort === "cooktime") list = [...list].sort((a,b) => (a.prepTime+a.cookTime) - (b.prepTime+b.cookTime));
  if (sort === "recent")   list = [...list].sort((a,b) => { const ai=(a.cookLog||[])[0]?.date||""; const bi=(b.cookLog||[])[0]?.date||""; return bi.localeCompare(ai); });

  return (
    <div>
      <div style={{ display:"flex", gap:8, marginBottom:14, alignItems:"center", flexWrap:"wrap" }}>
        <Btn variant="ghost" onClick={()=>setModal({type:"manualadd"})} style={{ padding:"4px 10px", fontSize:12 }}>✏️ Manual</Btn>
        <Btn variant="secondary" onClick={()=>setModal({type:"import"})} style={{ padding:"4px 10px", fontSize:12 }}>📋 Paste / Import</Btn>
        <Btn variant="ghost" onClick={()=>setModal({type:"quickadd"})} style={{ padding:"4px 10px", fontSize:12 }}>⚡ Quick Meal</Btn>
      </div>
      <div style={{ display:"flex", gap:8, marginBottom:10, flexWrap:"wrap", alignItems:"center" }}>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search recipes…" style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:"6px 12px", color:C.text, fontSize:13, width:180 }}/>
        <select value={sort} onChange={e=>setSort(e.target.value)} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:"6px 9px", color:C.text, fontSize:12 }}>
          <option value="newest">Newest</option><option value="rating">Top Rated</option>
          <option value="az">A→Z</option><option value="cooktime">Quickest</option><option value="recent">Recently Cooked</option>
        </select>
        <div style={{ display:"flex", alignItems:"center", gap:3, background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:"4px 8px" }}>
          <span style={{ fontSize:10, color:C.textMuted, fontWeight:600 }}>Min:</span>
          {[0,1,2,3,4,5].map(n => <button key={n} onClick={()=>setMinStar(n===minStar?0:n)} style={{ background:"none", border:"none", cursor:"pointer", padding:"0 1px", color:n<=minStar&&n>0?C.accent:C.border, fontSize:14 }}>{n===0?"Any":"★"}</button>)}
        </div>
        <button onClick={()=>setFav(!fav)} style={{ background:fav?C.accentSoft:C.card, color:fav?C.accent:C.textDim, border:`1px solid ${fav?C.accentDim:C.border}`, borderRadius:8, padding:"6px 12px", cursor:"pointer", fontSize:12, fontWeight:600 }}>{fav?"★ Favs":"☆ All"}</button>
        <span style={{ fontSize:12, color:C.textMuted }}>{list.length} recipes</span>
      </div>
      <div style={{ display:"flex", gap:5, marginBottom:8, flexWrap:"wrap", alignItems:"center" }}>
        {allCats.map(c => <button key={c} onClick={()=>setCat(c)} style={{ background:cat===c?C.accent:C.card, color:cat===c?"#0C1810":C.textDim, border:`1px solid ${cat===c?C.accent:C.border}`, borderRadius:20, padding:"3px 11px", fontSize:11, fontWeight:600, cursor:"pointer" }}>{c}</button>)}
        {showAddCat
          ? <div style={{ display:"flex", gap:4, alignItems:"center" }}>
              <input value={newCat} onChange={e=>setNewCat(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&newCat.trim()){onAddCat(newCat.trim());setNewCat("");setShowAddCat(false);}}} placeholder="New category..." autoFocus style={{ background:C.card, border:`1px solid ${C.accent}`, borderRadius:20, padding:"3px 11px", color:C.text, fontSize:11, width:130 }}/>
              <button onClick={()=>{if(newCat.trim()){onAddCat(newCat.trim());setNewCat("");setShowAddCat(false);}}} style={{ background:C.accent, border:"none", borderRadius:20, padding:"3px 10px", cursor:"pointer", fontSize:11, fontWeight:700, color:"#0C1810" }}>Add</button>
              <button onClick={()=>setShowAddCat(false)} style={{ background:"none", border:"none", color:C.textMuted, cursor:"pointer", fontSize:13 }}>✕</button>
            </div>
          : <button onClick={()=>setShowAddCat(true)} style={{ background:C.surface, border:`1px dashed ${C.border}`, borderRadius:20, padding:"3px 11px", cursor:"pointer", fontSize:11, color:C.textMuted }}>+ Category</button>
        }
      </div>
      <div style={{ display:"flex", gap:5, marginBottom:14, flexWrap:"wrap", alignItems:"center" }}>
        <span style={{ fontSize:10, color:C.textMuted, fontWeight:700, textTransform:"uppercase" }}>Tag:</span>
        {["All",...customTags].map(t => <button key={t} onClick={()=>setTagF(t)} style={{ background:tagF===t?C.green:C.card, color:tagF===t?"#0C1810":C.textDim, border:`1px solid ${tagF===t?C.green:C.border}`, borderRadius:20, padding:"3px 10px", fontSize:11, fontWeight:600, cursor:"pointer" }}>{t}</button>)}
      </div>
      {list.length === 0
        ? <div style={{ textAlign:"center", padding:"60px 0", color:C.textMuted }}><div style={{ fontSize:40 }}>🔍</div><div style={{ fontSize:15, fontWeight:600, color:C.textDim, marginTop:10 }}>No recipes match</div></div>
        : <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))", gap:14 }}>
            {list.map(r => <RecipeCard key={r.id} recipe={r} inPlan={Object.values(mealPlan).some(v=>v?.id===r.id)} recentlyCookd={recentIds.includes(r.id)} onView={onView} onEdit={onEdit} onDup={onDup} onDelete={onDelete} onToggleFav={onToggleFav} onToggleBook={onToggleBook} onSetMeal={onSetMeal} mealPlan={mealPlan}/>)}
          </div>
      }
    </div>
  );
}

function RecipeCard({ recipe:r, inPlan, recentlyCookd, onView, onEdit, onDup, onDelete, onToggleFav, onToggleBook, onSetMeal, mealPlan }) {
  const [menu, setMenu] = useState(false);
  const [menuPos, setMenuPos] = useState({top:0,left:0});
  const [dayPick, setDayPick] = useState(false);
  const menuBtnRef = useRef();
  const hasSale = (r.ingredients||[]).some(i => i.onSale);
  const bestK   = rc(r, "kroger");

  function openMenu(e) {
    e.stopPropagation();
    if (menuBtnRef.current) {
      const rect = menuBtnRef.current.getBoundingClientRect();
      const menuW = 170;
      const left = Math.min(rect.right - menuW, window.innerWidth - menuW - 8);
      setMenuPos({ top: rect.bottom + 4, left: Math.max(8, left) });
    }
    setMenu(v => !v);
  }

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [menu]);
  return (
    <div style={{ background:C.card, borderRadius:12, border:`1px solid ${C.border}`, cursor:"pointer", transition:"transform .15s,box-shadow .15s", position:"relative", zIndex:menu?100:1 }}
      onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow=`0 6px 20px ${C.border}88`;}}
      onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="";}}
      onClick={()=>onView(r)}>
      <div style={{ position:"relative", height:155, background:C.surface, overflow:"hidden", borderRadius:"12px 12px 0 0" }}>
        {r.image
          ? <img src={r.image} alt={r.title} style={{ width:"100%", height:"100%", objectFit:"cover" }} onError={e=>e.target.style.display="none"}/>
          : <div style={{ height:"100%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:44 }}>{r.noRecipeNeeded?"🍔":"🍳"}</div>
        }
        <div style={{ position:"absolute", top:8, left:8, display:"flex", gap:4 }}>
          {hasSale && <span style={{ background:C.orange+"22", color:C.orange, border:`1px solid ${C.orange}44`, borderRadius:20, padding:"2px 8px", fontSize:10, fontWeight:700 }}>🏷 SALE</span>}
          {inPlan  && <span style={{ background:C.green+"22",  color:C.green,  border:`1px solid ${C.green}44`,  borderRadius:20, padding:"2px 8px", fontSize:10, fontWeight:700 }}>IN PLAN</span>}
          {recentlyCookd && <span style={{ background:C.accent+"22", color:C.accent, border:`1px solid ${C.accent}44`, borderRadius:20, padding:"2px 8px", fontSize:10, fontWeight:700 }}>🍴 Recent</span>}
          {r.makesLeftovers && <span style={{ background:C.green+"22", color:C.green, border:`1px solid ${C.green}44`, borderRadius:20, padding:"2px 8px", fontSize:10, fontWeight:700 }}>↩</span>}
        </div>
        <div style={{ position:"absolute", top:8, right:8, display:"flex", gap:3 }} onClick={e=>e.stopPropagation()}>
          <button onClick={e=>{e.stopPropagation();onToggleFav(r);}} style={{ background:"rgba(0,0,0,.6)", border:"none", borderRadius:6, width:32, height:32, cursor:"pointer", color:r.favorite?C.accent:"#fff", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center" }}>{r.favorite?"★":"☆"}</button>
          <div style={{ position:"relative" }}>
            <button ref={menuBtnRef} onClick={openMenu} style={{ background:"rgba(0,0,0,.6)", border:"none", borderRadius:6, width:32, height:32, cursor:"pointer", color:"#fff", fontSize:20, display:"flex", alignItems:"center", justifyContent:"center" }}>⋮</button>
            {menu && createPortal(
              <>
                <div onClick={e=>{e.stopPropagation();setMenu(false);}} style={{ position:"fixed", top:0, left:0, right:0, bottom:0, zIndex:9998 }}/>
                <div style={{ position:"fixed", top:menuPos.top, left:menuPos.left, background:C.surface, border:`2px solid ${C.border}`, borderRadius:10, width:170, zIndex:9999, boxShadow:"0 8px 32px rgba(0,0,0,.7)", overflow:"hidden" }}>
                  {[
                    ["✏️ Edit", ()=>onEdit(r)],
                    ["📋 Duplicate", ()=>onDup(r)],
                    [r.inBook?"📖 In Book":"📖 Add to Book", ()=>onToggleBook(r)],
                    ["📅 Add to Plan", ()=>{setDayPick(true);setMenu(false);}],
                    ["🗑 Delete Recipe", ()=>{if(window.confirm(`Delete "${r.title}"?\n\nThis cannot be undone.`))onDelete(r.id);}],
                  ].map(([lbl,fn])=>(
                    <button key={lbl} onClick={e=>{e.stopPropagation();fn();setMenu(false);}} style={{ width:"100%", background:C.surface, border:"none", borderBottom:`1px solid ${C.border}`, color:lbl.includes("Delete")?C.red:C.text, padding:"13px 16px", textAlign:"left", cursor:"pointer", fontSize:14, fontWeight:lbl.includes("Delete")?700:400, display:"block" }}>{lbl}</button>
                  ))}
                </div>
              </>,
              document.body
            )}
          </div>
        </div>
      </div>
      <div style={{ padding:"11px 13px" }}>
        <div style={{ fontSize:10, color:C.textMuted, fontWeight:700, textTransform:"uppercase", letterSpacing:.7, marginBottom:2 }}>{r.category} · {r.mealType}</div>
        <div style={{ fontFamily:FD, fontSize:14, fontWeight:700, marginBottom:5, lineHeight:1.3 }}>{r.title}</div>
        <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:4 }}>
          <Stars n={r.rating}/>
          <span style={{ color:C.textDim, fontSize:11 }}>⏱{r.prepTime+r.cookTime}m</span>
          <span style={{ color:C.textDim, fontSize:11 }}>👥{r.servings}</span>
          <span style={{ marginLeft:"auto", color:C.green, fontSize:11, fontWeight:600 }}>~${bestK.toFixed(2)}</span>
        </div>
        {(r.tags||[]).length > 0 && <div style={{ display:"flex", gap:3, flexWrap:"wrap", marginBottom:3 }}>{(r.tags||[]).map(t=><span key={t} style={{ background:C.greenSoft, color:C.green, borderRadius:20, padding:"1px 6px", fontSize:9, fontWeight:600 }}>{t}</span>)}</div>}
        {r.videoUrl && <div style={{ fontSize:10, color:C.accent, marginTop:2 }}>📹 Video</div>}
        {r.macros?.calories > 0 && <div style={{ display:"flex", gap:6, paddingTop:4, borderTop:`1px solid ${C.border}` }}><span style={{ fontSize:10, color:C.accent, fontWeight:700 }}>🔥{r.macros.calories}</span><span style={{ fontSize:10, color:C.textMuted }}>P:{r.macros.protein}g</span><span style={{ fontSize:10, color:C.textMuted }}>C:{r.macros.carbs}g</span><span style={{ fontSize:10, color:C.textMuted }}>F:{r.macros.fat}g</span></div>}
        {(r.cookLog||[]).length > 0 && <div style={{ fontSize:10, color:C.textMuted, marginTop:3 }}>🍴 Last: {fmt((r.cookLog||[])[0].date)}</div>}
      </div>
      {dayPick && (
        <div style={{ padding:"10px 12px", borderTop:`1px solid ${C.border}`, background:C.surface }} onClick={e=>e.stopPropagation()}>
          <div style={{ fontSize:9, color:C.textMuted, fontWeight:700, marginBottom:5 }}>ADD TO SLOT</div>
          {DAYS.map(day => <div key={day} style={{ display:"flex", gap:3, marginBottom:3, alignItems:"center" }}><span style={{ width:28, fontSize:10, color:C.textDim }}>{day.slice(0,3)}</span>{MEALS.map(meal=><button key={meal} onClick={()=>{onSetMeal(`${day}_${meal}`,r);setDayPick(false);}} style={{ flex:1, background:mealPlan[`${day}_${meal}`]?C.greenSoft:C.card, color:mealPlan[`${day}_${meal}`]?C.green:C.textDim, border:`1px solid ${C.border}`, borderRadius:4, padding:"2px 3px", fontSize:9, cursor:"pointer" }}>{meal.slice(0,3)}</button>)}</div>)}
          <Btn variant="ghost" onClick={()=>setDayPick(false)} style={{ width:"100%", justifyContent:"center", marginTop:4, fontSize:11, padding:"3px 0" }}>Cancel</Btn>
        </div>
      )}
    </div>
  );
}


// --- MEAL PLAN TAB ------------------------------------------------------------
function MealPlanTab({ recipes, mealPlan, onSet, onClear, onClearAll, onBuild, customTags, recentIds, setModal }) {
  const [aiLoading,     setAiLoading]     = useState(false);
  const [dragSrc,       setDragSrc]       = useState(null);
  const [minStar,       setMinStar]       = useState(() => Number(localStorage.getItem("fl_planminstar")||0));
  const [priorityTag,   setPriorityTag]   = useState(() => localStorage.getItem("fl_prioritytag")||"None");
  const [saleFirst,     setSaleFirst]     = useState(() => localStorage.getItem("fl_salefirst")!=="false");
  const [viewMode,      setViewMode]      = useState("weekly");
  const [monthOffset,   setMonthOffset]   = useState(0);
  const [showSaleAlert, setShowSaleAlert] = useState(true);
  const [saleDescModal, setSaleDescModal] = useState(null);
  const [krogerSales,   setKrogerSales]   = useState(null); // null=not checked, []=checked
  const [checkingSales, setCheckingSales] = useState(false);

  const eligible = recipes.filter(r => (r.rating||0) >= minStar);
  const planned  = Object.values(mealPlan).filter(Boolean);

  // Get unique meat/protein ingredient names from all recipes
  const MEAT_KEYWORDS = ["chicken","beef","pork","steak","rib","turkey","lamb","salmon","shrimp","bacon","sausage","brisket","roast","ham","tuna","cod","tilapia","crab","lobster","duck","veal","venison","ground beef","ground turkey","hot dog","bratwurst","pepperoni","prosciutto","chorizo"];
  const allIngredients = [...new Set(
    recipes.flatMap(r => (r.ingredients||[]).map(i => i.name.toLowerCase().trim()))
  )];
  const meatIngredients = allIngredients.filter(name =>
    MEAT_KEYWORDS.some(k => name.includes(k))
  );

  async function checkKrogerSales() {
    const locId = localStorage.getItem("fl_kroger_loc");
    if (!locId) { alert("Connect your Kroger account and set your store ZIP first (in the Shopping tab)."); return; }
    if (!meatIngredients.length) { alert("No meat or protein ingredients found in your recipes yet."); return; }
    setCheckingSales(true);
    try {
      const data = await callFn("krogerCheckSales", {
        ingredients: meatIngredients.slice(0, 15), // cap at 15 to avoid timeout
        locationId: locId,
      });
      setKrogerSales(data.results || []);
      setShowSaleAlert(true);
    } catch(e) {
      console.error(e);
      alert("Could not check Kroger sales. Make sure your store is set in the Shopping tab.");
    }
    setCheckingSales(false);
  }

  // All on-sale items from Kroger check
  const onSaleItems = (krogerSales||[]).filter(s => s.onSale);
  const notOnSaleItems = (krogerSales||[]).filter(s => !s.onSale);

  async function aiPlan() {
    if (!eligible.length) return;
    setAiLoading(true);
    try {
      const list = eligible.map(r =>
        `${r.id}|${r.title}|${r.mealType||"Dinner"}|${r.category}|${r.rating||0}stars|${(r.ingredients||[]).some(i=>i.onSale)?"SALE":""}|${priorityTag!=="None"&&(r.tags||[]).includes(priorityTag)?"PRIORITY":""}|${recentIds.includes(r.id)?"RECENT":""}`
      ).join("\n");

      const sys = `You are a meal planner. Assign recipes to a 7-day plan for Breakfast, Lunch, and Dinner slots.

STRICT RULES:
- A recipe with mealType "Breakfast" MUST only go in a Breakfast slot (Monday_Breakfast, Tuesday_Breakfast etc)
- A recipe with mealType "Lunch" MUST only go in a Lunch slot
- A recipe with mealType "Dinner" MUST only go in a Dinner slot
- A recipe with mealType "Any" or blank can go in any slot
- Snack, Dessert, Bread, Side Dish recipes should be skipped unless no other options exist
- ${priorityTag!=="None"?`STRONGLY prefer PRIORITY tagged recipes. `:""}${saleFirst?"Prefer SALE recipes to save money. ":""}Avoid RECENT recipes if possible. Vary proteins and categories daily.

Return ONLY valid JSON with this exact format:
{"Monday_Breakfast":"id","Monday_Lunch":"id","Monday_Dinner":"id","Tuesday_Breakfast":"id",...}
Use exact recipe IDs. Only include slots you have a recipe for. Skip a slot rather than put the wrong mealType in it.`;

      const raw = await callAI(sys, `Available recipes (id|title|mealType|category|rating|flags):\n${list}`, 1200);
      const plan = JSON.parse(raw.replace(/```json|```/g,"").trim());
      for (const [k, id] of Object.entries(plan)) {
        const r = eligible.find(x => x.id === id);
        if (r) { const [d,m] = k.split("_"); await onSet(`${d}_${m}`, r); }
      }
    } catch(e) { console.error(e); }
    setAiLoading(false);
  }

  const now = new Date();
  const md  = new Date(now.getFullYear(), now.getMonth()+monthOffset, 1);
  const dim = new Date(md.getFullYear(), md.getMonth()+1, 0).getDate();
  const fdow= md.getDay();

  return (
    <div>
      {/* Live Kroger Sale Check */}
      <div style={{ background:STORE_COLORS.kroger+"11", border:`1px solid ${STORE_COLORS.kroger}44`, borderRadius:12, padding:"10px 14px", marginBottom:14 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <span style={{ fontSize:13, fontWeight:800, color:STORE_COLORS.kroger }}>🏷 Kroger Live Sales</span>
          <Btn variant="ghost" onClick={checkKrogerSales} disabled={checkingSales} style={{ padding:"4px 12px", fontSize:12 }}>
            {checkingSales ? <><Spin size={12}/> Checking…</> : "Check What's On Sale Now"}
          </Btn>
          {krogerSales && <span style={{ fontSize:11, color:C.textMuted }}>Checked {meatIngredients.length} ingredients · {onSaleItems.length} on sale</span>}
          {krogerSales && <button onClick={()=>setShowSaleAlert(v=>!v)} style={{ marginLeft:"auto", background:"none", border:"none", color:C.textMuted, cursor:"pointer", fontSize:12 }}>{showSaleAlert?"Hide":"Show"}</button>}
        </div>

        {krogerSales === null && (
          <div style={{ fontSize:11, color:C.textMuted, marginTop:6 }}>
            Click to check live Kroger prices for all meat & protein ingredients in your recipes.
            {!localStorage.getItem("fl_kroger_loc") && <span style={{ color:C.orange }}> (Set your store in the Shopping tab first)</span>}
          </div>
        )}

        {krogerSales && showSaleAlert && onSaleItems.length === 0 && (
          <div style={{ fontSize:12, color:C.textMuted, marginTop:8 }}>No meat or protein items on sale at your Kroger right now.</div>
        )}

        {krogerSales && showSaleAlert && onSaleItems.length > 0 && (
          <div style={{ marginTop:10, display:"flex", flexDirection:"column", gap:6 }}>
            {onSaleItems.sort((a,b) => b.savings - a.savings).map((item,i) => {
              const recipesWithItem = recipes.filter(r =>
                (r.ingredients||[]).some(ing => ing.name.toLowerCase().includes(item.ingredient.toLowerCase()))
              );
              const totalQty = recipesWithItem.reduce((sum,r) => {
                const ing = (r.ingredients||[]).find(ing => ing.name.toLowerCase().includes(item.ingredient.toLowerCase()));
                return sum + (ing?.qty||0);
              }, 0);
              return (
                <div key={i} style={{ background:C.card, borderRadius:8, padding:"8px 12px", display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                  <div style={{ flex:1, minWidth:180 }}>
                    <div style={{ fontSize:12, fontWeight:700, color:C.text }}>{item.productName}</div>
                    <div style={{ fontSize:11, color:"#FF8C00", fontWeight:600 }}>{item.saleDesc}</div>
                    <div style={{ fontSize:10, color:C.textMuted }}>
                      Save ${item.savings} ({item.pctOff}% off)
                      {recipesWithItem.length > 0 && <span> · Used in: {recipesWithItem.map(r=>r.title).join(", ")}</span>}
                      {totalQty > 0 && <span style={{ color:C.green, fontWeight:600 }}> · Need: ~{Math.ceil(totalQty)} {(recipesWithItem[0]?.ingredients||[]).find(i=>i.name.toLowerCase().includes(item.ingredient.toLowerCase()))?.unit||"units"}</span>}
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:5, flexShrink:0 }}>
                    {recipesWithItem.slice(0,2).map((r,j) => (
                      <button key={j} onClick={()=>onSet(`${DAYS[j]||"Monday"}_Dinner`, r)} style={{ background:STORE_COLORS.kroger+"22", border:`1px solid ${STORE_COLORS.kroger}`, borderRadius:6, padding:"3px 8px", cursor:"pointer", fontSize:10, color:STORE_COLORS.kroger, fontWeight:700, whiteSpace:"nowrap" }}>
                        + {r.title.slice(0,14)}{r.title.length>14?"...":""}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sale description modal */}
      {saleDescModal && (
        <div style={{ position:"fixed", top:0, left:0, right:0, bottom:0, background:"rgba(0,0,0,.5)", zIndex:400, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={()=>setSaleDescModal(null)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:C.card, borderRadius:12, padding:20, maxWidth:360 }}>
            <div style={{ fontWeight:700, marginBottom:8 }}>Sale Info</div>
            <div style={{ fontSize:13 }}>{saleDescModal}</div>
            <Btn variant="primary" onClick={()=>setSaleDescModal(null)} style={{ marginTop:12, width:"100%", justifyContent:"center" }}>Close</Btn>
          </div>
        </div>
      )}

      <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
        <span style={{ fontFamily:FD, fontSize:20, fontWeight:700, flex:1 }}>Meal Plan <span style={{ fontFamily:FB, fontSize:12, color:C.textMuted, fontWeight:400 }}>{planned.length} meals</span></span>
        <div style={{ display:"flex", background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, overflow:"hidden" }}>
          {[["weekly","📅 Week"],["monthly","🗓 Month"]].map(([id,lbl]) => <button key={id} onClick={()=>setViewMode(id)} style={{ background:viewMode===id?C.accent:"transparent", color:viewMode===id?"#0C1810":C.textDim, border:"none", padding:"5px 12px", cursor:"pointer", fontSize:12, fontWeight:700 }}>{lbl}</button>)}
        </div>
        <Btn variant="secondary" onClick={aiPlan} disabled={aiLoading||!eligible.length}>{aiLoading?<><Spin size={13}/> Planning…</>:"✨ AI Plan"}</Btn>
        {planned.length > 0 && <Btn variant="primary" onClick={onBuild}>🛒 Build List</Btn>}
        {planned.length > 0 && <Btn variant="danger" onClick={onClearAll}>🗑 Clear</Btn>}
      </div>

      {/* Settings */}
      <div style={{ display:"flex", gap:16, flexWrap:"wrap", background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:"10px 14px", marginBottom:14 }}>
        <div>
          <div style={{ fontSize:10, color:C.textMuted, fontWeight:700, marginBottom:3 }}>MIN RATING</div>
          <div style={{ display:"flex", gap:2 }}>
            {[0,1,2,3,4,5].map(n => <button key={n} onClick={()=>{setMinStar(n===minStar?0:n);localStorage.setItem("fl_planminstar",n===minStar?0:n);}} style={{ background:n>0&&n<=minStar?C.accentSoft:C.card, border:`1px solid ${n>0&&n<=minStar?C.accent:C.border}`, borderRadius:5, padding:"2px 6px", cursor:"pointer", color:n>0&&n<=minStar?C.accent:C.textMuted, fontSize:n===0?10:13, fontWeight:700 }}>{n===0?"Any":"★"}</button>)}
          </div>
        </div>
        <div>
          <div style={{ fontSize:10, color:C.textMuted, fontWeight:700, marginBottom:3 }}>PRIORITY TAG</div>
          <select value={priorityTag} onChange={e=>{setPriorityTag(e.target.value);localStorage.setItem("fl_prioritytag",e.target.value);}} style={{ background:C.card, border:`1px solid ${priorityTag!=="None"?C.green:C.border}`, borderRadius:7, padding:"4px 9px", color:priorityTag!=="None"?C.green:C.textDim, fontSize:12, fontWeight:priorityTag!=="None"?700:400 }}>
            <option value="None">None</option>
            {customTags.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize:10, color:C.textMuted, fontWeight:700, marginBottom:3 }}>SALE ITEMS FIRST</div>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <button onClick={()=>{setSaleFirst(!saleFirst);localStorage.setItem("fl_salefirst",!saleFirst);}} style={{ width:36, height:20, borderRadius:10, border:"none", cursor:"pointer", background:saleFirst?C.orange:C.border, position:"relative" }}>
              <span style={{ position:"absolute", top:3, left:saleFirst?18:3, width:14, height:14, borderRadius:"50%", background:"#fff", transition:"left .2s" }}/>
            </button>
            <span style={{ fontSize:12, color:saleFirst?C.orange:C.textDim, fontWeight:saleFirst?700:400 }}>{saleFirst?"On":"Off"}</span>
          </div>
        </div>
      </div>

      {viewMode === "weekly" && (
        <>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:8, marginBottom:16 }}>
            {DAYS.map(day => (
              <div key={day} style={{ background:C.card, borderRadius:10, border:`1px solid ${C.border}`, overflow:"hidden" }}>
                <div style={{ background:C.surface, padding:"5px 8px", fontSize:10, fontWeight:800, color:C.accent, borderBottom:`1px solid ${C.border}`, textTransform:"uppercase" }}>{day.slice(0,3)}</div>
                {MEALS.map((meal,mi) => {
                  const key = `${day}_${meal}`;
                  const recipe = mealPlan[key];
                  return (
                    <div key={meal} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(dragSrc)onSet(key,dragSrc);}}
                      onClick={()=>!recipe&&setModal({type:"pickslot",data:{day,meal,key}})}
                      style={{ padding:"6px 7px", minHeight:65, cursor:recipe?"default":"pointer", borderBottom:mi<MEALS.length-1?`1px solid ${C.border}`:"none" }}>
                      <div style={{ fontSize:8, color:C.textMuted, fontWeight:700, marginBottom:2, textTransform:"uppercase" }}>{meal}</div>
                      {recipe
                        ? <div>
                            {recipe.makesLeftovers && <div style={{ fontSize:8, color:C.green, marginBottom:1 }}>↩ leftovers</div>}
                            <div style={{ fontSize:10, color:C.text, lineHeight:1.2, marginBottom:3, fontWeight:600 }}>{recipe.title}</div>
                            <button onClick={e=>{e.stopPropagation();onClear(key);}} style={{ fontSize:8, color:C.red, background:"none", border:"none", cursor:"pointer", padding:0 }}>✕ remove</button>
                          </div>
                        : <div style={{ fontSize:9, color:C.border, fontStyle:"italic" }}>+ add</div>
                      }
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div style={{ fontSize:10, color:C.textMuted, fontWeight:700, marginBottom:7, textTransform:"uppercase" }}>Drag onto calendar</div>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {eligible.map(r => {
              const hs = (r.ingredients||[]).some(i=>i.onSale);
              const hp = priorityTag!=="None" && (r.tags||[]).includes(priorityTag);
              return (
                <div key={r.id} draggable onDragStart={()=>setDragSrc(r)} onDragEnd={()=>setDragSrc(null)}
                  style={{ background:dragSrc?.id===r.id?C.accentSoft:hp?C.greenSoft:C.card, border:`1px solid ${hp?C.green:hs?C.orange:C.border}`, borderRadius:8, padding:"5px 10px", cursor:"grab", fontSize:11, color:hp?C.green:hs?C.orange:C.text, fontWeight:hp||hs?700:400, display:"flex", alignItems:"center", gap:4, userSelect:"none" }}>
                  {hp&&"🏷"}{hs&&!hp&&"🏷"}{r.noRecipeNeeded&&"⚡"}{r.title}
                  {r.makesLeftovers&&<span style={{fontSize:9,color:C.green}}>↩</span>}
                </div>
              );
            })}
          </div>
        </>
      )}

      {viewMode === "monthly" && (
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
            <button onClick={()=>setMonthOffset(m=>m-1)} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:"4px 10px", cursor:"pointer", fontSize:16 }}>‹</button>
            <span style={{ fontFamily:FD, fontSize:18, fontWeight:700, flex:1, textAlign:"center" }}>{md.toLocaleString("default",{month:"long",year:"numeric"})}</span>
            <button onClick={()=>setMonthOffset(m=>m+1)} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:"4px 10px", cursor:"pointer", fontSize:16 }}>›</button>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4, marginBottom:6 }}>
            {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => <div key={d} style={{ textAlign:"center", fontSize:10, color:C.textMuted, fontWeight:700 }}>{d}</div>)}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
            {Array.from({length:fdow}).map((_,i) => <div key={"e"+i}/>)}
            {Array.from({length:dim}).map((_,i) => {
              const dn = i+1;
              const dk = `${md.getFullYear()}-${String(md.getMonth()+1).padStart(2,"0")}-${String(dn).padStart(2,"0")}`;
              const dinner = mealPlan[`${dk}_Dinner`];
              const isToday = new Date().toDateString() === new Date(md.getFullYear(),md.getMonth(),dn).toDateString();
              return (
                <div key={dn} style={{ background:isToday?C.accentSoft:C.card, border:`1px solid ${isToday?C.accent:C.border}`, borderRadius:8, padding:"5px", minHeight:52, cursor:"pointer" }}
                  onClick={()=>setModal({type:"pickslot",data:{day:dk,meal:"Dinner",key:`${dk}_Dinner`}})}>
                  <div style={{ fontSize:10, fontWeight:700, color:isToday?C.accent:C.textMuted, marginBottom:2 }}>{dn}</div>
                  {dinner ? <div style={{ fontSize:9, color:C.text, lineHeight:1.2, fontWeight:600 }}>{dinner.title}</div> : <div style={{ fontSize:8, color:C.border }}>+</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}


// --- SHOPPING TAB -------------------------------------------------------------
function ShoppingTab({ shopping, setShopping, pantry, krogerToken, onSendToKroger, onKrogerConnect, krogerLoading, locationId, onFindStore }) {
  const [viewMode, setViewMode] = useState("list");
  const [aiSorting, setAiSorting] = useState(false);
  const [aisleSorted, setAisleSorted] = useState(false);
  const [zip, setZip] = useState(() => localStorage.getItem("fl_zip")||"");
  const [findingStore, setFindingStore] = useState(false);
  const [sendingCart, setSendingCart] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [newItem, setNewItem] = useState({ name:"", qty:"1", unit:"", store:"kroger" });

  const toggle    = i => setShopping(shopping.map((x,j) => j===i ? {...x,checked:!x.checked} : x));
  const setStore  = (i,s) => setShopping(shopping.map((x,j) => j===i ? {...x,assignedStore:s} : x));
  const sortBest  = () => setShopping(shopping.map(it => ({...it,assignedStore:bp(it)[0]})));
  const rmChecked = () => setShopping(shopping.filter(x => !x.checked));

  async function doAisleSort() {
    setAiSorting(true);
    try {
      const items = shopping.map((it,i) => `${i}|${it.name}`).join("\n");
      const raw = await callAI(`Assign each grocery item to its most likely store aisle. Return ONLY a JSON array: [{"idx":0,"aisle":"Produce"},...] Aisle options: ${AISLES.join(", ")}`, `Items:\n${items}`, 800);
      const assignments = JSON.parse(raw.replace(/```json|```/g,"").trim());
      setShopping(shopping.map((x,j) => { const a = assignments.find(a=>a.idx===j); return a ? {...x,aisle:a.aisle} : x; }));
      setAisleSorted(true);
    } catch(e) { console.error(e); }
    setAiSorting(false);
  }

  async function handleSendToKroger() {
    setSendingCart(true);
    const krogerItems = shopping.filter(x => x.assignedStore === "kroger" && !x.inPantry && !x.checked);
    await onSendToKroger(krogerItems);
    setSendingCart(false);
  }

  async function handleFindStore() {
    if (!zip) return;
    setFindingStore(true);
    await onFindStore(zip);
    setFindingStore(false);
  }

  function getStoreSearchUrl(storeId, query) {
    const q = encodeURIComponent(query);
    const urls = {
      kroger:  `https://www.kroger.com/search?query=${q}`,
      walmart: `https://www.walmart.com/search?q=${q}`,
      aldi:    `https://www.aldi.us/en/products/?q=${q}`,
      sams:    `https://www.samsclub.com/s/${q}`,
      costco:  `https://www.costco.com/CatalogSearch?keyword=${q}`,
    };
    return urls[storeId] || urls.kroger;
  }

  const totals = {};
  STORES.forEach(s => { totals[s.id] = shopping.filter(x => x.assignedStore===s.id && !x.inPantry).reduce((sum,it) => sum+gp(it,s.id)*it.qty, 0); });
  const grand = Object.values(totals).reduce((a,b) => a+b, 0);
  const checkedCount = shopping.filter(x => x.checked).length;
  const pantryExcluded = shopping.filter(x => x.inPantry);
  const storeGroups = STORES.map(s => ({ store:s, items:shopping.map((it,idx)=>({...it,_idx:idx})).filter(it=>it.assignedStore===s.id&&!it.inPantry), total:totals[s.id] })).filter(g=>g.items.length>0);
  const byAisle = aisleSorted ? AISLES.reduce((acc,a) => { const items=shopping.map((it,idx)=>({...it,_idx:idx})).filter(it=>it.aisle===a&&!it.inPantry); if(items.length) acc[a]=items; return acc; }, {}) : {};
  const flatList = shopping.map((it,idx) => ({...it,_idx:idx})).filter(it => !it.inPantry);

  function addManualItem() {
    if (!newItem.name.trim()) return;
    setShopping([...(shopping||[]), {
      name: newItem.name.trim(),
      qty: Number(newItem.qty)||1,
      unit: newItem.unit.trim(),
      assignedStore: newItem.store,
      checked: false, onSale: false, saleDesc: "",
      pK:0, pW:0, pA:0, pS:0, pC:0, aisle:"Other"
    }]);
    setNewItem({ name:"", qty:"1", unit:"", store:"kroger" });
    setShowAddItem(false);
  }

  const tokenExpired = krogerToken && krogerToken.expires_at && Date.now() > krogerToken.expires_at - 60000;
  const krogerBanner = (
    <div style={{ background:STORE_COLORS.kroger+"11", border:`1px solid ${STORE_COLORS.kroger}44`, borderRadius:10, padding:"10px 14px", marginBottom:14 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:6 }}>
        <span style={{ fontSize:13, color:STORE_COLORS.kroger, fontWeight:700 }}>🛒 Kroger</span>
        {krogerToken && !tokenExpired
          ? <span style={{ fontSize:12, color:C.green, fontWeight:600 }}>✅ Connected</span>
          : <Btn variant="secondary" onClick={onKrogerConnect} style={{ padding:"6px 14px", fontSize:12, fontWeight:700 }}>🔗 Connect Kroger Account</Btn>
        }
        {krogerToken && tokenExpired && (
          <Btn variant="ghost" onClick={onKrogerConnect} style={{ padding:"5px 12px", fontSize:11, color:C.orange }}>⚠️ Session expired — tap to reconnect</Btn>
        )}
        {krogerToken && locationId && (
          <Btn variant="secondary" onClick={handleSendToKroger} disabled={sendingCart} style={{ padding:"6px 14px", fontSize:12, marginLeft:"auto" }}>
            {sendingCart?<><Spin size={12}/> Adding…</>:"🛒 Send to Kroger Cart"}
          </Btn>
        )}
      </div>
      <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
        <input value={zip} onChange={e=>{setZip(e.target.value);localStorage.setItem("fl_zip",e.target.value);}} placeholder="ZIP code" style={{ width:90, background:C.card, border:`1px solid ${C.border}`, borderRadius:6, padding:"6px 10px", color:C.text, fontSize:13 }}/>
        <Btn variant="ghost" onClick={handleFindStore} disabled={findingStore||!zip} style={{ padding:"5px 12px", fontSize:12 }}>{findingStore?<><Spin size={12}/> Finding…</>:locationId?"🏪 Change Store":"🏪 Find My Store"}</Btn>
        {locationId && <span style={{ fontSize:11, color:C.green }}>Store linked ✓</span>}
      </div>
    </div>
  );

  const addItemPanel = (
    <div style={{ marginBottom:14 }}>
      {!showAddItem ? (
        <Btn variant="ghost" onClick={()=>setShowAddItem(true)} style={{ padding:"6px 14px", fontSize:12 }}>+ Add Item Manually</Btn>
      ) : (
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:"12px 14px", display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          <input value={newItem.name} onChange={e=>setNewItem(p=>({...p,name:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&addManualItem()} placeholder="Item name..." autoFocus style={{ flex:2, minWidth:120, background:C.surface, border:`1px solid ${C.border}`, borderRadius:7, padding:"6px 10px", color:C.text, fontSize:13 }}/>
          <input value={newItem.qty} onChange={e=>setNewItem(p=>({...p,qty:e.target.value}))} placeholder="Qty" type="number" style={{ width:55, background:C.surface, border:`1px solid ${C.border}`, borderRadius:7, padding:"6px 8px", color:C.text, fontSize:13 }}/>
          <input value={newItem.unit} onChange={e=>setNewItem(p=>({...p,unit:e.target.value}))} placeholder="Unit" style={{ width:70, background:C.surface, border:`1px solid ${C.border}`, borderRadius:7, padding:"6px 8px", color:C.text, fontSize:13 }}/>
          <select value={newItem.store} onChange={e=>setNewItem(p=>({...p,store:e.target.value}))} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:7, padding:"6px 8px", color:C.text, fontSize:12 }}>
            {STORES.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Btn variant="primary" onClick={addManualItem} disabled={!newItem.name.trim()} style={{ padding:"6px 14px" }}>Add</Btn>
          <Btn variant="ghost" onClick={()=>setShowAddItem(false)} style={{ padding:"6px 10px" }}>Cancel</Btn>
        </div>
      )}
    </div>
  );

  if (!shopping.length) return (
    <div>
      {krogerBanner}
      {addItemPanel}
      <div style={{ textAlign:"center", padding:"60px 0", color:C.textMuted }}>
        <div style={{ fontSize:48 }}>🛒</div>
        <div style={{ fontSize:16, fontWeight:600, color:C.textDim, marginTop:10 }}>Shopping list is empty</div>
        <div style={{ fontSize:12, marginTop:5 }}>Fill your meal plan and click "Build List", or add items manually above</div>
      </div>
    </div>
  );

  function Row({ it }) {
    const price = gp(it, it.assignedStore);
    const [bs, bpp] = bp(it);
    const isBest = it.assignedStore === bs || bpp === 0;
    const store = STORES.find(s => s.id === it.assignedStore);
    const savings = bpp > 0 && !isBest ? ((gp(it, it.assignedStore) - bpp)).toFixed(2) : null;
    const [editQty, setEditQty] = useState(false);
    const [qtyVal, setQtyVal] = useState(String(it.qty||1));

    function saveQty() {
      const n = parseFloat(qtyVal);
      if (!isNaN(n) && n > 0) {
        setShopping(shopping.map((x,i) => i===it._idx ? {...x, qty:n} : x));
      }
      setEditQty(false);
    }

    return (
      <div style={{ display:"flex", alignItems:"center", gap:7, padding:"9px 14px", borderBottom:`1px solid ${C.border}`, opacity:it.checked?0.4:1, flexWrap:"wrap" }}>
        <button onClick={()=>toggle(it._idx)} style={{ width:17, height:17, borderRadius:4, flexShrink:0, cursor:"pointer", background:it.checked?C.green:"transparent", border:`2px solid ${it.checked?C.green:C.border}`, display:"flex", alignItems:"center", justifyContent:"center" }}>
          {it.checked && <span style={{ color:"#0C1810", fontSize:10, fontWeight:900 }}>✓</span>}
        </button>
        {it.onSale && <span style={{ fontSize:11, flexShrink:0 }}>🏷</span>}
        <span style={{ flex:1, fontSize:12, textDecoration:it.checked?"line-through":"none", color:C.text, minWidth:80 }}>{it.name}</span>
        {/* Editable quantity */}
        {editQty
          ? <div style={{ display:"flex", gap:3, alignItems:"center", flexShrink:0 }}>
              <input autoFocus value={qtyVal} onChange={e=>setQtyVal(e.target.value)} onBlur={saveQty} onKeyDown={e=>e.key==="Enter"&&saveQty()} style={{ width:45, background:C.card, border:`1px solid ${C.accent}`, borderRadius:5, padding:"2px 5px", color:C.text, fontSize:12, textAlign:"center" }}/>
              <span style={{ fontSize:11, color:C.textMuted }}>{it.unit}</span>
            </div>
          : <button onClick={()=>{setQtyVal(String(it.qty||1));setEditQty(true);}} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:5, padding:"2px 7px", cursor:"pointer", fontSize:11, color:C.textDim, flexShrink:0 }}>
              {it.qty} {it.unit}
            </button>
        }
        {/* Store switcher */}
        <select value={it.assignedStore} onChange={e=>setStore(it._idx, e.target.value)}
          style={{ background:store?.color+"22"||C.surface, border:`1px solid ${store?.color||C.border}`, borderRadius:6, padding:"3px 6px", color:store?.color||C.textDim, fontSize:10, fontWeight:700, flexShrink:0, cursor:"pointer" }}>
          {STORES.map(s => <option key={s.id} value={s.id} style={{ background:C.card, color:C.text }}>{s.short}</option>)}
        </select>
        {price > 0 && <span style={{ fontSize:12, fontWeight:700, color:isBest?C.green:C.textDim, flexShrink:0 }}>${price.toFixed(2)}</span>}
        {savings && Number(savings) > 0 && <span style={{ fontSize:9, color:C.orange, flexShrink:0 }}>save ${savings}@{STORES.find(s=>s.id===bs)?.short}</span>}
        <button onClick={()=>setShopping(shopping.filter((_,i)=>i!==it._idx))} style={{ background:"none", border:"none", color:C.red, cursor:"pointer", fontSize:14, padding:"0 2px", flexShrink:0 }}>✕</button>
        <a href={getStoreSearchUrl(it.assignedStore, it.name)} target="_blank" rel="noreferrer" style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:5, padding:"2px 6px", fontSize:10, color:C.textDim, textDecoration:"none", flexShrink:0 }}>🔍</a>
      </div>
    );
  }

  return (
    <div>
      {/* Kroger Connect Banner */}
      {krogerBanner}
      {addItemPanel}

      {/* Store totals */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:7, marginBottom:14 }}>
        {STORES.map(s => {
          const cnt = shopping.filter(x => x.assignedStore===s.id && !x.inPantry).length;
          return (
            <div key={s.id} style={{ background:C.card, border:`2px solid ${C.border}`, borderRadius:10, padding:"9px 11px" }}>
              <div style={{ fontSize:9, color:s.color, fontWeight:800 }}>{s.name}{!s.live&&<span style={{ fontSize:7, color:C.textMuted, marginLeft:2 }}>est.</span>}</div>
              <div style={{ fontFamily:FD, fontSize:19, fontWeight:700, color:C.text }}>${totals[s.id].toFixed(2)}</div>
              <div style={{ fontSize:9, color:C.textMuted }}>{cnt} items</div>
              {!s.cartSupport && <div style={{ fontSize:8, color:C.textMuted }}>
                <a href={`https://www.${s.id==="sams"?"samsclub":s.id}.com/search?q=`} target="_blank" rel="noopener noreferrer" style={{ color:s.color }}>Search {s.name} ↗</a>
              </div>}
            </div>
          );
        })}
      </div>

      {/* Toolbar */}
      <div style={{ display:"flex", gap:7, marginBottom:10, flexWrap:"wrap", alignItems:"center" }}>
        <div style={{ display:"flex", background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, overflow:"hidden" }}>
          {[["list","📋 Full List"],["byAisle","🗺 By Aisle"],["byStore","🏪 By Store"]].map(([id,lbl]) => <button key={id} onClick={()=>setViewMode(id)} style={{ background:viewMode===id?C.accent:"transparent", color:viewMode===id?"#0C1810":C.textDim, border:"none", padding:"5px 11px", cursor:"pointer", fontSize:11, fontWeight:700 }}>{lbl}</button>)}
        </div>
        <Btn variant="secondary" onClick={()=>{sortBest();setViewMode("byStore");}} style={{ padding:"5px 11px", fontSize:12 }}>💰 Best Price</Btn>
        <Btn variant="ghost" onClick={doAisleSort} disabled={aiSorting} style={{ padding:"5px 11px", fontSize:12 }}>{aiSorting?<><Spin size={12}/> Sorting…</>:"🗺 AI Sort Aisles"}</Btn>
        {checkedCount > 0 && <Btn variant="ghost" onClick={rmChecked} style={{ padding:"5px 11px", fontSize:12 }}>✓ Remove checked ({checkedCount})</Btn>}
        {krogerToken && locationId && (
          <Btn variant="secondary" onClick={handleSendToKroger} disabled={sendingCart} style={{ padding:"5px 11px", fontSize:12, marginLeft:"auto" }}>
            {sendingCart?<><Spin size={12}/> Adding…</>:"🛒 Send Kroger Items to Cart"}
          </Btn>
        )}
        <span style={{ fontSize:11, color:C.textMuted }}>{checkedCount}/{shopping.length} checked</span>
      </div>

      {pantryExcluded.length > 0 && <div style={{ background:C.greenSoft, border:`1px solid ${C.greenDim}44`, borderRadius:8, padding:"7px 12px", marginBottom:10, fontSize:12, color:C.green }}>✅ {pantryExcluded.length} pantry items excluded from list</div>}

      {viewMode === "byStore" && storeGroups.map(({store:s,items,total}) => (
        <div key={s.id} style={{ marginBottom:16 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 14px", background:s.color+"18", border:`1px solid ${s.color}44`, borderRadius:"10px 10px 0 0" }}>
            <span style={{ width:8, height:8, borderRadius:"50%", background:s.color, display:"inline-block" }}/>
            <span style={{ fontWeight:800, fontSize:13, color:s.color }}>{s.name}</span>
            {!s.live && <span style={{ fontSize:9, background:C.surface, color:C.textMuted, border:`1px solid ${C.border}`, borderRadius:10, padding:"1px 6px" }}>Est.</span>}
            <span style={{ fontSize:11, color:C.textMuted }}>{items.length} items</span>
            <span style={{ marginLeft:"auto", fontFamily:FD, fontSize:16, fontWeight:700, color:s.color }}>${total.toFixed(2)}</span>
          </div>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:"none", borderRadius:"0 0 10px 10px", overflow:"hidden" }}>
            {items.sort((a,b)=>a.name.localeCompare(b.name)).map((it,i) => <Row key={i} it={it}/>)}
          </div>
        </div>
      ))}

      {viewMode === "byAisle" && (Object.keys(byAisle).length > 0
        ? Object.entries(byAisle).map(([aisle,items]) => (
            <div key={aisle} style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, fontWeight:800, color:C.accent, padding:"6px 12px", background:C.accentSoft, borderRadius:8, display:"inline-block", marginBottom:5 }}>🗺 {aisle} · {items.length}</div>
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, overflow:"hidden" }}>
                {items.map((it,i) => <Row key={i} it={it}/>)}
              </div>
            </div>
          ))
        : <div style={{ textAlign:"center", padding:"30px", color:C.textMuted, fontSize:13 }}>Click <strong style={{ color:C.text }}>AI Sort Aisles</strong> to organize by store section</div>
      )}

      {viewMode === "list" && <div style={{ background:C.card, borderRadius:10, border:`1px solid ${C.border}`, overflow:"hidden", marginBottom:10 }}>{flatList.map((it,i) => <Row key={i} it={it}/>)}</div>}

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 16px", background:C.card, borderRadius:10, border:`1px solid ${C.border}`, marginTop:6 }}>
        <div><div style={{ fontWeight:700, fontSize:14 }}>Estimated Total</div><div style={{ fontSize:10, color:C.textMuted }}>Kroger via API · Others AI estimated</div></div>
        <span style={{ fontFamily:FD, fontWeight:700, fontSize:24, color:C.accent }}>${grand.toFixed(2)}</span>
      </div>
    </div>
  );
}


// --- PANTRY TAB ---------------------------------------------------------------
function PantryTab({ pantry, setPantry, recipes }) {
  const [q, setQ] = useState("");
  const [newItem, setNewItem] = useState("");
  const all = [...new Set(recipes.flatMap(r => (r.ingredients||[]).map(i => i.name.toLowerCase().trim())))].sort();
  const displayed = q ? all.filter(i => i.includes(q.toLowerCase())) : all;
  const toggle = name => setPantry(pantry.includes(name) ? pantry.filter(x=>x!==name) : [...pantry,name]);
  const addCustom = () => { const t=newItem.trim().toLowerCase(); if(!t) return; if(!pantry.includes(t)) setPantry([...pantry,t]); setNewItem(""); };
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14, flexWrap:"wrap", gap:10 }}>
        <div><span style={{ fontFamily:FD, fontSize:22, fontWeight:700 }}>Pantry</span><span style={{ fontSize:12, color:C.textMuted, marginLeft:10 }}>{pantry.length} items stocked</span></div>
        <div style={{ fontSize:12, color:C.green, background:C.greenSoft, border:`1px solid ${C.greenDim}44`, borderRadius:8, padding:"6px 12px" }}>✅ Stocked items excluded from shopping lists</div>
      </div>
      <div style={{ display:"flex", gap:8, marginBottom:14 }}>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search ingredients…" style={{ flex:1, background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:"7px 12px", color:C.text, fontSize:13 }}/>
        <input value={newItem} onChange={e=>setNewItem(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addCustom()} placeholder="Add custom item…" style={{ flex:1, background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:"7px 12px", color:C.text, fontSize:13 }}/>
        <Btn variant="secondary" onClick={addCustom} disabled={!newItem.trim()}>+ Add</Btn>
      </div>
      <div style={{ background:C.card, borderRadius:10, border:`1px solid ${C.border}`, overflow:"hidden", maxHeight:480, overflowY:"auto" }}>
        {displayed.length === 0 && <div style={{ padding:"30px", textAlign:"center", color:C.textMuted, fontSize:13 }}>No ingredients yet  -  add recipes first</div>}
        {displayed.map((name,i) => {
          const stocked = pantry.includes(name);
          return (
            <div key={i} onClick={()=>toggle(name)} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 14px", borderBottom:`1px solid ${C.border}`, cursor:"pointer", background:stocked?C.greenSoft:"transparent" }}>
              <div style={{ width:18, height:18, borderRadius:4, background:stocked?C.green:"transparent", border:`2px solid ${stocked?C.green:C.border}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                {stocked && <span style={{ color:"#0C1810", fontSize:11, fontWeight:900 }}>✓</span>}
              </div>
              <span style={{ fontSize:13, color:stocked?C.green:C.text, fontWeight:stocked?600:400, textTransform:"capitalize", flex:1 }}>{name}</span>
              {stocked && <span style={{ fontSize:10, color:C.green, fontWeight:700 }}>In stock ✓</span>}
            </div>
          );
        })}
      </div>
      {pantry.length > 0 && <Btn variant="danger" onClick={()=>setPantry([])} style={{ marginTop:12, width:"100%", justifyContent:"center" }}>🗑 Clear Entire Pantry</Btn>}
    </div>
  );
}

// --- BOOK TAB -----------------------------------------------------------------
function BookTab({ recipes, onRemove, onView }) {
  function printBook() {
    const style = document.createElement("style");
    style.textContent = `@media print{body>*{display:none!important}#rvp{display:block!important;position:fixed;top:0;left:0;width:100%;background:#fff;color:#111;font-family:Georgia,serif;z-index:9999}.rpp{page-break-after:always;padding:52px;max-width:720px;margin:0 auto}}`;
    const root = document.createElement("div"); root.id="rvp"; root.style.display="none";
    root.innerHTML = `<div style="text-align:center;padding:180px 52px;page-break-after:always"><div style="font-size:56px;margin-bottom:20px">📖</div><div style="font-family:Georgia,serif;font-size:44px;font-weight:bold;margin-bottom:10px">FamLee Dinner</div><div style="font-size:16px;color:#888">${recipes.length} recipes · ${new Date().toLocaleDateString("en-US",{year:"numeric",month:"long"})}</div></div>`
      + recipes.map((r,i) => `<div class="rpp"><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#aaa;margin-bottom:4px">${r.category} · ${r.mealType}</div><div style="font-family:Georgia,serif;font-size:28px;font-weight:bold;margin-bottom:6px">${r.title}</div><div style="font-size:12px;color:#666;margin-bottom:14px">⏱ ${r.prepTime}m prep · ${r.cookTime}m cook | 👥 ${r.servings} servings | ${"★".repeat(r.rating||0)}</div><hr style="border:none;border-top:1px solid #ddd;margin:14px 0"/><div style="font-size:10px;font-weight:bold;text-transform:uppercase;color:#999;margin-bottom:8px">Ingredients</div>${(r.ingredients||[]).map(i=>`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f5f5f5;font-size:13px"><span>${i.name}</span><span style="color:#666">${i.qty} ${i.unit}</span></div>`).join("")}<div style="font-size:10px;font-weight:bold;text-transform:uppercase;color:#999;margin:20px 0 8px">Instructions</div>${(r.instructions||"").split("\n").filter(Boolean).map(l=>`<div style="font-size:13px;line-height:1.85;margin-bottom:5px">${l}</div>`).join("")}${r.notes?`<div style="font-size:12px;font-style:italic;color:#666;margin-top:14px;padding:10px;border-left:3px solid #c04a0a">💡 ${r.notes}</div>`:""}${r.videoUrl?`<div style="font-size:11px;color:#0073CF;margin-top:10px">📹 ${r.videoUrl}</div>`:""}${r.macros?.calories?`<div style="margin-top:10px;padding:8px;background:#f9f5f0;border-radius:6px;font-size:11px">Per serving: 🔥${r.macros.calories}kcal · P:${r.macros.protein}g · C:${r.macros.carbs}g · F:${r.macros.fat}g</div>`:""}<div style="font-size:10px;color:#ccc;text-align:right;margin-top:24px">Recipe ${i+2} of ${recipes.length+1}</div></div>`).join("");
    document.head.appendChild(style); document.body.appendChild(root); window.print();
    setTimeout(() => { try { document.head.removeChild(style); document.body.removeChild(root); } catch {} }, 1500);
  }
  if (!recipes.length) return <div style={{ textAlign:"center", padding:"90px 0", color:C.textMuted }}><div style={{ fontSize:44 }}>📖</div><div style={{ fontSize:16, fontWeight:600, color:C.textDim, marginTop:10 }}>Recipe book is empty</div><div style={{ fontSize:12, marginTop:5 }}>Open any recipe → "Add to Book"</div></div>;
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <span style={{ fontFamily:FD, fontSize:22, fontWeight:700 }}>My Recipe Book <span style={{ fontFamily:FB, fontSize:13, color:C.textMuted, fontWeight:400 }}>{recipes.length} recipes</span></span>
        <Btn variant="primary" onClick={printBook}>🖨 Export / Print PDF</Btn>
      </div>
      <div style={{ background:`linear-gradient(135deg,${C.accent},${C.accentDim})`, borderRadius:14, padding:"24px 22px", marginBottom:18, display:"flex", alignItems:"center", gap:20 }}>
        <div style={{ fontSize:52 }}>📖</div>
        <div><div style={{ fontFamily:FD, fontSize:32, fontWeight:700, color:"#fff" }}>FamLee Dinner</div><div style={{ fontSize:13, color:"#fff9" }}>{recipes.length} family favorites</div></div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(185px,1fr))", gap:11 }}>
        {recipes.map((r,i) => (
          <div key={r.id} style={{ background:C.card, borderRadius:10, border:`1px solid ${C.border}`, overflow:"hidden", cursor:"pointer" }} onClick={()=>onView(r)}>
            {r.image ? <img src={r.image} alt={r.title} style={{ width:"100%", height:110, objectFit:"cover" }} onError={e=>e.target.style.display="none"}/> : <div style={{ height:110, background:C.surface, display:"flex", alignItems:"center", justifyContent:"center", fontSize:32 }}>🍳</div>}
            <div style={{ padding:"9px 11px" }}>
              <div style={{ fontSize:9, color:C.textMuted, fontWeight:700, textTransform:"uppercase", marginBottom:2 }}>pg {i+2} · {r.category}</div>
              <div style={{ fontFamily:FD, fontSize:13, fontWeight:700, lineHeight:1.2, marginBottom:5 }}>{r.title}</div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <Stars n={r.rating}/>
                <button onClick={e=>{e.stopPropagation();onRemove(r);}} style={{ background:"none", border:"none", color:C.red, cursor:"pointer", fontSize:11 }}>Remove</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- MACROS TAB ---------------------------------------------------------------
function MacrosTab({ profile, onSaveProfile, macroLog, todayTotals, addMacroEntry, removeMacroEntry, recipes, authUser }) {
  const [subTab, setSubTab] = useState("today");
  const bars = [
    { key:"cal",     label:"Calories", goal:profile.goalCal,     val:todayTotals.cal,     unit:"kcal", color:C.accent  },
    { key:"protein", label:"Protein",  goal:profile.goalProtein, val:todayTotals.protein, unit:"g",    color:"#4CAF62" },
    { key:"carbs",   label:"Carbs",    goal:profile.goalCarbs,   val:todayTotals.carbs,   unit:"g",    color:"#E8A838" },
    { key:"fat",     label:"Fat",      goal:profile.goalFat,     val:todayTotals.fat,     unit:"g",    color:"#D97B35" },
  ];
  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14, flexWrap:"wrap" }}>
        <span style={{ fontFamily:FD, fontSize:22, fontWeight:700 }}>📊 Macro Tracker</span>
        <div style={{ display:"flex", gap:4, marginLeft:"auto" }}>
          {[["today","Today"],["goals","Goals"]].map(([id,lbl]) => <button key={id} onClick={()=>setSubTab(id)} style={{ background:subTab===id?C.accent:C.surface, color:subTab===id?"#0C1810":C.textDim, border:`1px solid ${subTab===id?C.accent:C.border}`, borderRadius:8, padding:"5px 12px", cursor:"pointer", fontSize:12, fontWeight:700 }}>{lbl}</button>)}
        </div>
      </div>
      {subTab === "today" && (
        <div>
          {/* Progress cards */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:20 }}>
            {bars.map(b => {
              const pct = Math.min(100, Math.round((b.val/(b.goal||1))*100));
              const over = b.val > b.goal;
              return (
                <div key={b.key} style={{ background:C.card, border:`2px solid ${over?"#E5393544":b.color+"44"}`, borderRadius:12, padding:"16px 12px", textAlign:"center" }}>
                  <div style={{ fontSize:10, color:b.color, fontWeight:700, textTransform:"uppercase", marginBottom:8 }}>{b.label}</div>
                  <div style={{ fontFamily:FD, fontSize:28, fontWeight:700, color:over?"#E53935":b.color, marginBottom:4 }}>{b.val}</div>
                  <div style={{ fontSize:11, color:C.textMuted, marginBottom:8 }}>{b.unit}</div>
                  <div style={{ height:6, background:C.border, borderRadius:3, marginBottom:5, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:pct+"%", background:over?"#E53935":b.color, borderRadius:3 }}/>
                  </div>
                  <div style={{ fontSize:10, color:over?"#E53935":C.textMuted }}>{over?`+${b.val-b.goal} over`:`${b.goal-b.val} left`}</div>
                  <div style={{ fontSize:9, color:C.textMuted }}>goal: {b.goal}</div>
                </div>
              );
            })}
          </div>
          <FoodLogger onAdd={addMacroEntry} recipes={recipes}/>
          {macroLog.length > 0 && (
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, overflow:"hidden" }}>
              <div style={{ padding:"10px 14px", background:C.surface, borderBottom:`1px solid ${C.border}`, fontSize:11, fontWeight:700, color:C.textMuted, textTransform:"uppercase" }}>Today's Log</div>
              {macroLog.map((entry,i) => (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderBottom:`1px solid ${C.border}` }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:600, color:C.text }}>{entry.label}</div>
                    {entry.servings && <div style={{ fontSize:10, color:C.textMuted }}>{entry.servings} serving{entry.servings!==1?"s":""}</div>}
                  </div>
                  <div style={{ display:"flex", gap:10, fontSize:11, flexShrink:0 }}>
                    <span style={{ color:C.accent, fontWeight:700 }}>{entry.cal}kcal</span>
                    <span style={{ color:"#4CAF62" }}>P:{entry.protein}g</span>
                    <span style={{ color:"#E8A838" }}>C:{entry.carbs}g</span>
                    <span style={{ color:"#D97B35" }}>F:{entry.fat}g</span>
                  </div>
                  <button onClick={()=>removeMacroEntry(i)} style={{ background:"none", border:"none", color:C.red, cursor:"pointer", fontSize:14, flexShrink:0 }}>✕</button>
                </div>
              ))}
              <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 14px", background:C.surface, fontSize:12, fontWeight:700 }}>
                <span>Total</span>
                <div style={{ display:"flex", gap:12 }}>
                  <span style={{ color:C.accent }}>{todayTotals.cal}kcal</span>
                  <span style={{ color:"#4CAF62" }}>P:{todayTotals.protein}g</span>
                  <span style={{ color:"#E8A838" }}>C:{todayTotals.carbs}g</span>
                  <span style={{ color:"#D97B35" }}>F:{todayTotals.fat}g</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {subTab === "goals" && (
        <GoalsTab profile={profile} onSave={onSaveProfile}/>
      )}
    </div>
  );
}

function FoodLogger({ onAdd, recipes }) {
  const [mode, setMode] = useState("search");
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [servings, setServings] = useState(1);
  const [manual, setManual] = useState({ label:"", cal:"", protein:"", carbs:"", fat:"" });
  const [showPanel, setShowPanel] = useState(false);

  async function doSearch() {
    if (!q.trim()) return;
    setLoading(true); setResults([]); setSelected(null);
    try {
      const offRes = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=8&fields=product_name,brands,nutriments,serving_size`);
      const offData = await offRes.json();
      const offFoods = (offData.products||[]).filter(p=>p.product_name&&p.nutriments?.["energy-kcal_serving"]||p.nutriments?.["energy-kcal_100g"]).map(p => ({
        id:"off_"+p.code,
        label: p.product_name + (p.brands ? " ("+p.brands.split(",")[0].trim()+")" : ""),
        cal:     Math.round(p.nutriments["energy-kcal_serving"]     || p.nutriments["energy-kcal_100g"]         || 0),
        protein: Math.round(p.nutriments["proteins_serving"]        || p.nutriments["proteins_100g"]            || 0),
        carbs:   Math.round(p.nutriments["carbohydrates_serving"]   || p.nutriments["carbohydrates_100g"]       || 0),
        fat:     Math.round(p.nutriments["fat_serving"]             || p.nutriments["fat_100g"]                 || 0),
        serving: p.serving_size || "1 serving", source:"Open Food Facts",
      }));
      let usdaFoods = [];
      try {
        const ur = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${USDA_KEY}&query=${encodeURIComponent(q)}&pageSize=5&dataType=Foundation,SR%20Legacy`);
        const ud = await ur.json();
        usdaFoods = (ud.foods||[]).slice(0,5).map(f => {
          const n = f.foodNutrients||[];
          const get = id => Math.round(n.find(x=>x.nutrientId===id||x.nutrientNumber===String(id))?.value||0);
          return { id:"usda_"+f.fdcId, label:f.description, cal:get(1008), protein:get(1003), carbs:get(1005), fat:get(1004), serving:"100g", source:"USDA" };
        }).filter(f=>f.cal>0);
      } catch {}
      setResults([...offFoods,...usdaFoods].slice(0,12));
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  const recipeOpts = recipes.filter(r => r.macros?.calories > 0 && (!q || r.title.toLowerCase().includes(q.toLowerCase())));

  function add() {
    if (!selected) return;
    onAdd({ ...selected, cal:Math.round(selected.cal*servings), protein:Math.round(selected.protein*servings), carbs:Math.round(selected.carbs*servings), fat:Math.round(selected.fat*servings), servings });
    setSelected(null); setServings(1); setShowPanel(false);
  }

  function addManual() {
    if (!manual.label || !manual.cal) return;
    onAdd({ label:manual.label, cal:Number(manual.cal), protein:Number(manual.protein)||0, carbs:Number(manual.carbs)||0, fat:Number(manual.fat)||0, servings:1, source:"manual" });
    setManual({ label:"", cal:"", protein:"", carbs:"", fat:"" }); setShowPanel(false);
  }

  return (
    <div style={{ marginBottom:16 }}>
      <Btn variant="primary" onClick={()=>setShowPanel(v=>!v)} style={{ width:"100%", justifyContent:"center", marginBottom:showPanel?10:0 }}>+ Add Food / Meal</Btn>
      {showPanel && (
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:16 }}>
          <div style={{ display:"flex", gap:4, marginBottom:12, background:C.surface, padding:3, borderRadius:9, border:`1px solid ${C.border}` }}>
            {[["search","🔍 Search"],["recipe","🍽 Recipe"],["manual","✏️ Manual"]].map(([id,lbl]) => <button key={id} onClick={()=>{setMode(id);setSelected(null);}} style={{ flex:1, background:mode===id?C.accent:"transparent", color:mode===id?"#0C1810":C.textDim, border:"none", borderRadius:7, padding:"6px 0", cursor:"pointer", fontSize:11, fontWeight:700 }}>{lbl}</button>)}
          </div>
          {mode === "search" && (
            <div>
              <div style={{ display:"flex", gap:7, marginBottom:8 }}>
                <input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doSearch()} placeholder="Search foods… yogurt, chicken breast, banana…" autoFocus style={{ flex:1, background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"7px 11px", color:C.text, fontSize:13 }}/>
                <Btn variant="primary" onClick={doSearch} disabled={loading||!q.trim()}>{loading?<Spin size={13}/>:"Search"}</Btn>
              </div>
              <div style={{ fontSize:10, color:C.textMuted, marginBottom:8 }}>Searches Open Food Facts + USDA database · Zero AI tokens used</div>
              <div style={{ display:"flex", flexDirection:"column", gap:4, maxHeight:200, overflowY:"auto", marginBottom:10 }}>
                {results.map(f => (
                  <button key={f.id} onClick={()=>setSelected(f)} style={{ background:selected?.id===f.id?C.greenSoft:C.surface, border:`1px solid ${selected?.id===f.id?C.green:C.border}`, borderRadius:8, padding:"8px 12px", cursor:"pointer", textAlign:"left", display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:600, color:C.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{f.label}</div>
                      <div style={{ fontSize:10, color:C.textMuted }}>{f.serving} · {f.source}</div>
                    </div>
                    <div style={{ display:"flex", gap:8, fontSize:11, flexShrink:0 }}>
                      <span style={{ color:C.accent, fontWeight:700 }}>{f.cal}kcal</span>
                      <span style={{ color:"#4CAF62" }}>P:{f.protein}g</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
          {mode === "recipe" && (
            <div>
              <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Filter recipes…" style={{ width:"100%", background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"7px 11px", color:C.text, fontSize:13, marginBottom:8 }}/>
              <div style={{ display:"flex", flexDirection:"column", gap:4, maxHeight:200, overflowY:"auto", marginBottom:10 }}>
                {recipeOpts.map(r => (
                  <button key={r.id} onClick={()=>setSelected({id:"r_"+r.id,label:r.title,cal:r.macros.calories,protein:r.macros.protein,carbs:r.macros.carbs,fat:r.macros.fat,serving:`1 of ${r.servings} servings`,source:"recipe"})} style={{ background:selected?.id==="r_"+r.id?C.greenSoft:C.surface, border:`1px solid ${selected?.id==="r_"+r.id?C.green:C.border}`, borderRadius:8, padding:"8px 12px", cursor:"pointer", textAlign:"left", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div style={{ flex:1 }}><div style={{ fontSize:12, fontWeight:600, color:C.text }}>{r.title}</div><div style={{ fontSize:10, color:C.textMuted }}>per serving · {r.servings} total</div></div>
                    <span style={{ color:C.accent, fontWeight:700, fontSize:12 }}>{r.macros.calories}kcal</span>
                  </button>
                ))}
                {recipeOpts.length === 0 && <div style={{ color:C.textMuted, fontSize:12, textAlign:"center", padding:"20px 0" }}>No recipes with macros yet  -  import recipes to auto-calculate them.</div>}
              </div>
            </div>
          )}
          {mode === "manual" && (
            <div>
              <div style={{ marginBottom:8 }}><input value={manual.label} onChange={e=>setManual(p=>({...p,label:e.target.value}))} placeholder="Food / meal name…" style={{ width:"100%", background:C.surface, border:`1px solid ${C.border}`, borderRadius:7, padding:"7px 10px", color:C.text, fontSize:13 }}/></div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:12 }}>
                {[["cal","🔥 Cal","kcal"],["protein","💪 Protein","g"],["carbs","🌾 Carbs","g"],["fat","🫙 Fat","g"]].map(([k,lbl,u]) => (
                  <div key={k}><div style={{ fontSize:9, color:C.textMuted, fontWeight:700, marginBottom:3 }}>{lbl} ({u})</div><input type="number" value={manual[k]} onChange={e=>setManual(p=>({...p,[k]:e.target.value}))} placeholder="0" style={{ width:"100%", background:C.surface, border:`1px solid ${C.border}`, borderRadius:7, padding:"6px 7px", color:C.text, fontSize:13 }}/></div>
                ))}
              </div>
              <Btn variant="primary" onClick={addManual} disabled={!manual.label||!manual.cal} style={{ width:"100%", justifyContent:"center" }}>✅ Add to Log</Btn>
            </div>
          )}
          {selected && mode !== "manual" && (
            <div style={{ background:C.greenSoft, border:`1px solid ${C.greenDim}44`, borderRadius:9, padding:"12px 14px", marginTop:8 }}>
              <div style={{ fontSize:11, color:C.green, fontWeight:700, marginBottom:8 }}>{selected.label}</div>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                <span style={{ fontSize:12, color:C.textDim }}>Servings:</span>
                <button onClick={()=>setServings(s=>Math.max(0.5,+(s-0.5).toFixed(1)))} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:5, width:22, height:22, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700 }}>−</button>
                <span style={{ fontFamily:FD, fontSize:18, fontWeight:700, color:C.accent, minWidth:28, textAlign:"center" }}>{servings}</span>
                <button onClick={()=>setServings(s=>+(s+0.5).toFixed(1))} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:5, width:22, height:22, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700 }}>+</button>
                <span style={{ fontSize:11, color:C.textDim }}>= 🔥{Math.round(selected.cal*servings)} · P:{Math.round(selected.protein*servings)}g · C:{Math.round(selected.carbs*servings)}g · F:{Math.round(selected.fat*servings)}g</span>
              </div>
              <Btn variant="primary" onClick={add} style={{ width:"100%", justifyContent:"center" }}>✅ Add to Log</Btn>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GoalsTab({ profile, onSave }) {
  const [form, setForm] = useState({ name:profile.name||"Me", goalCal:profile.goalCal||2000, goalProtein:profile.goalProtein||150, goalCarbs:profile.goalCarbs||200, goalFat:profile.goalFat||65 });
  const [saved, setSaved] = useState(false);
  function save() { onSave(form); setSaved(true); setTimeout(()=>setSaved(false),2000); }
  const total = form.goalProtein*4 + form.goalCarbs*4 + form.goalFat*9;
  return (
    <div style={{ maxWidth:440 }}>
      <div style={{ fontSize:13, color:C.textDim, marginBottom:16 }}>Set your daily macro targets. The banner and progress rings update as you log food.</div>
      <div style={{ marginBottom:12 }}><div style={{ fontSize:10, color:C.textMuted, fontWeight:700, textTransform:"uppercase", marginBottom:4 }}>Your Name</div><input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} style={{ width:"100%", background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"8px 11px", color:C.text, fontSize:13 }}/></div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
        {[["goalCal","🔥 Daily Calories","kcal"],["goalProtein","💪 Protein","g/day"],["goalCarbs","🌾 Carbs","g/day"],["goalFat","🫙 Fat","g/day"]].map(([k,lbl,u]) => (
          <div key={k}><div style={{ fontSize:10, color:C.textMuted, fontWeight:700, marginBottom:4 }}>{lbl}</div>
            <div style={{ display:"flex", alignItems:"center", gap:5 }}>
              <input type="number" value={form[k]} onChange={e=>setForm(p=>({...p,[k]:Number(e.target.value)}))} style={{ flex:1, background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"7px 9px", color:C.text, fontSize:14, fontWeight:700 }}/>
              <span style={{ fontSize:11, color:C.textMuted }}>{u}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:"12px 14px", marginBottom:16 }}>
        <div style={{ fontSize:11, fontWeight:700, color:C.textMuted, marginBottom:8 }}>MACRO SPLIT</div>
        <div style={{ display:"flex", height:12, borderRadius:6, overflow:"hidden", marginBottom:8 }}>
          {[{g:form.goalProtein*4,c:"#4CAF62"},{g:form.goalCarbs*4,c:"#E8A838"},{g:form.goalFat*9,c:"#D97B35"}].map((b,i) => <div key={i} style={{ flex:b.g/total, background:b.c }}/>)}
        </div>
        <div style={{ display:"flex", gap:12, fontSize:11 }}>
          <span style={{ color:"#4CAF62" }}>Protein {Math.round(form.goalProtein*4/total*100)}%</span>
          <span style={{ color:"#E8A838" }}>Carbs {Math.round(form.goalCarbs*4/total*100)}%</span>
          <span style={{ color:"#D97B35" }}>Fat {Math.round(form.goalFat*9/total*100)}%</span>
        </div>
      </div>
      <Btn variant="primary" onClick={save} style={{ width:"100%", justifyContent:"center" }}>{saved?"✅ Saved!":"💾 Save Goals"}</Btn>
    </div>
  );
}

// --- DETAIL MODAL -------------------------------------------------------------
function DetailModal({ recipe:r, onClose, onEdit, onToggleBook, onLogCook, onDup, onLogMacro }) {
  const [tab, setTab] = useState("instructions");
  const [scale, setScale] = useState(r.servings||4);
  const [showMacroLog, setShowMacroLog] = useState(false);
  const [macroServings, setMacroServings] = useState(1);
  const [cookNote, setCookNote] = useState("");
  const [cookRating, setCookRating] = useState(r.rating||5);
  const [cookSaved, setCookSaved] = useState(false);
  const ratio = scale / (r.servings||4);
  const fmt2 = qty => { const s=qty*ratio; return s===Math.round(s)?String(s):s.toFixed(1).replace(/\.0$/,""); };

  return (
    <Modal onClose={onClose} width={620} noPad>
      {r.image && (
        <div style={{ height:210, overflow:"hidden", borderRadius:"16px 16px 0 0", position:"relative" }}>
          <img src={r.image} alt={r.title} style={{ width:"100%", height:"100%", objectFit:"cover" }} onError={e=>e.target.parentNode.style.display="none"}/>
          <div style={{ position:"absolute", top:0, left:0, right:0, bottom:0, background:`linear-gradient(to bottom,transparent 40%,${C.card}EE)` }}/>
          <div style={{ position:"absolute", bottom:14, left:20, right:20 }}>
            <div style={{ fontFamily:FD, fontSize:24, fontWeight:700, color:"#fff", textShadow:"0 1px 4px rgba(0,0,0,.6)" }}>{r.title}</div>
          </div>
        </div>
      )}
      <div style={{ padding:22 }}>
        {!r.image && <div style={{ fontFamily:FD, fontSize:22, fontWeight:700, marginBottom:8 }}>{r.title}</div>}
        <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap", marginBottom:8 }}>
          {[r.category,r.mealType,...(r.tags||[])].map(t => <span key={t} style={{ background:C.accentSoft, color:C.accent, border:`1px solid ${C.accentDim}44`, borderRadius:20, padding:"2px 8px", fontSize:10, fontWeight:700 }}>{t}</span>)}
          {r.makesLeftovers && <span style={{ background:C.greenSoft, color:C.green, border:`1px solid ${C.greenDim}44`, borderRadius:20, padding:"2px 8px", fontSize:10, fontWeight:700 }}>↩ Leftovers</span>}
        </div>
        <div style={{ display:"flex", gap:12, alignItems:"center", flexWrap:"wrap", marginBottom:10 }}>
          <Stars n={r.rating}/>
          <span style={{ color:C.textDim, fontSize:12 }}>⏱ {r.prepTime}m prep · {r.cookTime}m cook</span>
          {r.macros?.calories > 0 && <span style={{ color:C.accent, fontSize:12, fontWeight:700 }}>🔥 {Math.round(r.macros.calories*ratio)} kcal</span>}
        </div>
        {/* Serving scaler */}
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12, padding:"8px 12px", background:C.surface, border:`1px solid ${C.border}`, borderRadius:9 }}>
          <span style={{ fontSize:11, color:C.textMuted, fontWeight:600 }}>Servings:</span>
          <button onClick={()=>setScale(s=>Math.max(1,s-1))} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:5, width:24, height:24, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700 }}>−</button>
          <span style={{ fontFamily:FD, fontSize:20, fontWeight:700, color:C.accent, minWidth:28, textAlign:"center" }}>{scale}</span>
          <button onClick={()=>setScale(s=>s+1)} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:5, width:24, height:24, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700 }}>+</button>
          {scale !== r.servings && <span style={{ fontSize:11, color:C.orange }}>scaled from {r.servings}</span>}
        </div>
        {/* Actions */}
        <div style={{ display:"flex", gap:7, marginBottom:10, flexWrap:"wrap" }}>
          <Btn variant="ghost" onClick={()=>onEdit(r)} style={{ padding:"5px 10px", fontSize:12 }}>✏️ Edit</Btn>
          <Btn variant="ghost" onClick={()=>onDup(r)} style={{ padding:"5px 10px", fontSize:12 }}>📋 Duplicate</Btn>
          <Btn variant={r.inBook?"secondary":"ghost"} onClick={()=>onToggleBook(r)} style={{ padding:"5px 10px", fontSize:12 }}>{r.inBook?"📖 In Book":"📖 Add to Book"}</Btn>
          <Btn variant="primary" onClick={()=>setTab("cooklog")} style={{ padding:"5px 10px", fontSize:12 }}>🍴 Cooked It!</Btn>
          {r.macros?.calories > 0 && <Btn variant="secondary" onClick={()=>setShowMacroLog(v=>!v)} style={{ padding:"5px 10px", fontSize:12 }}>📊 Log to Macros</Btn>}
        </div>
        {/* Macro log panel */}
        {showMacroLog && r.macros?.calories > 0 && (
          <div style={{ background:C.greenSoft, border:`1px solid ${C.greenDim}44`, borderRadius:10, padding:"12px 14px", marginBottom:10 }}>
            <div style={{ fontSize:11, color:C.green, fontWeight:700, marginBottom:8 }}>📊 Log to Today's Macros</div>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
              <span style={{ fontSize:12, color:C.textDim }}>Servings:</span>
              <button onClick={()=>setMacroServings(s=>Math.max(0.5,+(s-0.5).toFixed(1)))} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:5, width:22, height:22, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700 }}>−</button>
              <span style={{ fontFamily:FD, fontSize:18, fontWeight:700, color:C.accent, minWidth:28, textAlign:"center" }}>{macroServings}</span>
              <button onClick={()=>setMacroServings(s=>+(s+0.5).toFixed(1))} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:5, width:22, height:22, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700 }}>+</button>
              <span style={{ fontSize:11, color:C.textDim }}>= 🔥{Math.round(r.macros.calories*macroServings)} · P:{Math.round(r.macros.protein*macroServings)}g</span>
            </div>
            <Btn variant="primary" onClick={()=>{onLogMacro({label:r.title,cal:Math.round(r.macros.calories*macroServings),protein:Math.round(r.macros.protein*macroServings),carbs:Math.round(r.macros.carbs*macroServings),fat:Math.round(r.macros.fat*macroServings),servings:macroServings,source:"recipe"});setShowMacroLog(false);}} style={{ width:"100%", justifyContent:"center" }}>✅ Add to Today's Log</Btn>
          </div>
        )}
        {r.videoUrl && (
          <div style={{ marginBottom:10, padding:"8px 12px", background:C.accentSoft, border:`1px solid ${C.accentDim}44`, borderRadius:8, display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:18 }}>📹</span>
            <a href={r.videoUrl} target="_blank" rel="noopener noreferrer" style={{ color:C.accent, fontSize:12, fontWeight:600, textDecoration:"none" }} onClick={e=>e.stopPropagation()}>Watch Video ↗</a>
          </div>
        )}
        {r.sourceUrl && (
          <div style={{ marginBottom:10, padding:"7px 12px", background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:16 }}>🔗</span>
            <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color:C.textDim, fontSize:11, fontWeight:600, textDecoration:"none", wordBreak:"break-all" }} onClick={e=>e.stopPropagation()}>{r.sourceUrl.replace(/https?:\/\/(www\.)?/,"").slice(0,60)}{r.sourceUrl.length>70?"…":""} ↗</a>
          </div>
        )}
        {/* Tabs */}
        <div style={{ display:"flex", gap:5, marginBottom:12, flexWrap:"wrap" }}>
          {[["instructions","Instructions"],["ingredients","Ingredients"],["macros","Macros"],["cooklog","Cook Log"],["prices","Prices"]].map(([id,lbl]) => <button key={id} onClick={()=>setTab(id)} style={{ background:tab===id?C.accent:C.surface, color:tab===id?"#0C1810":C.textDim, border:`1px solid ${tab===id?C.accent:C.border}`, borderRadius:7, padding:"4px 11px", fontSize:11, fontWeight:600, cursor:"pointer" }}>{lbl}</button>)}
        </div>
        <div style={{ maxHeight:280, overflowY:"auto" }}>
          {tab==="ingredients" && (r.ingredients||[]).map((ing,i) => (
            <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 0", borderBottom:`1px solid ${C.border}`, fontSize:13 }}>
              <span style={{ color:C.text }}>{ing.onSale&&"🏷 "}{ing.name}</span>
              <span style={{ color:C.accent, fontWeight:700 }}>{fmt2(ing.qty)} {ing.unit}{scale!==r.servings&&<span style={{ fontSize:10, color:C.textMuted, marginLeft:4 }}>(scaled)</span>}</span>
            </div>
          ))}
          {tab==="instructions" && (r.noRecipeNeeded
            ? <div style={{ color:C.textDim, fontSize:13, fontStyle:"italic", padding:"12px 0" }}>⚡ Quick meal  -  cook to taste!{r.notes&&<div style={{ marginTop:10, padding:10, background:C.accentSoft, borderRadius:8, fontStyle:"normal" }}>💡 {r.notes}</div>}</div>
            : <div>{(r.instructions||"").split("\n").filter(Boolean).map((line,i) => <div key={i} style={{ display:"flex", gap:10, padding:"7px 0", borderBottom:`1px solid ${C.border}`, fontSize:13, lineHeight:1.6 }}><span style={{ color:C.accent, fontWeight:700, minWidth:20 }}>{line.match(/^\d+/)?.[0]||"·"}</span><span style={{ color:C.textDim }}>{line.replace(/^\d+[:.]\s*/,"")}</span></div>)}{r.notes&&<div style={{ marginTop:12, padding:"10px 12px", background:C.accentSoft, borderRadius:8, color:C.textDim, fontSize:13 }}>💡 {r.notes}</div>}</div>
          )}
          {tab==="macros" && (r.macros?.calories > 0
            ? <div>
                <div style={{ background:C.accentSoft, border:`1px solid ${C.accent}44`, borderRadius:10, padding:"12px 16px", marginBottom:12, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <div><div style={{ fontSize:10, color:C.accent, fontWeight:700, textTransform:"uppercase" }}>Calories / serving{scale!==r.servings?` (×${ratio.toFixed(1)} scaled)`:""}</div><div style={{ fontFamily:FD, fontSize:34, fontWeight:700, color:C.accent }}>{Math.round((r.macros.calories||0)*ratio)}</div></div><span style={{ fontSize:28 }}>🔥</span>
                </div>
                {[{l:"Protein",v:r.macros.protein,u:"g",c:"#4CAF62",max:60,e:"💪"},{l:"Carbs",v:r.macros.carbs,u:"g",c:"#E8A838",max:100,e:"🌾"},{l:"Fat",v:r.macros.fat,u:"g",c:"#D97B35",max:60,e:"🫙"},{l:"Fiber",v:r.macros.fiber,u:"g",c:"#7CAF52",max:30,e:"🥦"},{l:"Sugar",v:r.macros.sugar,u:"g",c:"#E07090",max:50,e:"🍬"},{l:"Sodium",v:r.macros.sodium,u:"mg",c:"#9090C0",max:2300,e:"🧂"}].map(m => (
                  <div key={m.l} style={{ marginBottom:8 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}><span style={{ fontSize:12 }}>{m.e} {m.l}</span><span style={{ fontSize:12, fontWeight:700, color:m.c }}>{Math.round((m.v||0)*ratio)}{m.u}</span></div>
                    <div style={{ height:5, background:C.border, borderRadius:3 }}><div style={{ height:"100%", width:`${Math.min(100,((m.v||0)*ratio/m.max)*100)}%`, background:m.c, borderRadius:3 }}/></div>
                  </div>
                ))}
              </div>
            : <div style={{ textAlign:"center", padding:"24px 0", color:C.textMuted }}><div style={{ fontSize:28 }}>📊</div><div style={{ fontSize:13, marginTop:8 }}>No macros  -  edit recipe to add them</div></div>
          )}
          {tab==="cooklog" && (
            <div>
              {!cookSaved ? (
                <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:"12px 14px", marginBottom:12 }}>
                  <div style={{ fontSize:10, color:C.textMuted, fontWeight:700, textTransform:"uppercase", marginBottom:8 }}>Log This Cook</div>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}><span style={{ fontSize:12, color:C.textDim }}>Rating:</span><Stars n={cookRating} onChange={setCookRating}/></div>
                  <textarea value={cookNote} onChange={e=>setCookNote(e.target.value)} rows={2} placeholder="Notes… added more garlic, kids loved it…" style={{ width:"100%", background:C.card, border:`1px solid ${C.border}`, borderRadius:7, padding:"7px 10px", color:C.text, fontSize:12, resize:"none", marginBottom:8, fontFamily:FB }}/>
                  <Btn variant="primary" onClick={()=>{onLogCook(r.id,cookRating,cookNote);setCookSaved(true);}} style={{ width:"100%", justifyContent:"center" }}>🍴 Save Cook Log</Btn>
                </div>
              ) : <div style={{ background:C.greenSoft, border:`1px solid ${C.greenDim}44`, borderRadius:9, padding:"10px 14px", marginBottom:12, fontSize:13, color:C.green, textAlign:"center" }}>✅ Logged! Great cooking!</div>}
              {(r.cookLog||[]).length === 0 && !cookSaved && <div style={{ color:C.textMuted, fontSize:13, textAlign:"center", padding:"16px 0" }}>No cook history yet</div>}
              {(r.cookLog||[]).map((log,i) => (
                <div key={i} style={{ padding:"10px 0", borderBottom:`1px solid ${C.border}` }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}><Stars n={log.rating}/><span style={{ fontSize:11, color:C.textMuted }}>{fmt(log.date)}</span></div>
                  {log.note && <div style={{ fontSize:12, color:C.textDim }}>{log.note}</div>}
                </div>
              ))}
            </div>
          )}
          {tab==="prices" && (
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                <thead><tr><th style={{ textAlign:"left", color:C.textMuted, fontWeight:700, fontSize:9, textTransform:"uppercase", padding:"4px 0", borderBottom:`1px solid ${C.border}` }}>Ingredient</th>{STORES.map(s=><th key={s.id} style={{ color:s.color, fontWeight:800, fontSize:9, textTransform:"uppercase", textAlign:"right", padding:"4px 6px", borderBottom:`1px solid ${C.border}` }}>{s.short}</th>)}</tr></thead>
                <tbody>{(r.ingredients||[]).map((ing,i) => { const [bs]=bp(ing); return <tr key={i}><td style={{ color:C.text, padding:"6px 0", borderBottom:`1px solid ${C.border}` }}>{ing.name}</td>{STORES.map(s=>{const p=gp(ing,s.id);return<td key={s.id} style={{ textAlign:"right",padding:"6px 6px",borderBottom:`1px solid ${C.border}`,color:s.id===bs&&p>0?C.green:p>0?C.textDim:C.border,fontWeight:s.id===bs&&p>0?700:400}}>{p?`$${p.toFixed(2)}`:" - "}</td>;})}</tr>; })}</tbody>
                <tfoot><tr><td style={{ fontWeight:700, padding:"8px 0", fontSize:12 }}>Total</td>{STORES.map(s=>{const t=rc(r,s.id);return<td key={s.id} style={{ textAlign:"right",padding:"8px 6px",color:t>0?C.textDim:C.border,fontSize:12}}>{t>0?`$${t.toFixed(2)}`:" - "}</td>;})}</tr></tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// --- PICK SLOT MODAL ----------------------------------------------------------
function PickSlotModal({ ctx, recipes, onSet, onClose }) {
  const [q, setQ] = useState("");
  const list = recipes.filter(r => !q || r.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal onClose={onClose} width={440}>
      <div style={{ fontFamily:FD, fontSize:18, fontWeight:700, marginBottom:12 }}>Add to {ctx.day} {ctx.meal}</div>
      <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search recipes…" autoFocus style={{ width:"100%", background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"7px 11px", color:C.text, fontSize:13, marginBottom:10 }}/>
      <div style={{ display:"flex", flexDirection:"column", gap:5, maxHeight:360, overflowY:"auto" }}>
        {list.map(r => (
          <button key={r.id} onClick={()=>{onSet(ctx.key,r);onClose();}} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:9, padding:"9px 13px", cursor:"pointer", textAlign:"left", color:C.text, fontSize:13, display:"flex", alignItems:"center", gap:10 }}>
            {r.image && <img src={r.image} style={{ width:36, height:36, borderRadius:5, objectFit:"cover", flexShrink:0 }} onError={e=>e.target.style.display="none"}/>}
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{r.title}</div>
              <div style={{ fontSize:10, color:C.textDim }}>{r.category} · ⏱{r.prepTime+r.cookTime}m{r.noRecipeNeeded?" · ⚡":""}{r.makesLeftovers?" · ↩":""}</div>
            </div>
            <Stars n={r.rating}/>
          </button>
        ))}
      </div>
      <Btn variant="ghost" onClick={onClose} style={{ width:"100%", marginTop:10, justifyContent:"center" }}>Cancel</Btn>
    </Modal>
  );
}

// --- IMPORT MODAL -------------------------------------------------------------
// --- RECIPE EXTRACTION SYSTEM PROMPT -----------------------------------------
const SYS = `You are a recipe extraction expert. Extract ALL details from the recipe and return ONLY valid JSON with no other text.

CRITICAL RULES:
- If the recipe has multiple ingredient sections (like Tangzhong + Dough + Egg Wash, or Sauce + Filling + Topping), include EVERY ingredient from ALL sections in one flat ingredients array. Add the section name to the ingredient name, e.g. "whole milk (Tangzhong)" and "whole milk (Dough)" as SEPARATE entries.
- Never combine or deduplicate ingredients from different sections - keep them all separate with their section labels.
- qty must always be a number (e.g. 0.5 not "1/2").
- Calculate macros per single serving.
- Estimate realistic grocery prices: pK=Kroger, pW=Walmart (5-10% less), pA=Aldi (25-40% less), pS=Sam's, pC=Costco. IMPORTANT: prices are the cost of the AMOUNT USED in this recipe, not the cost of the whole package. E.g. if the recipe uses 500g of bread flour and a 5lb bag costs $4, set pK=0.88 (500g is about 22% of the bag). If the recipe uses 2 eggs from a $3 dozen, set pK=0.50. Never set a price above $15 for a single ingredient amount.

Return this exact JSON structure:
{"title":"","category":"Chicken|Beef|Pork|Seafood|Vegetarian|Pasta|Soup|Salad|Side Dish|Dessert|Breakfast|Bread|Other","mealType":"Breakfast|Lunch|Dinner|Side Dish|Snack|Dessert|Bread","prepTime":15,"cookTime":30,"servings":4,"rating":4,"favorite":false,"noRecipeNeeded":false,"makesLeftovers":false,"image":"","source":"paste","sourceUrl":"","videoUrl":"","notes":"","tags":[],"ingredients":[{"name":"","qty":1.0,"unit":"","pK":0,"pW":0,"pA":0,"pS":0,"pC":0,"onSale":false,"saleDesc":"","aisle":"Other"}],"instructions":"1. Step\n2. Step","macros":{"calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0,"sugar":0,"sodium":0},"cookLog":[]}

Return ONLY the JSON object. No markdown, no explanation, no backticks.`;

function ImportModal({ onClose, onParsed, customTags, onAddTag }) {
  const [mode, setMode] = useState("paste");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [imgUrl, setImgUrl] = useState("");
  const [scrapedImages, setScrapedImages] = useState([]);
  const [searchedImages, setSearchedImages] = useState([]);
  const [searchingImgs, setSearchingImgs] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [imgKb, setImgKb] = useState(null);
  const [pdfText, setPdfText] = useState("");
  const [pdfName, setPdfName] = useState("");
  const imgRef = useRef();
  const pdfRef = useRef();

  async function handleImg(e) {
    const file = e.target.files[0]; if (!file) return;
    try { const {dataUrl,kb} = await compress(file); setImgUrl(dataUrl); setImgKb(kb); } catch {}
  }

  async function handlePdf(e) {
    const file = e.target.files[0]; if (!file) return;
    setPdfName(file.name);
    // Read PDF as base64 and send to Claude directly
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target.result.split(",")[1];
      setLoading(true); setError("");
      try {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true"
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 3000,
            system: SYS,
            messages: [{
              role: "user",
              content: [
                { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
                { type: "text", text: "Extract this recipe from the PDF with 100% precision. Every ingredient with exact measurements, every step in order. Return only the JSON." }
              ]
            }]
          })
        });
        const data = await resp.json();
        const raw = data.content?.[0]?.text || "";
        let recipe = null;
        const attempts = [
          () => JSON.parse(raw),
          () => JSON.parse(raw.replace(/^```json\s*/m,"").replace(/```\s*$/m,"").trim()),
          () => { const m = raw.match(/\{[\s\S]*\}/); if(m) return JSON.parse(m[0]); throw new Error("no json"); },
        ];
        for (const a of attempts) { try { recipe = a(); break; } catch {} }
        if (!recipe) throw new Error("Could not parse recipe from PDF");
        recipe.cookLog = recipe.cookLog || [];
        // Search for photos
        if (recipe.title) await searchPhotos(recipe);
        onParsed(recipe, []);
      } catch(e) {
        setError("Could not read PDF: " + e.message);
      }
      setLoading(false);
    };
    reader.readAsDataURL(file);
  }

  async function searchPhotos(recipe) {
    setSearchingImgs(true);
    try {
      const title = recipe.title || "food";
      // Use Claude to get relevant food image search terms then build working image URLs
      const raw = await callAI(
        "You are a helpful assistant. Return ONLY a valid JSON array of 6 working food image URLs from foodiesfeed.com, pexels.com, or unsplash.com that match the recipe. Use these exact URL formats:\n- Pexels: https://images.pexels.com/photos/[ID]/pexels-photo-[ID].jpeg?auto=compress&cs=tinysrgb&w=400\n- Unsplash: https://images.unsplash.com/photo-[ID]?w=400&q=80\n\nReturn ONLY the JSON array, no other text.",
        `Find 6 food photo URLs that match this recipe: ${title} (category: ${recipe.category||"food"})`,
        600
      );
      try {
        const imgs = JSON.parse(raw.replace(/```json|```/g,"").trim());
        if (Array.isArray(imgs) && imgs.length > 0) {
          setSearchedImages(imgs);
          if (!imgUrl) setImgUrl(imgs[0]);
          setSearchingImgs(false);
          return;
        }
      } catch(e) {}

      // Fallback: category-specific Pexels photos
      const catPhotos = {
        "Chicken":  ["165175","2338407","60616","616354","262047"],
        "Beef":     ["3535383","769289","8697537","8697536","410648"],
        "Pork":     ["3535383","1639562","410648","769289","1640777"],
        "Seafood":  ["3655916","1516415","566345","566344","128756"],
        "Bread":    ["1775043","1775044","2135099","1586942","209540"],
        "Breakfast":["1640777","376464","1775043","3434523","4518741"],
        "Dessert":  ["3026804","3026805","1126359","239581","291528"],
        "Pasta":    ["1279330","1279332","1437267","1437268","699953"],
        "Soup":     ["5409009","5409010","2983101","539451","3737013"],
        "Salad":    ["1211887","1211885","1640777","1059905","1059906"],
      };
      const ids = catPhotos[recipe.category] || ["1640777","376464","1640772","1099680","3622608","2097090"];
      const imgs = ids.map(id => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=400`);
      setSearchedImages(imgs);
      if (!imgUrl) setImgUrl(imgs[0]);
    } catch(e) { console.log("Image search failed:", e); }
    setSearchingImgs(false);
  }

  async function doExtract() {
    setLoading(true); setError(""); setScrapedImages([]); setSearchedImages([]);
    try {
      let content = text;
      let scrapedImgs = [];

      if (mode === "url" || mode === "link") {
        if (!url.trim()) { setError("Enter a URL."); setLoading(false); return; }
        try {
          const sr = await callFn("scrapeRecipe", { url: url.trim() });
          console.log("Scraped result:", JSON.stringify({ imageCount: sr.images?.length, image: sr.image, source: sr.source, warning: sr.warning }));
          content = sr.text || "";
          if (sr.images && sr.images.length > 0) {
            scrapedImgs = sr.images;
            setScrapedImages(sr.images);
            if (!imgUrl && sr.images[0]) setImgUrl(sr.images[0]);
          }
          if (sr.warning) setError("⚠️ " + sr.warning);
        } catch { content = ""; }

        // Link-only mode: if no recipe content scraped, create a placeholder
        if (mode === "link" && content.length < 200) {
          const placeholder = {
            title: url.replace(/https?:\/\/(www\.)?/,"").split("/").filter(Boolean).pop()?.replace(/-/g," ") || "Recipe from link",
            category: "Other", mealType: "Dinner",
            prepTime: 0, cookTime: 0, servings: 4, rating: 3,
            favorite: false, noRecipeNeeded: false, makesLeftovers: false,
            image: scrapedImgs[0] || "", source: "url", sourceUrl: url.trim(),
            videoUrl: "", notes: "Imported from link — add ingredients and steps manually.",
            tags: [], ingredients: [], instructions: "", cookLog: [],
            macros: { calories:0, protein:0, carbs:0, fat:0, fiber:0, sugar:0, sodium:0 }
          };
          await searchPhotos(placeholder);
          onParsed(placeholder, scrapedImgs);
          setLoading(false);
          return;
        }
      }

      const extractPrompt = `You are extracting a recipe with 100% precision. Every measurement, every ingredient, every step must be captured exactly as written.

CRITICAL RULES:
- Extract EVERY ingredient with its EXACT quantity and unit (e.g. "35g bread flour", "175g milk")
- For multi-part recipes: include ALL ingredients from ALL parts, label each with its section in parentheses e.g. "bread flour (Tangzhong)" as SEPARATE entries
- NEVER skip or combine ingredients from different sections
- Instructions: capture EVERY step in order across ALL days/sections, numbered sequentially
- qty must be a number (0.5 not "1/2")
- notes field: include tips, substitutions, storage info

${mode==="url" ? `Source URL: ${url}\n\nPage content:` : "Recipe text:"}

${content.slice(0, 10000)}`;

      const raw = await callAI(SYS, extractPrompt, 2800);
      let recipe = null;
      const attempts = [
        () => JSON.parse(raw),
        () => JSON.parse(raw.replace(/^```json\s*/m,"").replace(/```\s*$/m,"").trim()),
        () => JSON.parse(raw.replace(/^```[\w]*\s*/m,"").replace(/```\s*$/m,"").trim()),
        () => { const m = raw.match(/\{[\s\S]*\}/); if(m) return JSON.parse(m[0]); throw new Error("no json"); },
      ];
      for (const a of attempts) { try { recipe = a(); break; } catch {} }
      if (!recipe) throw new Error("Could not parse JSON from response");
      if (imgUrl) recipe.image = imgUrl;
      else if (scrapedImgs.length > 0) recipe.image = scrapedImgs[0];
      if (mode==="url" || mode==="link") recipe.sourceUrl = url;
      recipe.cookLog = recipe.cookLog || [];
      if (mode === "paste" && recipe.title) await searchPhotos(recipe);
      onParsed(recipe, scrapedImgs);
    } catch(e) {
      console.error("Parse error:", e);
      setError("Couldn't parse — try a different format or paste the text directly.");
    }
    setLoading(false);
  }

  const steps = ["Reading recipe…","Extracting ingredients…","Calculating macros…","Estimating prices…","Formatting…"];
  const [step, setStep] = useState(0);
  useEffect(() => { if (!loading) { setStep(0); return; } const iv = setInterval(()=>setStep(s=>(s+1)%steps.length),900); return ()=>clearInterval(iv); }, [loading]);

  const imgPicker = (imgs) => (
    <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
      {imgs.map((img,i) => (
        <div key={i} onClick={()=>setImgUrl(img)} style={{ position:"relative", cursor:"pointer", borderRadius:8, overflow:"hidden", border:`3px solid ${imgUrl===img?C.accent:C.border}`, flexShrink:0 }}>
          <img src={img} alt="" style={{ width:72, height:72, objectFit:"cover", display:"block" }} onError={e=>e.target.parentNode.style.display="none"}/>
          {imgUrl===img && <div style={{ position:"absolute", top:3, right:3, background:C.accent, borderRadius:"50%", width:16, height:16, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, color:"#0C1810", fontWeight:900 }}>✓</div>}
        </div>
      ))}
      <div onClick={()=>setImgUrl("")} style={{ width:72, height:72, border:`3px solid ${!imgUrl?C.accent:C.border}`, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", flexShrink:0, background:C.surface }}>
        <span style={{ fontSize:10, color:!imgUrl?C.accent:C.textMuted, textAlign:"center", fontWeight:600 }}>No{"\n"}photo</span>
      </div>
    </div>
  );

  return (
    <Modal onClose={loading?undefined:onClose} width={570}>
      <div style={{ fontFamily:FD, fontSize:20, fontWeight:700, marginBottom:12 }}>Import Recipe</div>

      {/* Mode tabs */}
      <div style={{ display:"flex", gap:3, marginBottom:12, background:C.surface, padding:3, borderRadius:9, border:`1px solid ${C.border}` }}>
        {[["paste","📋 Paste"],["url","🔗 URL"],["link","🔗 Link Only"],["pdf","📄 PDF"]].map(([id,lbl]) => (
          <button key={id} onClick={()=>{setMode(id);setError("");}} style={{ flex:1, background:mode===id?C.accent:"transparent", color:mode===id?"#0C1810":C.textDim, border:"none", borderRadius:7, padding:"7px 0", cursor:"pointer", fontSize:12, fontWeight:700 }}>{lbl}</button>
        ))}
      </div>

      {/* Mode descriptions */}
      {mode==="paste" && <div style={{ fontSize:11, color:C.textMuted, marginBottom:8, padding:"6px 10px", background:C.surface, borderRadius:7 }}>Most accurate — print recipe to PDF, open PDF, copy all text, paste here. No ads or images to worry about.</div>}
      {mode==="url"   && <div style={{ fontSize:11, color:C.textMuted, marginBottom:8, padding:"6px 10px", background:C.surface, borderRadius:7 }}>Works best on AllRecipes, Food Network, NYT Cooking. JS-rendered sites (like Joshua Weissman) won't import recipe text — use Paste instead.</div>}
      {mode==="link"  && <div style={{ fontSize:11, color:C.textMuted, marginBottom:8, padding:"6px 10px", background:C.surface, borderRadius:7 }}>Just saves the link — creates a placeholder recipe you can fill in. Great for Instagram/Facebook/YouTube videos you want in your rotation.</div>}
      {mode==="pdf"   && <div style={{ fontSize:11, color:C.textMuted, marginBottom:8, padding:"6px 10px", background:C.surface, borderRadius:7 }}>Upload a PDF — most accurate method. Print any recipe page to PDF (Ctrl+P → Save as PDF) then upload here.</div>}

      {/* Inputs */}
      {mode==="paste" && (
        <div style={{ position:"relative", marginBottom:10 }}>
          <textarea value={text} onChange={e=>setText(e.target.value)} autoFocus rows={10} placeholder={"Paste recipe text here — any format works.\n\nTip: Print the recipe page to PDF, open the PDF, select all (Ctrl+A), copy (Ctrl+C), paste here."} style={{ width:"100%", background:C.surface, border:`2px solid ${text.length>10?C.green:C.border}`, borderRadius:10, padding:"11px 13px", color:C.text, fontSize:13, resize:"vertical", lineHeight:1.8, fontFamily:FB, transition:"border-color .2s" }}/>
          {text.length > 0 && <div style={{ position:"absolute", bottom:10, right:12, fontSize:10, color:C.textMuted }}>{text.length.toLocaleString()} chars</div>}
        </div>
      )}
      {(mode==="url" || mode==="link") && (
        <div style={{ marginBottom:10 }}>
          <input value={url} onChange={e=>{setUrl(e.target.value);setError("");}} autoFocus placeholder={mode==="link"?"https://www.instagram.com/p/... or any recipe URL":"https://www.allrecipes.com/recipe/..."} style={{ width:"100%", background:C.surface, border:`2px solid ${url.length>5?C.green:C.border}`, borderRadius:10, padding:"11px 13px", color:C.text, fontSize:13, transition:"border-color .2s" }}/>
        </div>
      )}
      {mode==="pdf" && (
        <div style={{ marginBottom:10 }}>
          <input ref={pdfRef} type="file" accept="application/pdf" style={{ display:"none" }} onChange={handlePdf}/>
          {pdfName
            ? <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 16px", background:C.greenSoft, border:`2px solid ${C.green}`, borderRadius:10 }}>
                <span style={{ fontSize:22 }}>📄</span>
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:C.text }}>{pdfName}</div>
                  <div style={{ fontSize:11, color:C.green }}>Processing…</div>
                </div>
              </div>
            : <div onClick={()=>pdfRef.current.click()} style={{ border:`2px dashed ${C.border}`, borderRadius:10, padding:"32px 0", textAlign:"center", cursor:"pointer", background:C.surface }}>
                <div style={{ fontSize:36, marginBottom:8 }}>📄</div>
                <div style={{ fontSize:14, fontWeight:700, color:C.textDim, marginBottom:4 }}>Click to upload PDF</div>
                <div style={{ fontSize:11, color:C.textMuted }}>Print any recipe page: Ctrl+P → "Save as PDF"</div>
              </div>
          }
        </div>
      )}

      {/* Photo row */}
      {mode !== "pdf" && (
        <div style={{ display:"flex", gap:7, alignItems:"center", marginBottom:10, padding:"8px 12px", background:C.surface, border:`1px solid ${C.border}`, borderRadius:8 }}>
          <span style={{ fontSize:11, color:C.textDim, flexShrink:0 }}>📷 Photo</span>
          <input value={imgUrl.startsWith("data:")?"":imgUrl} onChange={e=>setImgUrl(e.target.value)} placeholder="Image URL (optional)…" style={{ flex:1, background:C.card, border:`1px solid ${C.border}`, borderRadius:6, padding:"5px 8px", color:C.text, fontSize:11, minWidth:0 }}/>
          <Btn variant="ghost" onClick={()=>imgRef.current.click()} style={{ padding:"4px 9px", fontSize:11, flexShrink:0 }}>Upload</Btn>
          <input ref={imgRef} type="file" accept="image/*" style={{ display:"none" }} onChange={handleImg}/>
          {imgUrl && <><img src={imgUrl} style={{ width:28, height:28, objectFit:"cover", borderRadius:4, flexShrink:0 }} onError={e=>e.target.style.display="none"}/>{imgKb&&<span style={{ fontSize:9, color:C.green, flexShrink:0 }}>{imgKb}KB</span>}<button onClick={()=>{setImgUrl("");setImgKb(null);}} style={{ background:"none", border:"none", color:C.red, cursor:"pointer", fontSize:13, flexShrink:0 }}>✕</button></>}
        </div>
      )}

      {/* Image pickers */}
      {scrapedImages.length > 1 && (
        <div style={{ marginBottom:10 }}>
          <div style={{ fontSize:10, color:C.textMuted, fontWeight:700, textTransform:"uppercase", marginBottom:6 }}>📷 Choose Photo ({scrapedImages.length} found)</div>
          {imgPicker(scrapedImages)}
        </div>
      )}
      {searchingImgs && <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:10 }}><Spin size={14}/><span style={{ fontSize:12, color:C.textMuted }}>Finding food photos…</span></div>}
      {searchedImages.length > 0 && (
        <div style={{ marginBottom:10 }}>
          <div style={{ fontSize:10, color:C.textMuted, fontWeight:700, textTransform:"uppercase", marginBottom:6 }}>📷 Choose a Photo</div>
          {imgPicker(searchedImages)}
        </div>
      )}

      {error && <div style={{ background:C.redSoft, border:`1px solid ${C.red}44`, borderRadius:7, padding:"7px 11px", fontSize:12, color:C.red, marginBottom:8 }}>⚠️ {error}</div>}

      {loading
        ? <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 0" }}><Spin size={18}/><span style={{ fontSize:13, color:C.textDim }}>{steps[step]}</span></div>
        : mode !== "pdf" && <Btn variant="primary" onClick={doExtract} disabled={mode==="paste"?!text.trim():!url.trim()} style={{ width:"100%", justifyContent:"center", padding:"11px 0", fontSize:14 }}>
            {mode==="link" ? "💾 Save Link as Recipe" : "✨ Import Recipe"}
          </Btn>
      }
    </Modal>
  );
}

// --- REVIEW MODAL -------------------------------------------------------------
function ReviewModal({ recipe:init, onClose, onSave, isEdit=false, customTags=DTAGS, customCats=[], scrapedImages=[], onAddTag }) {
  const [r, setR] = useState({...init, cookLog:init.cookLog||[]});
  const [imgKb, setImgKb] = useState(null);
  const [newTag, setNewTag] = useState("");
  const [photoSearching, setPhotoSearching] = useState(false);
  const [foundPhotos, setFoundPhotos] = useState(scrapedImages||[]);
  const fileRef = useRef();
  const set = (k,v) => setR(p => ({...p,[k]:v}));

  async function findPhotos() {
    setPhotoSearching(true);
    try {
      const catPhotos = {
        "Chicken":  ["165175","2338407","60616","616354","262047","3535383"],
        "Beef":     ["3535383","769289","8697537","410648","1640777","376464"],
        "Pork":     ["3535383","1639562","410648","769289","1640777","376464"],
        "Seafood":  ["3655916","1516415","566345","566344","128756","376464"],
        "Bread":    ["1775043","1775044","2135099","1586942","209540","376464"],
        "Breakfast":["1640777","376464","1775043","3434523","4518741","2338407"],
        "Dessert":  ["3026804","3026805","1126359","291528","376464","1640777"],
        "Pasta":    ["1279330","1279332","1437267","699953","376464","1640777"],
        "Soup":     ["5409009","5409010","2983101","539451","376464","1640777"],
        "Salad":    ["1211887","1211885","1640777","1059905","376464","1099680"],
        "Side Dish":["1640777","376464","1099680","1640772","3622608","2097090"],
      };
      const ids = catPhotos[r.category] || ["1640777","376464","1640772","1099680","3622608","2097090","958545","1860198"];
      const imgs = ids.map(id => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=400`);
      setFoundPhotos(imgs);
      if (!r.image) set("image", imgs[0]);
    } catch(e) {}
    setPhotoSearching(false);
  }
  const setI = (i,k,v) => setR(p => ({...p,ingredients:p.ingredients.map((x,j) => j===i?{...x,[k]:["name","unit","aisle","saleDesc"].includes(k)?v:Number(v)||0}:x)}));
  const addI = () => setR(p => ({...p,ingredients:[...p.ingredients,{name:"",qty:1,unit:"",pK:0,pW:0,pA:0,pS:0,pC:0,onSale:false,saleDesc:"",aisle:"Other"}]}));
  const rmI = i => setR(p => ({...p,ingredients:p.ingredients.filter((_,j)=>j!==i)}));
  async function handleImg(e) { const file=e.target.files[0]; if(!file) return; try{const{dataUrl,kb}=await compress(file);set("image",dataUrl);setImgKb(kb);}catch{} }
  function addTag() { const t=newTag.trim(); if(!t||customTags.includes(t)) return; onAddTag?.(t); set("tags",[...(r.tags||[]),t]); setNewTag(""); }
  const FI = ({label,field,type="text",half=false,opts}) => (
    <div style={{ flex:half?"0 0 calc(50% - 5px)":"0 0 100%", marginBottom:9 }}>
      <div style={{ fontSize:9, color:C.textMuted, fontWeight:700, textTransform:"uppercase", letterSpacing:.7, marginBottom:3 }}>{label}</div>
      {opts ? <select value={r[field]} onChange={e=>set(field,e.target.value)} style={{ width:"100%", background:C.surface, border:`1px solid ${C.border}`, borderRadius:7, padding:"6px 9px", color:C.text, fontSize:13 }}>{opts.map(o=><option key={o}>{o}</option>)}</select>
             : <input type={type} value={r[field]??""} onChange={e=>set(field,type==="number"?Number(e.target.value):e.target.value)} style={{ width:"100%", background:C.surface, border:`1px solid ${C.border}`, borderRadius:7, padding:"6px 9px", color:C.text, fontSize:13 }}/>}
    </div>
  );
  return (
    <Modal onClose={onClose} width={680}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <div style={{ fontFamily:FD, fontSize:19, fontWeight:700 }}>{isEdit?"Edit Recipe":"✅ Review Before Saving"}</div>
        {!isEdit && <div style={{ background:C.orangeSoft, border:`1px solid ${C.orange}44`, borderRadius:7, padding:"5px 10px", fontSize:11, color:C.orange }}>⚠️ Check ingredients &amp; quantities</div>}
      </div>
      {/* Tags above scroll */}
      <div style={{ marginBottom:10, padding:"9px 12px", background:C.surface, border:`1px solid ${C.border}`, borderRadius:9 }}>
        <div style={{ fontSize:9, color:C.textMuted, fontWeight:700, textTransform:"uppercase", marginBottom:6 }}>🏷 Tags</div>
        <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:6 }}>
          {customTags.map(t => { const a=(r.tags||[]).includes(t); return <button key={t} onClick={()=>set("tags",a?(r.tags||[]).filter(x=>x!==t):[...(r.tags||[]),t])} style={{ background:a?C.greenSoft:C.card, color:a?C.green:C.textMuted, border:`1px solid ${a?C.green:C.border}`, borderRadius:20, padding:"3px 9px", cursor:"pointer", fontSize:11, fontWeight:a?700:400 }}>{a?"✓ ":""}{t}</button>; })}
        </div>
        <div style={{ display:"flex", gap:5 }}>
          <input value={newTag} onChange={e=>setNewTag(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addTag()} placeholder="+ New tag… press Enter" style={{ flex:1, background:C.card, border:`1px solid ${C.border}`, borderRadius:20, padding:"3px 11px", color:C.text, fontSize:11, maxWidth:220 }}/>
          <button onClick={addTag} disabled={!newTag.trim()||customTags.includes(newTag.trim())} style={{ background:newTag.trim()&&!customTags.includes(newTag.trim())?C.green:C.border, color:"#0C1810", border:"none", borderRadius:20, padding:"3px 10px", cursor:"pointer", fontSize:11, fontWeight:700 }}>Add</button>
        </div>
      </div>
      <div style={{ maxHeight:"56vh", overflowY:"auto", paddingRight:2 }}>
        <div style={{ display:"flex", flexWrap:"wrap", gap:9 }}>
          <FI label="Recipe Title" field="title"/>
          <FI label="Category" field="category" half opts={[...CATS.slice(1), ...customCats]}/>
          <FI label="Meal Type" field="mealType" half opts={["Breakfast","Lunch","Dinner","Side Dish","Snack","Dessert","Bread"]}/>
          <FI label="Prep (min)" field="prepTime" half type="number"/>
          <FI label="Cook (min)" field="cookTime" half type="number"/>
          <FI label="Servings" field="servings" half type="number"/>
          <div style={{ flex:"0 0 calc(50% - 5px)", marginBottom:9 }}>
            <div style={{ fontSize:9, color:C.textMuted, fontWeight:700, textTransform:"uppercase", letterSpacing:.7, marginBottom:3 }}>Rating</div>
            <Stars n={r.rating} onChange={v=>set("rating",v)}/>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, marginBottom:10, flexWrap:"wrap" }}>
          {[["noRecipeNeeded","⚡ Quick Meal"],["makesLeftovers","↩ Makes Leftovers"]].map(([field,label]) => (
            <button key={field} onClick={()=>set(field,!r[field])} style={{ display:"flex", alignItems:"center", gap:6, background:r[field]?C.greenSoft:C.surface, border:`1px solid ${r[field]?C.green:C.border}`, borderRadius:8, padding:"5px 11px", cursor:"pointer", fontSize:12, color:r[field]?C.green:C.textDim, fontWeight:r[field]?700:400 }}>
              <span style={{ width:28, height:16, borderRadius:8, background:r[field]?C.green:C.border, position:"relative", display:"inline-block" }}><span style={{ position:"absolute", top:2, left:r[field]?14:2, width:12, height:12, borderRadius:"50%", background:"#fff", transition:"left .2s" }}/></span>{label}
            </button>
          ))}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:9, marginBottom:10 }}>
          <div>
            <div style={{ fontSize:9, color:C.textMuted, fontWeight:700, textTransform:"uppercase", marginBottom:4 }}>📷 Photo</div>
            <div style={{ display:"flex", gap:5 }}>
              <input value={r.image?.startsWith("data:")?"":r.image||""} onChange={e=>{
                set("image",e.target.value);
                // If URL is pasted and no sourceUrl yet, offer to save as source
                if (e.target.value.startsWith("http") && !r.sourceUrl) set("sourceUrl", e.target.value);
              }} placeholder="Paste image URL or upload…" style={{ flex:1, background:C.surface, border:`1px solid ${C.border}`, borderRadius:7, padding:"5px 8px", color:C.text, fontSize:11, minWidth:0 }}/>
              <Btn variant="ghost" onClick={()=>fileRef.current.click()} style={{ padding:"5px 8px", fontSize:11, flexShrink:0 }}>📁</Btn>
              <Btn variant="ghost" onClick={findPhotos} disabled={photoSearching} style={{ padding:"5px 8px", fontSize:11, flexShrink:0, whiteSpace:"nowrap" }}>{photoSearching?<Spin size={11}/>:"🔍 Find"}</Btn>
              <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }} onChange={handleImg}/>
            </div>
            {r.image && <div style={{ display:"flex", gap:6, marginTop:5 }}><img src={r.image} alt="" style={{ width:48, height:36, objectFit:"cover", borderRadius:5 }} onError={e=>e.target.style.display="none"}/>{imgKb&&<span style={{ fontSize:10, color:C.green }}>✓ {imgKb}KB</span>}</div>}
            {/* Thumbnail picker */}
            {foundPhotos.length > 0 && (
              <div style={{ marginTop:8 }}>
                <div style={{ fontSize:9, color:C.textMuted, fontWeight:700, textTransform:"uppercase", marginBottom:5 }}>Choose photo ({foundPhotos.length})</div>
                <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                  {foundPhotos.map((img,i) => (
                    <div key={i} onClick={()=>set("image",img)} style={{ position:"relative", cursor:"pointer", borderRadius:6, overflow:"hidden", border:`2px solid ${r.image===img?C.accent:C.border}`, flexShrink:0 }}>
                      <img src={img} alt="" style={{ width:64, height:64, objectFit:"cover", display:"block" }} onError={e=>e.target.parentNode.style.display="none"}/>
                      {r.image===img && <div style={{ position:"absolute", top:2, right:2, background:C.accent, borderRadius:"50%", width:14, height:14, display:"flex", alignItems:"center", justifyContent:"center", fontSize:8, color:"#0C1810", fontWeight:900 }}>✓</div>}
                    </div>
                  ))}
                  <div onClick={()=>set("image","")} style={{ width:64, height:64, border:`2px solid ${!r.image?C.accent:C.border}`, borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", flexShrink:0, background:C.surface }}>
                    <span style={{ fontSize:9, color:!r.image?C.accent:C.textMuted, textAlign:"center" }}>No photo</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div>
            <div style={{ fontSize:9, color:C.textMuted, fontWeight:700, textTransform:"uppercase", marginBottom:4 }}>📹 Video URL</div>
            <input value={r.videoUrl||""} onChange={e=>set("videoUrl",e.target.value)} placeholder="https://youtube.com/…" style={{ width:"100%", background:C.surface, border:`1px solid ${C.border}`, borderRadius:7, padding:"5px 8px", color:C.text, fontSize:11 }}/>
          </div>
          <div>
            <div style={{ fontSize:9, color:C.textMuted, fontWeight:700, textTransform:"uppercase", marginBottom:4 }}>🔗 Source URL (recipe website, Instagram, etc.)</div>
            <input value={r.sourceUrl||""} onChange={e=>set("sourceUrl",e.target.value)} placeholder="https://allrecipes.com/recipe/…" style={{ width:"100%", background:C.surface, border:`1px solid ${C.border}`, borderRadius:7, padding:"5px 8px", color:C.text, fontSize:11 }}/>
            {r.sourceUrl && <a href={r.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize:10, color:C.accent, marginTop:3, display:"block" }}>{r.sourceUrl.replace(/https?:\/\/(www\.)?/,"").slice(0,50)} ↗</a>}
          </div>
        </div>
        <div style={{ marginBottom:10 }}>
          <div style={{ fontSize:9, color:C.textMuted, fontWeight:700, textTransform:"uppercase", marginBottom:5 }}>Ingredients</div>
          <div style={{ display:"grid", gridTemplateColumns:"2fr 50px 60px 58px 58px 58px 72px 60px 110px auto", gap:3, marginBottom:3 }}>
            {["Name","Qty","Unit","Kroger","Walmart","Aldi","Aisle","On Sale","Sale Deal",""].map((h,i) => <div key={i} style={{ fontSize:8, color:C.textMuted, fontWeight:700, textTransform:"uppercase" }}>{h}</div>)}
          </div>
          {(r.ingredients||[]).map((ing,i) => (
            <div key={i} style={{ display:"grid", gridTemplateColumns:"2fr 50px 60px 58px 58px 58px 72px 60px 110px auto", gap:3, marginBottom:3, alignItems:"center" }}>
              <input value={ing.name} onChange={e=>setI(i,"name",e.target.value)} placeholder="name" style={{ background:C.surface, border:`1px solid ${ing.name?C.border:C.red+"88"}`, borderRadius:5, padding:"5px 7px", color:C.text, fontSize:11 }}/>
              <input type="number" value={ing.qty} onChange={e=>setI(i,"qty",e.target.value)} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:5, padding:"5px 5px", color:C.text, fontSize:11 }}/>
              <input value={ing.unit} onChange={e=>setI(i,"unit",e.target.value)} placeholder="unit" style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:5, padding:"5px 6px", color:C.text, fontSize:11 }}/>
              <input type="number" value={ing.pK||""} onChange={e=>setI(i,"pK",e.target.value)} placeholder="$K" style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:5, padding:"5px 5px", color:C.text, fontSize:11 }}/>
              <input type="number" value={ing.pW||""} onChange={e=>setI(i,"pW",e.target.value)} placeholder="$W" style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:5, padding:"5px 5px", color:C.text, fontSize:11 }}/>
              <input type="number" value={ing.pA||""} onChange={e=>setI(i,"pA",e.target.value)} placeholder="$A" style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:5, padding:"5px 5px", color:C.text, fontSize:11 }}/>
              <select value={ing.aisle||"Other"} onChange={e=>setI(i,"aisle",e.target.value)} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:5, padding:"4px 4px", color:C.textDim, fontSize:9 }}>
                {AISLES.map(a => <option key={a}>{a}</option>)}
              </select>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"center" }}>
                <button onClick={()=>setI(i,"onSale",!ing.onSale)} style={{ width:20, height:20, borderRadius:4, background:ing.onSale?"#FF8C00":"transparent", border:`2px solid ${ing.onSale?"#FF8C00":C.border}`, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, color:"#fff" }}>
                  {ing.onSale?"✓":""}
                </button>
              </div>
              <input value={ing.saleDesc||""} onChange={e=>setI(i,"saleDesc",e.target.value)} placeholder="e.g. BOGO, $1.99/lb" disabled={!ing.onSale} style={{ background:ing.onSale?C.card:C.surface, border:`1px solid ${ing.onSale?"#FF8C00":C.border}`, borderRadius:5, padding:"5px 6px", color:ing.onSale?"#FF8C00":C.textMuted, fontSize:10, opacity:ing.onSale?1:0.5 }}/>
              <button onClick={()=>rmI(i)} style={{ background:"none", border:"none", color:C.red, cursor:"pointer", fontSize:13, padding:"0 2px" }}>✕</button>
            </div>
          ))}
          <button onClick={addI} style={{ background:"transparent", border:`1px dashed ${C.border}`, color:C.textMuted, borderRadius:5, padding:"4px 10px", cursor:"pointer", fontSize:11, marginTop:2 }}>+ Add ingredient</button>
        </div>
        {!r.noRecipeNeeded && (
          <div style={{ marginBottom:10 }}>
            <div style={{ fontSize:9, color:C.textMuted, fontWeight:700, textTransform:"uppercase", marginBottom:4 }}>Instructions</div>
            <textarea value={r.instructions||""} onChange={e=>set("instructions",e.target.value)} rows={6} style={{ width:"100%", background:C.surface, border:`1px solid ${C.border}`, borderRadius:7, padding:"8px 10px", color:C.text, fontSize:12, resize:"vertical", lineHeight:1.7, fontFamily:FB }}/>
          </div>
        )}
        <div style={{ marginBottom:10 }}>
          <div style={{ fontSize:9, color:C.textMuted, fontWeight:700, textTransform:"uppercase", marginBottom:5 }}>Macros per serving <span style={{ fontWeight:400, textTransform:"none", fontSize:9 }}>(auto-calculated on import)</span></div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:7, marginBottom:6 }}>
            {[["calories","🔥 Cal","kcal"],["protein","💪 Protein","g"],["carbs","🌾 Carbs","g"],["fat","🫙 Fat","g"]].map(([k,lbl,u]) => (
              <div key={k}><div style={{ fontSize:9, color:C.textMuted, marginBottom:2 }}>{lbl} ({u})</div><input type="number" value={r.macros?.[k]||0} onChange={e=>set("macros",{...(r.macros||{}),[k]:Number(e.target.value)})} style={{ width:"100%", background:C.surface, border:`1px solid ${C.border}`, borderRadius:6, padding:"5px 7px", color:C.text, fontSize:12 }}/></div>
            ))}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:7 }}>
            {[["fiber","🥦 Fiber","g"],["sugar","🍬 Sugar","g"],["sodium","🧂 Sodium","mg"]].map(([k,lbl,u]) => (
              <div key={k}><div style={{ fontSize:9, color:C.textMuted, marginBottom:2 }}>{lbl} ({u})</div><input type="number" value={r.macros?.[k]||0} onChange={e=>set("macros",{...(r.macros||{}),[k]:Number(e.target.value)})} style={{ width:"100%", background:C.surface, border:`1px solid ${C.border}`, borderRadius:6, padding:"5px 7px", color:C.text, fontSize:12 }}/></div>
            ))}
          </div>
        </div>
        <div style={{ marginBottom:4 }}>
          <div style={{ fontSize:9, color:C.textMuted, fontWeight:700, textTransform:"uppercase", marginBottom:3 }}>Notes / Tips</div>
          <textarea value={r.notes||""} onChange={e=>set("notes",e.target.value)} rows={2} style={{ width:"100%", background:C.surface, border:`1px solid ${C.border}`, borderRadius:7, padding:"7px 10px", color:C.text, fontSize:12, resize:"vertical", fontFamily:FB }}/>
        </div>
      </div>
      <div style={{ display:"flex", gap:8, marginTop:12 }}>
        <Btn variant="ghost" onClick={onClose} style={{ flex:1, justifyContent:"center" }}>Discard</Btn>
        <Btn variant="primary" onClick={()=>onSave(r)} disabled={!r.title?.trim()} style={{ flex:2, justifyContent:"center" }}>{isEdit?"💾 Save Changes":"✅ Save Recipe"}</Btn>
      </div>
    </Modal>
  );
}

// --- TAG MANAGER MODAL --------------------------------------------------------
function TagManagerModal({ tags, onSave, onClose }) {
  const [list, setList] = useState([...tags]);
  const [newTag, setNewTag] = useState("");
  const [editing, setEditing] = useState(null);
  const [editVal, setEditVal] = useState("");
  return (
    <Modal onClose={onClose} width={420}>
      <div style={{ fontFamily:FD, fontSize:18, fontWeight:700, marginBottom:4 }}>🏷 Manage Tags</div>
      <div style={{ fontSize:12, color:C.textDim, marginBottom:14 }}>Changes sync to all family members.</div>
      <div style={{ maxHeight:280, overflowY:"auto", marginBottom:12, display:"flex", flexDirection:"column", gap:5 }}>
        {list.map((t,i) => (
          <div key={i} style={{ display:"flex", alignItems:"center", gap:7, background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"6px 11px" }}>
            {editing===i
              ? <><input value={editVal} onChange={e=>setEditVal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&(setList(p=>p.map((x,j)=>j===i?editVal.trim():x)),setEditing(null))} autoFocus style={{ flex:1, background:C.card, border:`1px solid ${C.accent}`, borderRadius:5, padding:"3px 7px", color:C.text, fontSize:12 }}/><Btn variant="primary" onClick={()=>{setList(p=>p.map((x,j)=>j===i?editVal.trim():x));setEditing(null);}} style={{ padding:"2px 9px", fontSize:11 }}>✓</Btn><Btn variant="ghost" onClick={()=>setEditing(null)} style={{ padding:"2px 7px", fontSize:11 }}>✕</Btn></>
              : <><span style={{ flex:1, fontSize:12 }}>{t}</span><button onClick={()=>{setEditing(i);setEditVal(t);}} style={{ background:"none", border:"none", color:C.textDim, cursor:"pointer", fontSize:12, padding:"1px 5px" }}>✏️</button><button onClick={()=>setList(p=>p.filter((_,j)=>j!==i))} style={{ background:"none", border:"none", color:C.red, cursor:"pointer", fontSize:12, padding:"1px 5px" }}>✕</button></>}
          </div>
        ))}
      </div>
      <div style={{ display:"flex", gap:7, marginBottom:14 }}>
        <input value={newTag} onChange={e=>setNewTag(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&newTag.trim()&&!list.includes(newTag.trim())){setList(p=>[...p,newTag.trim()]);setNewTag("");}}} placeholder="New tag name…" style={{ flex:1, background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"7px 11px", color:C.text, fontSize:13 }}/>
        <Btn variant="secondary" onClick={()=>{const t=newTag.trim();if(t&&!list.includes(t)){setList(p=>[...p,t]);setNewTag("");}}} disabled={!newTag.trim()||list.includes(newTag.trim())}>+ Add</Btn>
      </div>
      <div style={{ display:"flex", gap:8 }}>
        <Btn variant="ghost" onClick={onClose} style={{ flex:1, justifyContent:"center" }}>Cancel</Btn>
        <Btn variant="primary" onClick={()=>{onSave(list);onClose();}} style={{ flex:2, justifyContent:"center" }}>💾 Save Tags</Btn>
      </div>
    </Modal>
  );
}

// --- MEAT SALES TAB -----------------------------------------------------------
const MEAT_CATS = [
  "Beef", "Pork", "Chicken", "Turkey", "Lamb", "Seafood",
  "Bacon & Sausage", "Deli Meat", "Ground Meat", "Other Meat"
];
const MEAT_SEARCH_TERMS = [
  "chicken breast", "chicken thighs", "whole chicken", "chicken wings",
  "ground beef", "beef steak", "beef roast", "beef brisket", "ribeye",
  "pork ribs", "pork chops", "pork loin", "pulled pork", "ham",
  "ground turkey", "turkey breast", "whole turkey",
  "bacon", "sausage", "hot dogs", "bratwurst",
  "salmon", "shrimp", "tilapia", "cod", "tuna steak",
  "lamb chops", "lamb leg",
];

function MeatSalesTab({ locationId, recipes, onSetMeal, onFindStore, shopping, setShopping }) {
  const [sales, setSales] = useState(null);
  const [loading, setLoading] = useState(false);
  const [zip, setZip] = useState(() => localStorage.getItem("fl_zip") || "");
  const [findingStore, setFindingStore] = useState(false);
  const [catFilter, setCatFilter] = useState("All");
  const [lastChecked, setLastChecked] = useState(null);

  async function checkSales() {
    const locId = locationId || localStorage.getItem("fl_kroger_loc");
    if (!locId) { alert("Set your store ZIP first."); return; }
    setLoading(true);
    try {
      const data = await callFn("krogerCheckSales", {
        ingredients: MEAT_SEARCH_TERMS,
        locationId: locId,
      });
      setSales(data.results || []);
      setLastChecked(new Date().toLocaleTimeString());
    } catch(e) {
      console.error(e);
      alert("Could not fetch sales. Check your Kroger connection.");
    }
    setLoading(false);
  }

  async function handleFindStore() {
    if (!zip) return;
    setFindingStore(true);
    const store = await onFindStore(zip);
    if (store) { alert("Store linked: " + store.name); checkSales(); }
    else alert("No Kroger found near that ZIP.");
    setFindingStore(false);
  }

  const onSale = (sales||[]).filter(s => s.onSale);
  const notOnSale = (sales||[]).filter(s => !s.onSale);

  function catOf(item) {
    const n = (item.productName||item.ingredient).toLowerCase();
    if (n.includes("chicken")) return "Chicken";
    if (n.includes("turkey")) return "Turkey";
    if (n.includes("beef")||n.includes("steak")||n.includes("ribeye")||n.includes("brisket")) return "Beef";
    if (n.includes("pork")||n.includes("rib")||n.includes("ham")||n.includes("loin")) return "Pork";
    if (n.includes("lamb")) return "Lamb";
    if (n.includes("bacon")||n.includes("sausage")||n.includes("bratwurst")||n.includes("hot dog")) return "Bacon & Sausage";
    if (n.includes("salmon")||n.includes("shrimp")||n.includes("tuna")||n.includes("cod")||n.includes("tilapia")||n.includes("seafood")) return "Seafood";
    if (n.includes("ground")) return "Ground Meat";
    return "Other Meat";
  }

  const filteredSales = catFilter === "All" ? onSale : onSale.filter(s => catOf(s) === catFilter);
  const locId = locationId || localStorage.getItem("fl_kroger_loc");

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16, flexWrap:"wrap" }}>
        <span style={{ fontFamily:FD, fontSize:22, fontWeight:700 }}>🏷 Meat &amp; Seafood Sales</span>
        <span style={{ fontSize:12, color:C.textMuted }}>Live from your Kroger store</span>
        {lastChecked && <span style={{ fontSize:11, color:C.textMuted, marginLeft:"auto" }}>Last checked: {lastChecked}</span>}
      </div>

      {!locId ? (
        <div style={{ background:C.accentSoft, border:`1px solid ${C.accent}44`, borderRadius:12, padding:"20px 18px", marginBottom:16 }}>
          <div style={{ fontSize:14, fontWeight:700, color:C.accent, marginBottom:10 }}>Set Your Kroger Store First</div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <input value={zip} onChange={e=>setZip(e.target.value)} placeholder="Enter ZIP code" style={{ width:110, background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:"8px 12px", color:C.text, fontSize:13 }}/>
            <Btn variant="primary" onClick={handleFindStore} disabled={findingStore||!zip}>{findingStore ? <><Spin size={13}/> Finding…</> : "Find My Store"}</Btn>
          </div>
        </div>
      ) : (
        <div style={{ display:"flex", gap:8, marginBottom:16, alignItems:"center" }}>
          <Btn variant="primary" onClick={checkSales} disabled={loading} style={{ padding:"8px 18px" }}>
            {loading ? <><Spin size={14}/> Checking Kroger…</> : "🔄 Check This Week's Sales"}
          </Btn>
          {sales && <span style={{ fontSize:12, color:onSale.length>0?C.green:C.textMuted, fontWeight:700 }}>{onSale.length} items on sale</span>}
        </div>
      )}

      {sales === null && locId && (
        <div style={{ textAlign:"center", padding:"60px 0", color:C.textMuted }}>
          <div style={{ fontSize:44, marginBottom:12 }}>🥩</div>
          <div style={{ fontSize:15, fontWeight:600, color:C.textDim, marginBottom:6 }}>Check what meat is on sale this week</div>
          <div style={{ fontSize:12 }}>Searches {MEAT_SEARCH_TERMS.length} meat & seafood items at your Kroger</div>
        </div>
      )}

      {sales && (
        <div>
          {/* Category filter */}
          <div style={{ display:"flex", gap:5, marginBottom:14, flexWrap:"wrap" }}>
            {["All", ...MEAT_CATS].map(c => (
              <button key={c} onClick={()=>setCatFilter(c)} style={{ background:catFilter===c?C.accent:C.card, color:catFilter===c?"#0C1810":C.textDim, border:`1px solid ${catFilter===c?C.accent:C.border}`, borderRadius:20, padding:"3px 11px", fontSize:11, fontWeight:600, cursor:"pointer" }}>{c}</button>
            ))}
          </div>

          {onSale.length === 0 && (
            <div style={{ textAlign:"center", padding:"40px 0", color:C.textMuted }}>
              <div style={{ fontSize:32, marginBottom:8 }}>😔</div>
              <div style={{ fontSize:14, fontWeight:600, color:C.textDim }}>No meat sales found this week</div>
              <div style={{ fontSize:12, marginTop:5 }}>Check back later or try a different store</div>
            </div>
          )}

          {filteredSales.length > 0 && (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:12, marginBottom:24 }}>
              {filteredSales.sort((a,b) => b.savings - a.savings).map((item,i) => {
                const recipesWithItem = recipes.filter(r =>
                  (r.ingredients||[]).some(ing => ing.name.toLowerCase().includes(item.ingredient.toLowerCase()))
                );
                return (
                  <div key={i} style={{ background:C.card, border:`2px solid ${C.green}44`, borderRadius:12, padding:"14px 14px", position:"relative" }}>
                    <div style={{ position:"absolute", top:10, right:10, background:C.green, color:"#0C1810", borderRadius:20, padding:"2px 8px", fontSize:10, fontWeight:800 }}>
                      SAVE {item.pctOff}%
                    </div>
                    <div style={{ fontSize:11, color:C.textMuted, fontWeight:700, textTransform:"uppercase", marginBottom:4 }}>{catOf(item)}</div>
                    <div style={{ fontSize:14, fontWeight:700, color:C.text, marginBottom:6, paddingRight:60 }}>{item.productName}</div>
                    <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:6 }}>
                      <span style={{ fontFamily:FD, fontSize:26, fontWeight:700, color:C.green }}>${item.salePrice.toFixed(2)}</span>
                      <span style={{ fontSize:12, color:C.textMuted, textDecoration:"line-through" }}>${item.regularPrice.toFixed(2)}</span>
                      <span style={{ fontSize:11, color:C.green, fontWeight:700 }}>save ${item.savings}</span>
                    </div>
                    {recipesWithItem.length > 0 && (
                      <div style={{ marginBottom:8 }}>
                        <div style={{ fontSize:10, color:C.textMuted, fontWeight:700, textTransform:"uppercase", marginBottom:4 }}>In your recipes:</div>
                        <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                          {recipesWithItem.map((r,j) => (
                            <span key={j} style={{ background:C.greenSoft, color:C.green, borderRadius:20, padding:"2px 8px", fontSize:10, fontWeight:600 }}>{r.title}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {recipesWithItem.length > 0 && (
                      <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                        {recipesWithItem.slice(0,3).map((r,j) => (
                          <button key={j} onClick={()=>onSetMeal(`${DAYS[j]}_Dinner`, r)} style={{ background:C.accentSoft, border:`1px solid ${C.accent}44`, borderRadius:6, padding:"4px 9px", cursor:"pointer", fontSize:10, color:C.accent, fontWeight:700 }}>
                            + {r.title.slice(0,16)}{r.title.length>16?"...":""}
                          </button>
                        ))}
                      </div>
                    )}
                    <button onClick={()=>{
                      const existing = (shopping||[]).find(s=>s.name.toLowerCase()===item.ingredient.toLowerCase());
                      if (existing) { alert(`${item.ingredient} is already on your shopping list.`); return; }
                      const newItem = { name:item.ingredient, qty:1, unit:"", assignedStore:"kroger", checked:false, onSale:true, saleDesc:item.saleDesc, pK:item.salePrice||0, pW:0, pA:0, pS:0, pC:0, aisle:"Meat & Seafood" };
                      setShopping([...(shopping||[]), newItem]);
                      alert(`✅ ${item.ingredient} added to shopping list!`);
                    }} style={{ marginTop:8, width:"100%", background:C.greenSoft, border:`1px solid ${C.green}`, borderRadius:8, padding:"7px 0", cursor:"pointer", fontSize:12, color:C.green, fontWeight:700 }}>
                      🛒 Add to Shopping List
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {notOnSale.length > 0 && (
            <details style={{ marginTop:8 }}>
              <summary style={{ fontSize:12, color:C.textMuted, cursor:"pointer", padding:"8px 0", fontWeight:600 }}>
                {notOnSale.length} items checked — not on sale this week
              </summary>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:8 }}>
                {notOnSale.map((item,i) => (
                  <span key={i} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"4px 10px", fontSize:11, color:C.textMuted }}>
                    {item.productName || item.ingredient} — ${item.regularPrice?.toFixed(2)||"?"}/ea
                  </span>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
