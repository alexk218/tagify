import { mkdir, readFile, writeFile, cp, stat, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Build an isolated, static Vercel upload. Never deploy source, credentials or build caches.
const project = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const [artifacts, output, compatibility, previous, website] = process.argv.slice(2).map(p => p && resolve(p));
if (!artifacts || !output || !compatibility) throw Error('Usage: node prepare-local-site.mjs artifacts output compatibility.json previous-static-root-or-empty [verified-website-root]');
try { await access(output); throw Error('Output exists; choose a fresh directory.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const version = JSON.parse(await readFile(join(project, 'package.json'))).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Stable client version required');
const plist = await readFile(join(project,'scripts/install/macos/Info.plist'),'utf8');
const manager = /<key>CFBundleShortVersionString<\/key><string>(\d+\.\d+\.\d+)<\/string>/.exec(plist)?.[1];
if(!manager) throw Error('Stable manager version required');
const root = join(output, '.vercel/output/static');
await mkdir(root, { recursive: true });
const site = website || join(project,'landing-page');
for (const name of ['index.html', 'assets', 'styles', 'scripts', 'blog', 'faq.html', 'how-it-works.html', 'favicon.ico', 'site.webmanifest']) {
  try { await cp(join(site, name), join(root, name), { recursive: true }); } catch(e) { if(e.code !== 'ENOENT' || ['index.html','assets','styles','scripts'].includes(name)) throw e; }
}
const indexPath = join(root,'index.html');
await writeFile(indexPath,(await readFile(indexPath,'utf8')).replaceAll('https://raw.githubusercontent.com/alexk218/tagify/main/install.sh','https://tagify.fm/releases/install/install.sh').replaceAll('https://github.com/alexk218/tagify/releases',`https://tagify.fm/releases/client/v${version}/`));
if (previous) await cp(join(previous, 'releases'), join(root, 'releases'), { recursive: true });
const notes = await readFile(join(project, 'docs', `RELEASE_${version}.md`), 'utf8');
const published = new Date().toISOString();
async function release(kind, tag, names, body) {
  const directory = join(root, 'releases', kind, tag);
  try { await access(directory); throw Error(`Immutable release already exists: ${tag}`); } catch(e) { if(e.code !== 'ENOENT') throw e; }
  await mkdir(directory, { recursive: true });
  const assets = [];
  for (const name of names) {
    const source = join(artifacts, name), data = await readFile(source);
    if (!(await stat(source)).isFile() || !data.length) throw Error(`Missing artifact: ${name}`);
    await cp(source, join(directory, name));
    assets.push({ name, state:'uploaded', size:data.length, digest:'sha256:'+createHash('sha256').update(data).digest('hex'), browser_download_url:`https://tagify.fm/releases/${kind}/${tag}/${name}` });
  }
  const metadata = { tag_name:tag, name:tag, draft:false, prerelease:false, published_at:published, html_url:`https://tagify.fm/releases/${kind}/${tag}/`, body, assets };
  await writeFile(join(directory, 'release.json'), JSON.stringify(metadata,null,2)+'\n');
  await writeFile(join(directory,'SHA256SUMS'),assets.map(a=>`${a.digest.slice(7)}  ${a.name}\n`).join(''));
  return metadata;
}
const client = await release('client', `v${version}`, [`tagify-v${version}.zip`], notes);
const managerRelease = await release('manager', `v${manager}`, ['TagifyInstaller-mac.dmg','TagifyInstaller-mac.zip','Tagify.pkg','TagifyInstaller.exe'], 'Install and update Tagify directly from tagify.fm. Future Tagify Manager updates also come from tagify.fm.');
await writeFile(join(root,'releases/client/latest.json'),JSON.stringify(client,null,2)+'\n');
let older = [];
if(previous) {try{older=JSON.parse(await readFile(join(previous,'releases/manager/releases.json')));}catch(e){if(e.code!=='ENOENT')throw e;}}
await writeFile(join(root,'releases/manager/releases.json'),JSON.stringify([managerRelease,...older],null,2)+'\n');
await cp(join(artifacts,'appcast.xml'),join(root,'releases/manager/appcast.xml'));
await mkdir(join(root,'releases/install'),{recursive:true});
await cp(join(project,'scripts/install/Install-Tagify-Full.ps1'),join(root,'releases/install/Install-Tagify-Full.ps1'));
await cp(join(project,'install.sh'),join(root,'releases/install/install.sh'));
await writeFile(join(root,'releases/manager/index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><title>Tagify Manager</title><h1>Tagify Manager</h1><p><a href="/download/mac">Download for Mac</a></p><p><a href="/download/windows">Download for Windows</a></p></html>');
await cp(compatibility,join(root,'releases/install/spotify-compatibility.json'));
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const markup=escape(notes).replace(/^### (.*)$/gm,'<h1>$1</h1>').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\[([^\]]+)\]\((https:\/\/[^)]+)\)/g,'<a href="$2">$1</a>').split('\n\n').map(s=>s.startsWith('<h1>')?s:`<p>${s.replaceAll('\n','<br>')}</p>`).join('\n');
await writeFile(join(root,`releases/client/v${version}/index.html`),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tagify ${version}</title><style>body{max-width:720px;margin:64px auto;padding:0 24px;background:#121212;color:#eee;font:18px/1.6 system-ui}a{color:#65df97}h1{line-height:1.2}</style>${markup}</html>`);
await writeFile(join(root,`releases/client/v${version}/release-notes.md`),notes);
await mkdir(join(output,'.vercel'),{recursive:true});
await writeFile(join(output,'.vercel/project.json'),JSON.stringify({projectId:'prj_an6hlIOtbHEoHqll0Nn7vkABKGpG',orgId:'team_4DygfnNFb6qjpweqfOmmxASG',projectName:'tagify'}));
const redirects = [ ['mac','TagifyInstaller-mac.dmg'],['windows','TagifyInstaller.exe'] ].map(([platform,name])=>({src:`/download/${platform}`,status:302,headers:{Location:`/releases/manager/v${manager}/${name}`,'Cache-Control':'public, max-age=0, s-maxage=300'}}));
await writeFile(join(output,'.vercel/output/config.json'),JSON.stringify({version:3,routes:[...redirects,{src:'/releases/(.*)',headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'public, max-age=0, s-maxage=300'},continue:true},{handle:'filesystem'}]},null,2));
await writeFile(join(output,'release-manifest.json'),JSON.stringify({client,manager:managerRelease,notesSha256:createHash('sha256').update(notes).digest('hex')},null,2));
console.log(`Prepared ${root}`);
