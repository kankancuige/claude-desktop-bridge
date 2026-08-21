// ─── Final Review Gate ───
export const meta = { name:'final-review', description:'按父任务风险执行一次定向最终门禁审查', phases:[{title:'Review',detail:'检查本轮真实变更'},{title:'Verify',detail:'仅证伪高风险候选项'}] }
const target=args.target||'.'
const tier=args.reviewTier==='power'?'power':'balanced'
const mode=args.reviewMode==='gate'?'gate':'focused'
const files=Array.isArray(args.files)?args.files.slice(0,80):[]
const domains=Array.isArray(args.riskDomains)&&args.riskDomains.length?args.riskDomains.slice(0,8):['correctness']
if(files.length===0)return {passed:true,findings:[],summary:'没有真实文件差异，跳过最终审查',tier}
phase('Review')
const review=await agent('只审查本轮列出的变更文件，不扫描整个仓库，不修改文件。允许读取这些文件的直接调用方和直接依赖以判断回归，但问题必须定位到变更文件，不能把未修改模块扩展成审查对象。\n目标目录: '+target+'\n审查模式: '+mode+'\n风险域: '+domains.join(', ')+'\n变更文件:\n'+files.map((f,i)=>(i+1)+'. '+f.path+' ('+(f.lines||1)+' lines)').join('\n')+'\n只报告能用当前代码证据确认的真实问题。critical/high 默认 blocking；medium/low 默认 advisory。',{label:'final-review',phase:'Review',modelTier:tier,schema:{type:'object',properties:{findings:{type:'array',items:{type:'object',properties:{severity:{type:'string',enum:['critical','high','medium','low']},blocking:{type:'boolean'},title:{type:'string'},description:{type:'string'},file:{type:'string'},line:{type:'number'},suggestion:{type:'string'}},required:['severity','title','description','file']}},summary:{type:'string'}},required:['findings','summary']}})
let findings=review?.findings||[]
const candidates=findings.filter(i=>i.blocking===true||i.severity==='critical'||i.severity==='high').slice(0,8)
if(tier==='power'&&candidates.length>0){phase('Verify');const verified=await parallel(candidates.map((finding,index)=>()=>agent('尝试证伪以下最终审查发现，只根据可定位代码证据判断:\n'+JSON.stringify(finding),{label:'verify:'+index,phase:'Verify',modelTier:'power',schema:{type:'object',properties:{isReal:{type:'boolean'},reason:{type:'string'}},required:['isReal','reason']}}).then(verdict=>({finding,verdict}))));const realKeys=new Set(verified.filter(i=>i?.verdict?.isReal).map(i=>i.finding.file+'\0'+i.finding.title));findings=findings.filter(i=>!(i.blocking===true||i.severity==='critical'||i.severity==='high')||realKeys.has(i.file+'\0'+i.title))}
const blocking=findings.filter(i=>i.blocking===true||i.severity==='critical'||i.severity==='high')
return {passed:blocking.length===0,findings,summary:blocking.length>0?'最终审查发现 '+blocking.length+' 个阻断问题':(review?.summary||'最终审查通过'),tier}
