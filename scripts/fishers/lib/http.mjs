const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const UA = 'Lamplighter-Fishers-Extractor/1.0 (+https://github.com/lakshaymahajan/sentinel; civic public-data research)';
export async function request(url, options = {}) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(200 + Math.floor(Math.random() * 301));
    try {
      const response = await fetch(url, { ...options, headers: { 'User-Agent': UA, ...(options.headers || {}) } });
      if (response.status !== 429 && response.status < 500) return response;
      last = new Error(`${response.status} ${response.statusText}: ${url}`);
    } catch (error) { last = error; }
    await sleep(500 * 2 ** attempt + Math.floor(Math.random() * 250));
  }
  throw last;
}
export async function json(url) { const r = await request(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); }
