import json,urllib.request,urllib.parse,datetime,pathlib,concurrent.futures
p=pathlib.Path('/workspace/isolate-love-movie/public/catalog.json');data=json.loads(p.read_text())
def verify(x):
 if x.get('wikidata'):
  try:
   e=json.load(urllib.request.urlopen('https://www.wikidata.org/wiki/Special:EntityData/'+x['wikidata']+'.json',timeout=15))['entities'][x['wikidata']]
   ids=[c.get('mainsnak',{}).get('datavalue',{}).get('value') for c in e.get('claims',{}).get('P345',[])]
   if x['id'] not in ids:x.pop('wikidata',None)
   else:
    for prop in ['P4529','P5284']:
     claims=e.get('claims',{}).get(prop,[])
     if claims:x['douban']=claims[0]['mainsnak']['datavalue']['value']
  except:x.pop('wikidata',None)
 return x
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:data=list(pool.map(verify,data))
roles=[('k','K / 乔','K','银翼杀手 2049','Ryan Gosling','nm0331516','tt1856101'),('joi','Joi / 乔伊','Joi','银翼杀手 2049','Ana de Armas','nm1869101','tt1856101'),('cooper','库珀','Joseph Cooper','星际穿越','Matthew McConaughey','nm0000190','tt0816692'),('amelie','艾米丽','Amélie Poulain','天使爱美丽','Audrey Tautou','nm0851582','tt0211915'),('walter-white','沃尔特·怀特','Walter White','绝命毒师','Bryan Cranston','nm0186505','tt0903747'),('neo','尼奥','Neo','黑客帝国','Keanu Reeves','nm0000206','tt0133093')]
for slug,zh,title,work,actor,aid,wid in roles:
 try:
  r=json.load(urllib.request.urlopen('https://v3.sg.media-imdb.com/suggestion/x/'+aid+'.json',timeout=15))
  image=next((x.get('i',{}).get('imageUrl','') for x in r.get('d',[]) if x['id']==aid),'')
 except:image=''
 data.append(dict(id='char-'+slug,title=title,zh=zh,kind='character',work=work,actor=actor,actorId=aid,workId=wid,image=image,source='人工整理 · IMDb 作品与演员',subtitle='角色图像使用饰演者肖像'))
p.write_text(json.dumps(data,ensure_ascii=False,indent=2));print('Verified',len(data),'entries')
