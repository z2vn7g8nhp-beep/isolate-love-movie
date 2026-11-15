import json,urllib.request,urllib.parse,concurrent.futures,datetime,pathlib
items=[('tt1856101','Blade Runner 2049','银翼杀手 2049','film','Q21500755'),('tt0118694','In the Mood for Love','花样年华','film','Q196630'),('tt0245429','Spirited Away','千与千寻','film','Q155653'),('tt0816692','Interstellar','星际穿越','film','Q13417189'),('tt0211915','Amelie','天使爱美丽','film','Q207661'),('tt0110912','Pulp Fiction','低俗小说','film','Q104123'),('tt6751668','Parasite','寄生虫','film','Q61448040'),('tt0109830','Forrest Gump','阿甘正传','film','Q134773'),('tt0133093','The Matrix','黑客帝国','film','Q83495'),('tt0903747','Breaking Bad','绝命毒师','series','Q1079'),('tt7366338','Chernobyl','切尔诺贝利','series','Q48741290'),('tt0944947','Game of Thrones','权力的游戏','series','Q23572'),('nm0000128','Russell Crowe','罗素·克劳','person','Q130899'),('nm0331516','Ryan Gosling','瑞恩·高斯林','person','Q193815'),('nm0000706','Michelle Yeoh','杨紫琼','person','Q170278'),('nm0000329','Jackie Chan','成龙','person','Q36970'),('nm0000195','Bill Murray','比尔·默瑞','person','Q29250'),('nm0000406','Akira Kurosawa','黑泽明','person','Q8006'),('nm0000112','Pierce Brosnan','皮尔斯·布鲁斯南','person','Q81520')]
def get(x):
 id,title,zh,kind,wiki=x
 try:
  url='https://v3.sg.media-imdb.com/suggestion/x/'+urllib.parse.quote(title)+'.json'
  data=json.load(urllib.request.urlopen(url,timeout=20))
  d=next((d for d in data.get('d',[]) if d['id']==id),None)
  if not d: raise Exception('not in suggestions')
  return dict(id=id,title=d['l'],zh=zh,kind=kind,wikidata=wiki,year=d.get('y'),subtitle=d.get('s',''),image=d.get('i',{}).get('imageUrl',''),source='IMDb',fetchedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
 except Exception as e:
  print(id,str(e));return None
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool: data=[x for x in pool.map(get,items) if x]
pathlib.Path('/workspace/isolate-love-movie/public/catalog.json').write_text(json.dumps(data,ensure_ascii=False,indent=2))
print('Fetched',len(data),'IMDb records')
