const validId=id=>/^(tt|nm)\d{5,12}$/.test(id||'');
const networkMessage=/load failed|failed to fetch|network ?error|network request failed|connection.*offline|连接|超时/i;
export function restorePhotoTasks(value,now=Date.now()){
 const result={};for(const [id,raw]of Object.entries(value||{}).slice(-60)){
  if(!validId(id)||!raw||typeof raw!=='object')continue;let task={...raw};
  if(task.status==='submitting'||task.status==='failed'&&networkMessage.test(task.message||''))task={...task,status:'waiting-network',retryAt:now,message:'暂时无法连接补图服务'};
  result[id]=task;
 }return result;
}
export function deferPhotoTask(task,error,now=Date.now()){
 const attempts=(Number(task?.attempts)||0)+1;
 if(!error?.retryable)return {status:'failed',attempts,message:error?.message||'本次补图未完成'};
 const delay=[3000,15000,60000,180000][Math.min(attempts-1,3)];
 return {status:'waiting-network',attempts,retryAt:now+delay,message:error.message||'暂时无法连接补图服务'};
}
export function photoTaskDelay(tasks,now=Date.now()){
 let delay=Infinity;for(const task of Object.values(tasks||{})){
  if(['queued','processing'].includes(task.status))delay=Math.min(delay,20000);
  if(task.status==='waiting-network')delay=Math.min(delay,Math.max(1000,(task.retryAt||now)-now));
 }return Number.isFinite(delay)?delay:null;
}
