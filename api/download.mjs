// Public GitHub repositories only. No Blob storage or Blob token is used.
const OWNER = 'daniil179828';
const TYPES = { ipa: {repo:'ipaqwleyshade',ext:'.ipa'}, apk: {repo:'apkqwleyshade',ext:'.apk'} };
const memo = new Map();
class DownloadError extends Error { constructor(status,message){super(message);this.status=status;} }
async function github(path){
 const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'QwleyShade-downloads'};
 if(process.env.GITHUB_TOKEN)headers.Authorization='Bearer '+process.env.GITHUB_TOKEN;
 const r=await fetch('https://api.github.com'+path,{headers,signal:AbortSignal.timeout(10000),cache:'no-store'});
 if(!r.ok){
  if(r.status===429||(r.status===403&&r.headers.get('x-ratelimit-remaining')==='0'))throw new DownloadError(429,'GitHub API limit reached. Please try again later.');
  if(r.status===404)throw new DownloadError(404,'The public download repository was not found.');
  throw new DownloadError(502,'GitHub is temporarily unavailable.');
 }
 return r.json();
}
async function resolveFile(type){
 const cached=memo.get(type);
 if(cached&&cached.expires>Date.now())return cached.file;
 const config=TYPES[type];
 const base='/repos/'+OWNER+'/'+config.repo;
 const repo=await github(base);
 if(typeof repo.default_branch!=='string')throw new DownloadError(502,'Invalid repository response.');
 const branch=repo.default_branch;
 const tree=await github(base+'/git/trees/'+encodeURIComponent(branch)+'?recursive=1');
 if(tree.truncated||!Array.isArray(tree.tree))throw new DownloadError(502,'Could not read the complete repository tree.');
 const files=tree.tree.filter(x=>x.type==='blob'&&typeof x.path==='string'&&x.path.toLowerCase().endsWith(config.ext));
 if(!files.length)throw new DownloadError(404,'No '+config.ext+' file found in the repository.');
 // Do not guess a release from arbitrary names. Keep one active binary in each repository.
 if(files.length>1)throw new DownloadError(409,'More than one '+config.ext+' file found. Keep one active download in the repository.');
 const entry=files[0];let size=entry.size;
 // Git trees report pointer size for Git LFS. Read only tiny blobs to recover real binary size.
 if(Number.isFinite(size)&&size<=2048){
  const blob=await github(base+'/git/blobs/'+encodeURIComponent(entry.sha));
  if(blob.encoding==='base64'&&typeof blob.content==='string'){
   const content=Buffer.from(blob.content,'base64').toString('utf8');
   if(content.startsWith('version https://git-lfs.github.com/spec/v1')){
    const match=content.match(/^size (\d+)\s*$/m);
    if(!match)throw new DownloadError(502,'Invalid Git LFS pointer.');
    size=Number(match[1]);
   }
  }
 }
 if(!Number.isFinite(size)||size<1)throw new DownloadError(502,'Invalid download file size.');
 // GitHub raw download route handles both ordinary files and Git LFS objects.
 const encodedPath=entry.path.split('/').map(encodeURIComponent).join('/');
 const url='https://github.com/'+OWNER+'/'+config.repo+'/raw/refs/heads/'+encodeURIComponent(branch)+'/'+encodedPath+'?download=1';
 const file={filename:entry.path.split('/').pop(),size,url};
 memo.set(type,{file,expires:Date.now()+60000});return file;
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('Vercel-CDN-Cache-Control','no-store');
 if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');return res.status(405).end('Method not allowed');}
 const query=new URL(req.url,'https://localhost').searchParams;const type=query.get('type');
 if(!Object.hasOwn(TYPES,type))return res.status(400).end('Use type=ipa or type=apk');
 try{
  const file=await resolveFile(type);
  if(query.get('meta')==='1')return res.status(200).json({filename:file.filename,size:file.size});
  res.setHeader('Location',file.url);return res.status(302).end();
 }catch(e){
  const status=e instanceof DownloadError?e.status:502;
  if(status===429)res.setHeader('Retry-After','60');
  return res.status(status).end(e instanceof DownloadError?e.message:'Download temporarily unavailable. Please try again.');
 }
}
