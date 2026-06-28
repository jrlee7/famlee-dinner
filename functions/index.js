"use strict";

const { onRequest } = require("firebase-functions/v2/https");
const https = require("https");
const http = require("http");
const zlib = require("zlib");

const KROGER_CLIENT_ID = process.env.KROGER_CLIENT_ID;
const KROGER_CLIENT_SECRET = process.env.KROGER_CLIENT_SECRET;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

function fetchUrl(urlStr, opts) {
  if (!opts) opts = {};
  return new Promise(function(resolve, reject) {
    var parsed = new URL(urlStr);
    var lib = parsed.protocol === "https:" ? https : http;
    var headers = Object.assign({ "Accept-Encoding": "gzip, deflate" }, opts.headers || {});
    var options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + (parsed.search || ""),
      method: opts.method || "GET",
      headers: headers
    };
    var req = lib.request(options, function(res) {
      var chunks = [];
      var encoding = (res.headers["content-encoding"] || "").toLowerCase();
      var stream = res;

      if (encoding === "gzip") {
        stream = res.pipe(zlib.createGunzip());
      } else if (encoding === "deflate") {
        stream = res.pipe(zlib.createInflate());
      }

      stream.on("data", function(chunk) { chunks.push(chunk); });
      stream.on("end", function() {
        var body = Buffer.concat(chunks).toString("utf8");
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: function() { return Promise.resolve(body); },
          json: function() {
            try { return Promise.resolve(JSON.parse(body)); }
            catch(e) { return Promise.reject(new Error("JSON parse error: " + body.slice(0,100))); }
          }
        });
      });
      stream.on("error", reject);
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function setCors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

exports.krogerToken = onRequest(
  { cors: true, region: "us-central1" },
  function(req, res) {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    var creds = Buffer.from(KROGER_CLIENT_ID + ":" + KROGER_CLIENT_SECRET).toString("base64");
    console.log("krogerToken - clientId:", KROGER_CLIENT_ID, "secretLen:", KROGER_CLIENT_SECRET.length);
    fetchUrl("https://api.kroger.com/v1/connect/oauth2/token", {
      method: "POST",
      headers: { "Authorization": "Basic " + creds, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&scope=product.compact"
    }).then(function(r) { return r.json(); })
      .then(function(d) {
        console.log("krogerToken response:", JSON.stringify(d).slice(0,200));
        res.json(d);
      })
      .catch(function(e) { res.status(500).json({ error: e.message }); });
  }
);

exports.krogerSearch = onRequest(
  { cors: true, region: "us-central1" },
  function(req, res) {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    var query = req.body.query;
    var locationId = req.body.locationId;
    console.log("krogerSearch - query:", query, "locationId:", locationId);
    var creds = Buffer.from(KROGER_CLIENT_ID + ":" + KROGER_CLIENT_SECRET).toString("base64");
    fetchUrl("https://api.kroger.com/v1/connect/oauth2/token", {
      method: "POST",
      headers: { "Authorization": "Basic " + creds, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&scope=product.compact"
    })
    .then(function(r) { return r.json(); })
    .then(function(tokenData) {
      var token = tokenData.access_token;
      if (!token) throw new Error("No token: " + JSON.stringify(tokenData));
      var url = "https://api.kroger.com/v1/products?filter.term=" + encodeURIComponent(query) +
        "&filter.locationId=" + locationId + "&filter.limit=5";
      return fetchUrl(url, { headers: { "Authorization": "Bearer " + token, "Accept": "application/json" } });
    })
    .then(function(r) {
      return r.text().then(function(text) {
        console.log("krogerSearch response:", text.slice(0,300));
        try { res.json(JSON.parse(text)); }
        catch(e) { res.status(500).json({ error: "Bad JSON: " + text.slice(0,100) }); }
      });
    })
    .catch(function(e) {
      console.error("krogerSearch error:", String(e));
      res.status(500).json({ error: String(e) });
    });
  }
);

// Check sale prices for a list of ingredient names
exports.krogerCheckSales = onRequest(
  { cors: true, region: "us-central1", timeoutSeconds: 60 },
  function(req, res) {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    var ingredients = req.body.ingredients || [];
    var locationId = req.body.locationId;

    // First get a client token
    var creds = Buffer.from(KROGER_CLIENT_ID + ":" + KROGER_CLIENT_SECRET).toString("base64");
    fetchUrl("https://api.kroger.com/v1/connect/oauth2/token", {
      method: "POST",
      headers: { "Authorization": "Basic " + creds, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&scope=product.compact"
    })
    .then(function(r) { return r.json(); })
    .then(function(tokenData) {
      var token = tokenData.access_token;
      if (!token) throw new Error("No token");

      // Search for each ingredient sequentially
      var results = [];
      var chain = Promise.resolve();

      ingredients.forEach(function(ingredient) {
        chain = chain.then(function() {
          var url = "https://api.kroger.com/v1/products?filter.term=" + encodeURIComponent(ingredient) +
            "&filter.locationId=" + locationId + "&filter.limit=3";
          return fetchUrl(url, { headers: { "Authorization": "Bearer " + token, "Accept": "application/json" } })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              var products = (data.data || []);
              var saleProducts = products.filter(function(p) {
                var price = (p.items || [])[0]?.price;
                return price && price.promo && price.promo > 0 && price.promo < price.regular;
              });

              if (saleProducts.length > 0) {
                var p = saleProducts[0];
                var price = (p.items || [])[0].price;
                var savings = (price.regular - price.promo).toFixed(2);
                var pct = Math.round((savings / price.regular) * 100);
                results.push({
                  ingredient: ingredient,
                  productName: p.description,
                  regularPrice: price.regular,
                  salePrice: price.promo,
                  savings: savings,
                  pctOff: pct,
                  saleDesc: "$" + price.promo.toFixed(2) + " (reg $" + price.regular.toFixed(2) + ", save " + pct + "%)",
                  upc: (p.items || [])[0]?.itemId || p.productId,
                  onSale: true,
                });
              } else if (products.length > 0) {
                var p2 = products[0];
                var price2 = (p2.items || [])[0]?.price;
                results.push({
                  ingredient: ingredient,
                  productName: p2.description,
                  regularPrice: price2?.regular || 0,
                  salePrice: null,
                  savings: 0,
                  pctOff: 0,
                  saleDesc: "",
                  upc: (p2.items || [])[0]?.itemId || p2.productId,
                  onSale: false,
                });
              }
            })
            .catch(function() {});
        });
      });

      return chain.then(function() { return results; });
    })
    .then(function(results) { res.json({ results: results }); })
    .catch(function(e) { res.status(500).json({ error: e.message }); });
  }
);

exports.krogerOAuthExchange = onRequest(
  { cors: true, region: "us-central1" },
  function(req, res) {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    var code = req.body.code;
    var redirectUri = req.body.redirectUri;
    var secret = KROGER_CLIENT_SECRET;
    var creds = Buffer.from(KROGER_CLIENT_ID + ":" + secret).toString("base64");
    var body = "grant_type=authorization_code&code=" + code + "&redirect_uri=" + encodeURIComponent(redirectUri);
    console.log("Kroger exchange - clientId:", KROGER_CLIENT_ID, "secretLen:", secret.length, "codeLen:", (code||"").length);
    fetchUrl("https://api.kroger.com/v1/connect/oauth2/token", {
      method: "POST",
      headers: { "Authorization": "Basic " + creds, "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
      body: body
    }).then(function(r) { return r.json(); })
      .then(function(d) {
        console.log("Kroger exchange response:", JSON.stringify(d).slice(0,200));
        res.json(d);
      })
      .catch(function(e) { res.status(500).json({ error: e.message }); });
  }
);

exports.krogerRefresh = onRequest(
  { cors: true, region: "us-central1" },
  function(req, res) {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    var refreshToken = req.body.refreshToken;
    var creds = Buffer.from(KROGER_CLIENT_ID + ":" + KROGER_CLIENT_SECRET).toString("base64");
    fetchUrl("https://api.kroger.com/v1/connect/oauth2/token", {
      method: "POST",
      headers: { "Authorization": "Basic " + creds, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=refresh_token&refresh_token=" + refreshToken
    }).then(function(r) { return r.json(); })
      .then(function(d) { res.json(d); })
      .catch(function(e) { res.status(500).json({ error: e.message }); });
  }
);

exports.krogerAddToCart = onRequest(
  { cors: true, region: "us-central1" },
  function(req, res) {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    var items = req.body.items;
    var userToken = req.body.userToken;
    console.log("krogerAddToCart - items:", JSON.stringify(items), "tokenLen:", (userToken||"").length);
    fetchUrl("https://api.kroger.com/v1/cart/add", {
      method: "PUT",
      headers: { "Authorization": "Bearer " + userToken, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ items: items })
    }).then(function(r) {
      return r.text().then(function(text) {
        console.log("krogerAddToCart response status:", r.status, "body:", text.slice(0,300));
        try { res.json(JSON.parse(text)); }
        catch(e) { res.json({ raw: text.slice(0,200), status: r.status }); }
      });
    })
    .catch(function(e) {
      console.error("krogerAddToCart error:", String(e));
      res.status(500).json({ error: e.message });
    });
  }
);

exports.krogerLocations = onRequest(
  { cors: true, region: "us-central1" },
  function(req, res) {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    var zipCode = req.body.zipCode;
    // Get a client credentials token with no scope — locations API is public
    var creds = Buffer.from(KROGER_CLIENT_ID + ":" + KROGER_CLIENT_SECRET).toString("base64");
    fetchUrl("https://api.kroger.com/v1/connect/oauth2/token", {
      method: "POST",
      headers: { "Authorization": "Basic " + creds, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&scope=product.compact"
    })
    .then(function(r) { return r.json(); })
    .then(function(tokenData) {
      var token = tokenData.access_token;
      if (!token) throw new Error("No token: " + JSON.stringify(tokenData));
      var url = "https://api.kroger.com/v1/locations?filter.zipCode.near=" + zipCode +
        "&filter.limit=10&filter.radiusInMiles=20";
      return fetchUrl(url, { headers: { "Authorization": "Bearer " + token, "Accept": "application/json" } });
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      console.log("krogerLocations result:", JSON.stringify(d).slice(0,200));
      res.json(d);
    })
    .catch(function(e) { res.status(500).json({ error: e.message }); });
  }
);

exports.scrapeRecipe = onRequest(
  { cors: true, timeoutSeconds: 60, region: "us-central1" },
  function(req, res) {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
    var url = req.body.url;
    if (!url) { res.status(400).json({ error: "url required" }); return; }

    var headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate",
      "Cache-Control": "no-cache",
      "Referer": "https://www.google.com/"
    };

    function extractFromHtml(html, sourceUrl) {
      var images = [];
      var ogMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
      if (ogMatch) images.push(ogMatch[1]);
      var twMatch = html.match(/<meta[^>]*name="twitter:image[^"]*"[^>]*content="([^"]+)"/i);
      if (twMatch && !images.includes(twMatch[1])) images.push(twMatch[1]);

      var structured = null;
      var scriptTags = html.match(/<script[^>]*ld\+json[^>]*>[\s\S]*?<\/script>/gi) || [];
      for (var i = 0; i < scriptTags.length; i++) {
        try {
          var inner = scriptTags[i].replace(/<[^>]+>/g, "");
          var d = JSON.parse(inner);
          var recipe = Array.isArray(d)
            ? d.find(function(x) { return x["@type"] === "Recipe"; })
            : d["@type"] === "Recipe" ? d
            : ((d["@graph"] || []).find(function(x) { return x["@type"] === "Recipe"; }));
          if (recipe) {
            structured = recipe;
            var img = recipe.image;
            if (img) {
              if (typeof img === "string" && !images.includes(img)) images.push(img);
              else if (Array.isArray(img)) img.forEach(function(u) {
                var src = typeof u === "string" ? u : u.url;
                if (src && !images.includes(src)) images.push(src);
              });
              else if (img.url && !images.includes(img.url)) images.push(img.url);
            }
            break;
          }
        } catch(e2) {}
      }

      // Also grab large images from page
      var imgTags = html.match(/<img[^>]+src="(https?:[^"]+\.(jpg|jpeg|png|webp)[^"]*)"/gi) || [];
      imgTags.forEach(function(tag) {
        var m = tag.match(/src="(https?:[^"]+\.(jpg|jpeg|png|webp)[^"]*)"/i);
        if (m && !images.includes(m[1]) && !m[1].includes("avatar") && !m[1].includes("logo") && !m[1].includes("icon")) {
          images.push(m[1]);
        }
      });
      images = images.filter(function(u,i,a) { return a.indexOf(u)===i; }).slice(0,8);

      if (structured) {
        var lines = [
          "Title: " + (structured.name || ""),
          "Servings: " + (structured.recipeYield || ""),
          "PrepTime: " + (structured.prepTime || ""),
          "CookTime: " + (structured.cookTime || ""),
          "", "Ingredients:"
        ];
        (structured.recipeIngredient || []).forEach(function(ing) { lines.push("- " + ing); });
        lines.push(""); lines.push("Instructions:");
        var inst = structured.recipeInstructions || [];
        if (Array.isArray(inst)) {
          inst.forEach(function(s, idx) {
            lines.push((idx+1) + ". " + (typeof s === "string" ? s : s.text || ""));
          });
        } else { lines.push(String(inst)); }
        return { text: lines.join("\n"), images: images, image: images[0]||"", source: "structured", hasRecipe: true };
      }

      var clean = html.replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim().slice(0, 8000);

      return { text: clean, images: images, image: images[0]||"", source: "text", hasRecipe: clean.length > 500 };
    }

    // Try main URL first
    fetchUrl(url, { headers: headers })
      .then(function(pageRes) {
        if (!pageRes.ok) {
          res.json({ text: "URL: " + url, images: [], warning: "Could not fetch page (status " + pageRes.status + ")" });
          return;
        }
        return pageRes.text().then(function(html) {
          var result = extractFromHtml(html, url);

          // If no structured data found and page seems JS-rendered, note it
          if (!result.hasRecipe || result.source === "text") {
            result.warning = "This site loads recipes with JavaScript. The AI will try to extract from available text, but for best results paste the recipe text directly.";
          }

          res.json(result);
        });
      })
      .catch(function(e) {
        res.json({ text: "URL: " + url, images: [], warning: e.message });
      });
  }
);

exports.claudeProxy = onRequest(
  { cors: true, timeoutSeconds: 120, region: "us-central1" },
  function(req, res) {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
    var apiKey = "";
    try { apiKey = ANTHROPIC_API_KEY; } catch(e) {
      res.status(500).json({ error: "Secret not available: " + e.message }); return;
    }
    if (!apiKey) { res.status(500).json({ error: "ANTHROPIC_KEY is empty" }); return; }
    var body = JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: req.body.tokens || 1400,
      system: req.body.system,
      messages: [{ role: "user", content: req.body.user }]
    });
    fetchUrl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: body
    }).then(function(r) {
      return r.text().then(function(text) {
        try {
          res.json(JSON.parse(text));
        } catch(e) {
          res.status(500).json({ error: "Bad JSON from Anthropic", raw: text.slice(0, 200) });
        }
      });
    }).catch(function(e) { res.status(500).json({ error: e.message }); });
  }
);
