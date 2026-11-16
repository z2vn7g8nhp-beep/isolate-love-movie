const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>typeof value==='number'?value:Date.parse(value||'');
const duration=ms=>{const minutes=Math.max(0,Math.floor(ms/60000));return minutes<1?'不足 1 分钟':minutes<60?minutes+' 分钟':Math.floor(minutes/60)+' 小时 '+minutes%60+' 分钟';};
const time=value=>Number.isFinite(date(value))?new Date(date(value)).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}):'';
export function photoTaskStalled(task,now=Date.now()){
 return task?.status==='processing'&&Number.isFinite(date(task.updatedAt||task.startedAt))&&now-date(task.updatedAt||task.startedAt)>900000;
}
export function photoPublicationReady(task,result){
 if(result.registered===false)return false;
 if(task.dataCheckedAt)return result.datasetAt===task.dataCheckedAt||date(result.datasetAt)>date(task.dataCheckedAt);
 return Number.isFinite(date(result.datasetAt||result.checkedAt))&&date(result.datasetAt||result.checkedAt)>=date(task.requestedAt||task.intentAt);
}
export function photoTaskWithSnapshot(task,result){
 if(!task||!['syncing','ready','loaded'].includes(task.status)||!photoPublicationReady(task,result)||!result.datasetSources)return task;
 // Older/outbox-recovered tasks may have no collector report. Fill only the
 // missing published outcomes, without inventing a count for this request.
 const sources={...task.sources,...Object.fromEntries(Object.entries(result.datasetSources).map(([key,value])=>[key,{...value,...task.sources?.[key]}]))};
 const summary={...(Number.isSafeInteger(result.datasetTotal)?{total:result.datasetTotal}:{}),...task.summary};
 return {...task,sources,summary};
}
export function photoProgressMarkup(task,now=Date.now()){
 const completed=['ready','loaded'].includes(task.status),syncing=task.status==='syncing',failed=task.status==='failed',stalled=photoTaskStalled(task,now),queued=task.status==='queued',submitting=task.status==='submitting';
 const elapsed=now-date(task.requestedAt||task.intentAt),delayed=queued&&elapsed>=300000,stage=syncing?'publishing':task.stage||(queued?'queued':'collecting');
 const active=completed?3:submitting||queued?0:stage==='publishing'?2:1;
 let title=submitting?'正在提交补图':queued?delayed?'等待启动已延迟':'已排队，等待启动':stage==='preparing'?'采集器已启动':stage==='publishing'?'图片已采集，正在发布':'正在读取图片';
 let detail=submitting?'正在把这次请求送到补图队列。':queued?'采集器尚未开始，暂时无法预计启动时间。':stage==='preparing'?'正在核对条目、准备采集环境。':stage==='publishing'?'正在保存图库并发布到相册，完成后自动读取。':'正在依次读取三个图源，结果会逐项更新。';
 if(syncing){title='图库已发布，正在读取';detail='正在核对新版图库并把图片载入这个相册。';}
 if(completed){const added=task.summary?.added;title=Number.isSafeInteger(added)?added?'本次新增 '+added+' 张图片':'本次没有新增图片':'图库已更新';detail=Number.isSafeInteger(task.summary?.total)?'图库现有 '+task.summary.total+' 张去重图片。':'图库已发布，已有图片可以继续查看。';}
 if(failed){title='本次补图未完成';detail=task.message||'采集或发布中断，可以重新提交。';}
 if(stalled){title='采集暂时没有继续';detail='超过 15 分钟没有收到采集回报，可以重新提交。';}
 const labels=['排队','采集','发布','完成'],states={fetching:'正在读取',ok:'已读取',empty:'暂无新图',blocked:'限制访问',unmatched:'未找到图库',unavailable:'暂不可用'};
 const sourceCards=Object.entries({imdb:'IMDb',douban:'豆瓣',pinterest:'Pinterest'}).map(([key,name])=>{
  const source=task.sources?.[key],label=source?source.limited?'仅公开主图':states[source.status]||'暂不可用':queued||submitting?'等待启动':completed?'未提供结果':'等待读取';
  return `<li class="${source?.status==='fetching'&&!stalled?'is-reading':''}"><b>${name}</b><span>${esc(label)}</span>${Number.isSafeInteger(source?.newImages)?`<small>新增 ${source.newImages} 张${source.total?' · 共 '+source.total+' 张':''}</small>`:Number.isSafeInteger(source?.total)?`<small>图库共 ${source.total} 张</small>`:''}</li>`;
 }).join('');
 const age=completed?'已完成':failed?'已结束':Number.isFinite(elapsed)?(queued?'已等待 ':'已提交 ')+duration(elapsed):'等待回报';
 const checked=task.statusCheckedAt?`上次确认 ${time(task.statusCheckedAt)}`:'';
 const collector=queued&&task.lastCollectorAt?`采集器上次检查 ${time(task.lastCollectorAt)}`:'';
 const connection=task.lastCheckError?'进度连接暂时中断，当前显示上次确认的状态。':'';
 return `<section class="photo-request-card photo-progress${delayed||stalled?' is-delayed':''}" aria-label="补图进度"><div class="photo-progress-heading"><h4>${esc(title)}</h4><span class="photo-progress-age">${esc(age)}</span></div><ol class="photo-progress-steps" aria-label="补图阶段">${labels.map((label,index)=>`<li class="${index<active?'is-complete':index===active?'is-current':''}"${index===active?' aria-current="step"':''}><i aria-hidden="true">${index<active?'✓':index+1}</i><span>${label}</span></li>`).join('')}</ol><p role="status">${esc(detail)}${queued&&Number.isSafeInteger(task.queueAhead)?`<br>${task.queueAhead?'前面还有 '+task.queueAhead+' 个条目。':'当前排在待处理队列首位。'}`:''}</p>${!submitting?`<ul class="photo-progress-sources">${sourceCards}</ul>`:''}<div class="photo-progress-meta">${task.requestedAt?`<span>${time(task.requestedAt)} 提交</span>`:''}${checked?`<span>${esc(checked)}</span>`:''}${collector?`<span>${esc(collector)}</span>`:''}${!completed&&!failed&&!submitting?'<span>打开应用时每 20 秒检查</span>':''}</div>${connection?`<p class="photo-progress-warning">${esc(connection)}</p>`:''}${delayed?'<a class="text-button" href="https://github.com/z2vn7g8nhp-beep/isolate-love-movie/actions/workflows/photo-queue.yml" target="_blank" rel="noopener">前往 GitHub 手动触发采集 ↗</a>':''}${stalled||failed?'<button class="button button-light" data-request-photos>重新补图 ↻</button>':''}</section>`;
}
