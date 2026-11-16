import {validImageUrl, cleanAlbum, photoKey} from './collection.js';

export const PHOTO_BATCH = 12;
export function thumbnailUrl(image, width = 360, shape = 'landscape') {
  const value = typeof image === 'string' ? image : image?.cachedUrl || image?.thumbnail || image?.url || '';
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.hostname === 'm.media-amazon.com') return value.replace(/\._V1_.*(?=\.(?:jpg|png))/i, '._V1_QL80_UX' + width + '_');
    if (url.hostname === 'static.tvmaze.com') return value.replace('/original_untouched/', shape === 'portrait' ? '/medium_portrait/' : '/medium_landscape/');
    if (url.hostname === 'commons.wikimedia.org' && url.pathname.includes('Special:FilePath/')) { url.searchParams.set('width', String(width)); return url.href; }
    if (/^(upload|thumb)\.wikimedia\.org$/.test(url.hostname)) return value.replace(/\/\d+px-([^/]+)$/, '/' + width + 'px-$1');
    if (/^img\d*\.doubanio\.com$/.test(url.hostname)) return value.replace(/\/view\/photo\/(l|raw|xl)\/public\//, '/view/photo/m/public/');
    if (url.hostname === 'i.pinimg.com') return value.replace(/\/(originals|736x|564x)\//, '/236x/');
  } catch { return ''; }
  return value;
}

export function mergePhotos(current, incoming) { const map=new Map(current.map(image=>[photoKey(image.url),image]));for(const image of incoming){const key=photoKey(image.url),old=map.get(key);map.set(key,old?{...old,thumbnail:image.thumbnail||old.thumbnail,cachedUrl:image.cachedUrl||old.cachedUrl}:image);}return cleanAlbum([...map.values()]); }
export function imageSourceLinks(item) {
  const query = [item.title, item.kind === 'character' ? item.work : '', item.kind === 'person' ? 'portrait' : 'stills'].filter(Boolean).join(' ');
  return [
    {name:'IMDb', url:/^(tt|nm)\d+$/.test(item.id) ? 'https://www.imdb.com/' + (item.id.startsWith('nm')?'name':'title') + '/' + item.id + '/mediaindex/' : 'https://www.imdb.com/find/?q=' + encodeURIComponent(item.title)},
    {name:'豆瓣', url:item.douban ? 'https://movie.douban.com/' + (item.kind === 'person'?'celebrity':'subject') + '/' + item.douban + '/photos/' : 'https://www.douban.com/search?q=' + encodeURIComponent(item.zh || item.title)},
    {name:'Pinterest', url:'https://www.pinterest.com/search/pins/?q=' + encodeURIComponent(query)}
  ];
}
export function parsePinterest(data) {
  const pins = Array.isArray(data?.data) ? data.data : data?.data?.pins || [];
  return cleanAlbum(pins.filter(pin=>/^\d+$/.test(pin.id || '')).map(pin=>{
    const image = pin.images?.orig || pin.images?.['736x'] || pin.images?.['564x'] || pin.images?.['236x'];
    return {url:image?.url || '', thumbnail:pin.images?.['236x']?.url || image?.url || '', title:String(pin.description || 'Pinterest 选图').replace(/<[^>]*>/g,' ').slice(0,200), kind:'选入图片', source:'Pinterest · 你选择的图片', license:'版权归原权利人', pageUrl:'https://www.pinterest.com/pin/' + pin.id + '/'};
  }));
}
export async function imagesFromLink(input, {signal} = {}) {
  let url; try { url = new URL(input.trim()); } catch { throw Error('请输入完整的图片或 Pinterest 链接'); }
  if (url.protocol !== 'https:') throw Error('请使用 https 图片链接');
  if (validImageUrl(url.href)) {
    const source = url.hostname === 'i.pinimg.com' ? 'Pinterest' : /doubanio\.com$/.test(url.hostname) ? '豆瓣' : 'IMDb / 图片原站';
    return cleanAlbum([{url:url.href, title:'我选入的图片', kind:'选入图片', source:source + ' · 手动选入', license:'版权归原权利人'}]);
  }
  if (!/^(www\.)?pinterest\.com$/.test(url.hostname)) throw Error('IMDb、豆瓣请复制图片地址；Pinterest 可使用 Pin 或图板链接');
  const pin = url.pathname.match(/^\/pin\/(\d+)\/?$/);
  let board;try{board=decodeURIComponent(url.pathname).match(/^\/([\w-]+)\/([\p{L}\p{N}_-]+)\/?$/u);}catch{throw Error('图板链接格式不正确');}
  let endpoint;
  if (pin) endpoint = 'pins/info/?pin_ids=' + pin[1];
  else if (board && !['search','ideas','business','settings'].includes(board[1])) endpoint = 'boards/' + encodeURIComponent(board[1]) + '/' + encodeURIComponent(board[2]) + '/pins/';
  else throw Error('请粘贴具体 Pin 或图板链接');
  const response = await fetch('https://widgets.pinterest.com/v3/pidgets/' + endpoint, {signal:signal || AbortSignal.timeout(15000), credentials:'omit'});
  if (!response.ok) throw Error('Pinterest 图片暂时无法读取，可尝试图片地址');
  const images = parsePinterest(await response.json());
  if (!images.length) throw Error('没有读到公开图片，请检查链接或使用图片地址');
  return images;
}

export function boundedCache(input,maxEntries,maxChars,keepId){
 const entries=Object.entries(input).sort(([a,x],[b,y])=>a===keepId?-1:b===keepId?1:(Date.parse(y.fetchedAt)||0)-(Date.parse(x.fetchedAt)||0)).slice(0,maxEntries);
 while(entries.length>1&&JSON.stringify(Object.fromEntries(entries)).length>maxChars)entries.pop();
 return Object.fromEntries(entries);
}
