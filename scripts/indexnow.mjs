// Tells Bing (and so Yahoo, DuckDuckGo and others) that the public site's pages changed,
// so they look again soon instead of showing an old title (IndexNow: https://www.indexnow.org).
// The key file is public/2b522202e096cbb78091c2adea3e63ab.txt. Run after a deploy that changes the site:
//   node scripts/indexnow.mjs
const KEY = "2b522202e096cbb78091c2adea3e63ab";
const HOST = "www.dinerai.co.uk";
const urls = ["/", "/privacy", "/terms", "/dpa"].map((p) => `https://${HOST}${p}`);
const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: urls }),
});
console.log(`IndexNow: ${res.status} ${res.statusText}`, urls.join(", "));
