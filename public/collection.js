const validId = /^(tt\d+|nm\d+|char-[a-z0-9-]+|Q\d+)$/;
const kinds = ['film','series','person','character'];
export function isCollected(record) {
  if (!record) return false;
  if (typeof record.collected === 'boolean') return record.collected;
  return !!(record.status || record.favorite || record.rating || record.note);
}
export function cleanItem(value) {
  const item = {};
  for (const key of ['id','title','zh','kind','year','subtitle','image','source','fetchedAt','wikidata','douban','work','actor','workId','actorId']) {
    if (value?.[key] != null) item[key] = typeof value[key] === 'string' ? value[key].slice(0,2000) : value[key];
  }
  if (!kinds.includes(item.kind)) item.kind = 'film';
  if (item.wikidata && !/^Q\d+$/.test(item.wikidata)) delete item.wikidata;
  if (item.douban && !/^\d+$/.test(String(item.douban))) delete item.douban;
  if (item.image && !/^https:\/\/(m\.media-amazon\.com|images\.metahub\.space|commons\.wikimedia\.org|upload\.wikimedia\.org|thumb\.wikimedia\.org|static\.tvmaze\.com|i\.ytimg\.com|i\.pinimg\.com|img\d*\.doubanio\.com)\//.test(item.image)) item.image = '';
  return item;
}
export function validImageUrl(value) {
  return typeof value==='string' && /^https:\/\/(m\.media-amazon\.com|images\.metahub\.space|commons\.wikimedia\.org|upload\.wikimedia\.org|thumb\.wikimedia\.org|static\.tvmaze\.com|i\.ytimg\.com|i\.pinimg\.com|img\d*\.doubanio\.com)\//.test(value) ? value.slice(0,2400) : '';
}
export function photoKey(value){
 try{const url=new URL(value),host=url.hostname,path=decodeURIComponent(url.pathname);
  if(/^(upload|thumb)\.wikimedia\.org$/.test(host)){const file=path.match(/\/[a-f0-9]\/[a-f0-9]{2}\/([^/]+)/i);if(file)return 'commons:'+file[1].replaceAll('_',' ');}
  if(host==='commons.wikimedia.org'&&path.includes('Special:FilePath/'))return 'commons:'+path.split('Special:FilePath/')[1].replaceAll('_',' ');
  if(host==='static.tvmaze.com')return host+path.replace(/\/(original_untouched|medium_portrait|medium_landscape)\//,'/');
  if(host==='i.pinimg.com')return host+path.replace(/^\/[^/]+\//,'/');
  if(host==='m.media-amazon.com')return host+path.replace(/\._V1_.*(?=\.(?:jpg|png))/i,'._V1_');
  return value;
 }catch{return value;}
}
export function cleanAlbum(input) {
  if(!Array.isArray(input))return [];
  const used=new Set();return input.filter(image=>image&&validImageUrl(image.url)&&!used.has(photoKey(image.url))&&used.add(photoKey(image.url))).slice(0,240).map(image=>({url:validImageUrl(image.url),thumbnail:validImageUrl(image.thumbnail)||'',title:String(image.title||'相片').slice(0,200),kind:String(image.kind||'照片').slice(0,30),source:String(image.source||'').slice(0,100),author:String(image.author||'').slice(0,300),license:String(image.license||'').slice(0,150),pageUrl:typeof image.pageUrl==='string'&&/^https:\/\/(www\.imdb\.com|commons\.wikimedia\.org|en\.wikipedia\.org|www\.wikidata\.org|www\.tvmaze\.com|www\.youtube\.com|zh\.wikipedia\.org|www\.pinterest\.com|movie\.douban\.com)\//.test(image.pageUrl)?image.pageUrl.slice(0,2400):''}));
}
export function cleanMemories(input) {
  if(!Array.isArray(input))return [];
  const used=new Set();return input.filter(memory=>memory&&typeof memory.id==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(memory.id)&&!used.has(memory.id)&&used.add(memory.id)&&/^\d{4}-\d{2}-\d{2}$/.test(memory.date||'')).slice(0,150).map(memory=>({id:memory.id,date:memory.date,mood:String(memory.mood||'').slice(0,24),note:String(memory.note||'').slice(0,3000)}));
}
export function nextAnniversary(date, now=new Date()) {
  if(!/^\d{4}-\d{2}-\d{2}/.test(date||''))return null;
  const month=Number(date.slice(5,7))-1,day=Number(date.slice(8,10));
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  for(let offset=0;offset<9;offset++){const target=new Date(today.getFullYear()+offset,month,day);if(target.getMonth()!==month||target.getDate()!==day||target<today)continue;return {date:target,days:Math.round((Date.UTC(target.getFullYear(),target.getMonth(),target.getDate())-Date.UTC(today.getFullYear(),today.getMonth(),today.getDate()))/86400000)};}return null;
}
export function cleanTags(input) {
  const tags = Array.isArray(input) ? input : String(input || '').split(/[,，;；\n]/);
  return [...new Set(tags.map(x=>String(x).trim().slice(0,24)).filter(Boolean))].slice(0,12);
}
export function normaliseRecords(input) {
  if (!input || Array.isArray(input) || typeof input !== 'object') throw Error('无效档案');
  const result = {};
  for (const [id, value] of Object.entries(input)) {
    if (!validId.test(id) || !value || value.item?.id !== id) continue;
    const item = cleanItem(value.item);
    if (typeof item.title !== 'string' || !item.title.trim()) continue;
    const updatedAt = !isNaN(Date.parse(value.updatedAt)) ? new Date(value.updatedAt).toISOString() : '1970-01-01T00:00:00.000Z';
    const record = {item, status:['watched','watchlist','following',''].includes(value.status)?value.status:'', favorite:!!value.favorite,
      rating:Math.max(0,Math.min(10,Number(value.rating)||0)), date:/^\d{4}-\d{2}-\d{2}$/.test(value.date||'')?value.date:'',
      note:String(value.note||'').slice(0,10000), tags:cleanTags(value.tags), updatedAt,
      serial:Number.isSafeInteger(value.serial)&&value.serial>0?value.serial:null,
      nickname:String(value.nickname||'').slice(0,80), quote:String(value.quote||'').slice(0,600), album:cleanAlbum(value.album), coverImage:validImageUrl(value.coverImage), memories:cleanMemories(value.memories),
      addedAt:value.addedAt&&!isNaN(Date.parse(value.addedAt))?new Date(value.addedAt).toISOString():null};
    if (typeof value.collected === 'boolean') record.collected = value.collected;
    result[id] = record;
  }
  // Allocate once for older archives. Sorting/filtering never changes these numbers.
  let next = Math.max(0,...Object.values(result).map(x=>x.serial||0));
  const used = new Set();
  for (const record of Object.values(result).sort((a,b)=>a.updatedAt.localeCompare(b.updatedAt)||a.item.id.localeCompare(b.item.id))) {
    if (record.serial && !used.has(record.serial)) used.add(record.serial);
    else if (isCollected(record) || record.serial) {record.serial=++next; used.add(record.serial);}
  }
  return result;
}
export function nextSerial(records) { return Math.max(0,...Object.values(records).map(x=>x.serial||0))+1; }
export function serialLabel(record) { return record?.serial ? String(record.serial).padStart(4,'0') : '待入藏'; }
export function mergeRecords(current,incoming) {
  const result = {...current};
  for (const [id, record] of Object.entries(incoming)) if (!result[id] || record.updatedAt > result[id].updatedAt) {
    result[id] = {...record, serial:result[id]?.serial||record.serial, addedAt:result[id]?.addedAt||record.addedAt};
  }
  // Reserve current identifiers before resolving collisions from another device.
  const used = new Set(Object.entries(result).filter(([id])=>current[id]?.serial).map(([id])=>current[id].serial));
  let next = Math.max(0,...Object.values(result).map(x=>x.serial||0));
  for (const [id,record] of Object.entries(result)) {
    if (current[id]?.serial) {record.serial=current[id].serial;continue;}
    if (record.serial && !used.has(record.serial)) used.add(record.serial);
    else if (isCollected(record) || record.serial) {record.serial=++next;used.add(record.serial);}
  }
  return normaliseRecords(result);
}
export function ownedItems(catalog,records) {
  const index = new Map(catalog.map(x=>[x.id,x]));
  return Object.values(records).filter(isCollected).map(record=>({...index.get(record.item.id),...record.item}));
}
export function relatedOwned(item,items) {
  return items.filter(other=>other.id!==item.id && (
    item.workId===other.id || item.actorId===other.id || other.workId===item.id || other.actorId===item.id ||
    (item.kind==='character'&&other.kind==='character'&&item.workId&&item.workId===other.workId)
  ));
}
