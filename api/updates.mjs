const SOURCE = 'https://raw.githubusercontent.com/daniil179828/Changelog/refs/heads/main/changelog.json';
export default async function handler(req, res) {
  if (!['GET','HEAD'].includes(req.method)) {
    res.setHeader('Allow','GET, HEAD');
    return res.status(405).end('Method not allowed');
  }
  try {
    const response = await fetch(SOURCE, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!response.ok) throw new Error('Upstream unavailable');
    const data = await response.json();
    if (!Array.isArray(data) || !data.length) throw new Error('Invalid changelog');
    const entries = data.filter(x => x && typeof x.version === 'string').slice(0,20).map(x => ({
      version:x.version, roblox: typeof x.roblox === 'string' ? x.roblox : '',
      date: typeof x.date === 'string' ? x.date : '', isNew: Boolean(x.isNew),
      items: Array.isArray(x.items) ? x.items.filter(v=>typeof v==='string') : []
    }));
    if (!entries.length) throw new Error('No releases');
    res.setHeader('Cache-Control','public, max-age=0, s-maxage=60');
    return res.status(200).json({entries, source:SOURCE, fetchedAt:new Date().toISOString()});
  } catch {
    res.setHeader('Cache-Control','no-store');
    return res.status(502).json({error:'Changelog temporarily unavailable'});
  }
}
