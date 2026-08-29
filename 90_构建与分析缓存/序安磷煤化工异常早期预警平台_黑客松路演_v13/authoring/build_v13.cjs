const pptxgen = require('pptxgenjs');
const path = require('path');

const ROOT = '/Users/rocalight/Desktop/All in one Data/01_PROJECTS/FDE任务/03_产品与解决方案/03_连续化工过程偏移副驾驶';
const WORK = path.join(ROOT, '90_构建与分析缓存/序安磷煤化工异常早期预警平台_黑客松路演_v13');
const ASSET = path.join(WORK, 'assets');
const OUTPUT = path.join(ROOT, '04_交付成品/序安_磷煤化工异常早期预警平台_黑客松路演_v13_ZH_REVIEW.pptx');

const C = { navy:'071E2E', navy2:'0B2D42', cyan:'25C7CC', cyan2:'64E1DF', blue:'2D7196', white:'FFFFFF', ink:'10293A', text:'294353', muted:'607A89', pale:'E9F4F5', panel:'F5F9FA', line:'B9D3D8', amber:'F2A93B', red:'E35B55', green:'32A879' };
// Brand CJK family; PDF QA export loads it through the checked-in fontconfig.
const FONT = 'Source Han Sans SC';

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'Wuno FDE';
pptx.company = 'Wuno';
pptx.subject = '序安·磷煤化工异常早期预警平台黑客松路演';
pptx.title = '序安·磷煤化工异常早期预警平台';
pptx.lang = 'zh-CN';
pptx.theme = { headFontFace: FONT, bodyFontFace: FONT, lang: 'zh-CN' };
pptx.defineSlideMaster({
  title:'CONTENT',
  background:{color:C.white},
  objects:[
    {text:{text:'序安 · 磷煤化工异常早期预警平台',options:{x:0.62,y:0.18,w:5.4,h:0.28,fontFace:FONT,fontSize:12.5,bold:true,color:C.blue,margin:0,fit:'shrink'}}},
    {text:{text:'公开资料研究 · 当前只读',options:{x:9.62,y:0.18,w:3.1,h:0.28,fontFace:FONT,fontSize:12,color:C.muted,align:'right',margin:0}}},
  ],
  slideNumber:{x:12.35,y:7.08,w:0.35,h:0.22,fontFace:FONT,fontSize:12,color:C.muted,align:'right',margin:0}
});

function addTitle(slide, kicker, title, subtitle='') {
  slide.addText(kicker,{x:0.65,y:0.6,w:4.3,h:0.3,fontFace:FONT,fontSize:15,bold:true,color:C.cyan,margin:0,charSpacing:1});
  slide.addText(title,{x:0.65,y:0.98,w:12,h:0.58,fontFace:FONT,fontSize:31,bold:true,color:C.ink,margin:0,breakLine:false,fit:'shrink'});
  if(subtitle) slide.addText(subtitle,{x:0.66,y:1.62,w:11.8,h:0.4,fontFace:FONT,fontSize:18,color:C.muted,margin:0,fit:'shrink'});
}
function addFooter(slide, text) {
  slide.addText(text,{x:0.68,y:6.93,w:11.7,h:0.28,fontFace:FONT,fontSize:12.5,color:C.muted,margin:0,fit:'shrink'});
}
function box(slide,x,y,w,h,fill=C.panel,line=C.line,r=0.12) {
  slide.addShape(pptx.ShapeType.roundRect,{x,y,w,h,rectRadius:r,fill:{color:fill},line:{color:line,width:1.2},radius:r});
}
function pill(slide,text,x,y,w,color=C.cyan,txt=C.navy) {
  slide.addShape(pptx.ShapeType.roundRect,{x,y,w,h:0.38,rectRadius:0.12,fill:{color},line:{color},radius:0.12});
  slide.addText(text,{x:x+0.08,y:y+0.07,w:w-0.16,h:0.2,fontFace:FONT,fontSize:13,bold:true,color:txt,align:'center',margin:0,fit:'shrink'});
}
function arrow(slide,x1,y1,x2,y2,color=C.cyan) {
  slide.addShape(pptx.ShapeType.line,{x:x1,y:y1,w:x2-x1,h:y2-y1,line:{color,width:2,beginArrowType:'none',endArrowType:'triangle'}});
}
function notes(slide, spoken, sources) {
  slide.addNotes(`[逐字稿]\n${spoken}\n\n[Sources]\n${sources.map(s=>`- ${s}`).join('\n')}`);
}
function addLogo(slide,x=0.7,y=0.55,w=0.72,h=0.72) {
  slide.addImage({path:path.join(ROOT,'apps/web/public/brand/xuanan-anomaly-intercept-v04.svg'),x,y,w,h});
}

// 1 cover
{
  const s=pptx.addSlide(); s.background={color:C.navy};
  s.addImage({path:path.join(ASSET,'磷化工园区_封面主视觉_v01.png'),x:0,y:0,w:13.333,h:7.5});
  s.addShape(pptx.ShapeType.rect,{x:0,y:0,w:13.333,h:7.5,fill:{color:C.navy,transparency:22},line:{color:C.navy,transparency:100}});
  s.addShape(pptx.ShapeType.rect,{x:0,y:0,w:7.35,h:7.5,fill:{color:C.navy,transparency:6},line:{color:C.navy,transparency:100}});
  addLogo(s,0.72,0.58,0.82,0.82);
  s.addText('序安',{x:1.7,y:0.66,w:1.7,h:0.5,fontFace:FONT,fontSize:25,bold:true,color:C.white,margin:0});
  pill(s,'磷煤化工异常早期预警平台',0.75,1.68,3.8,C.cyan,C.navy);
  s.addText('让过程风险\n在化验结果出来前先被看见',{x:0.75,y:2.25,w:6.25,h:1.55,fontFace:FONT,fontSize:38,bold:true,color:C.white,margin:0,breakLine:false,fit:'shrink'});
  s.addText('基于已有 DCS 时序数据，预测风险、解释证据、由人确认',{x:0.78,y:4.14,w:5.95,h:0.62,fontFace:FONT,fontSize:20,color:'D7EEF1',margin:0,fit:'shrink'});
  s.addShape(pptx.ShapeType.roundRect,{x:0.75,y:5.25,w:5.95,h:0.92,rectRadius:0.08,fill:{color:C.navy2,transparency:8},line:{color:C.cyan,width:1.3},radius:0.08});
  s.addText('产业背景参考：贵阳息烽磷煤化工园区公开资料\n无合作关系 · 未使用园区真实生产数据',{x:1.02,y:5.49,w:5.42,h:0.44,fontFace:FONT,fontSize:16.5,color:C.white,bold:true,margin:0,fit:'shrink'});
  s.addText('HACKATHON REVIEW · v13',{x:0.78,y:6.78,w:3.4,h:0.24,fontFace:FONT,fontSize:12,color:'A9CAD0',margin:0});
  notes(s,'大家好，这是序安磷煤化工异常早期预警平台。它解决一个具体问题：现场已经有 DCS 在线数据，能不能在离线化验结果出来前，更早看到质量和过程异常？部分产业背景参考贵阳息烽磷煤化工园区公开资料；这不代表我们与园区或相关企业已有合作。',['息烽磷煤化工园区公开资料，仅作产业背景参考','封面主视觉：内置 imagegen 生成，无企业标识']);
}

// 2 industry background
{
  const s=pptx.addSlide('CONTENT'); addTitle(s,'01 · 产业背景','磷煤化工园区为什么需要更早判断','公开资料显示：生产、质量、处置与资源循环相互牵动');
  const xs=[0.72,3.82,6.92,10.02]; const labels=['湿法磷酸','下游产品','磷石膏处置','资源循环'];
  const subs=['过程持续运行','质量结果滞后','处置压力变化','多工段相互影响'];
  xs.forEach((x,i)=>{box(s,x,2.25,2.55,1.55,i===0?C.navy2:C.panel,i===0?C.navy2:C.line);s.addText(labels[i],{x:x+0.22,y:2.55,w:2.1,h:0.35,fontFace:FONT,fontSize:22,bold:true,color:i===0?C.white:C.ink,align:'center',margin:0});s.addText(subs[i],{x:x+0.22,y:3.05,w:2.1,h:0.3,fontFace:FONT,fontSize:16,color:i===0?'C6E8EC':C.muted,align:'center',margin:0});if(i<3)arrow(s,x+2.6,3.02,x+3.02,3.02);});
  s.addShape(pptx.ShapeType.roundRect,{x:1.12,y:4.52,w:11.1,h:1.18,rectRadius:0.12,fill:{color:C.pale},line:{color:C.cyan,width:1.4},radius:0.12});
  s.addText('一个工段变化，可能同时影响后续质量、设备负荷和处置压力',{x:1.5,y:4.83,w:10.35,h:0.38,fontFace:FONT,fontSize:25,bold:true,color:C.navy,align:'center',margin:0,fit:'shrink'});
  pill(s,'公开资料研究背景',5.02,6.04,3.25,C.amber,C.navy);
  addFooter(s,'参考：息烽园区公开规划、公开环评与产业报道；不代表序安掌握园区内部参数或已获得业务确认。');
  notes(s,'从公开资料看，磷化工园区不是一条孤立生产线，而是由湿法磷酸、下游产品、磷石膏处置和资源循环共同组成的复杂系统。一个工段的变化，可能影响后续质量、设备负荷和处置压力。这类场景适合验证序安的核心能力：利用已有过程数据，提前判断风险并给出证据。',['队友稿：贵阳息烽磷煤化工园区AI赋能应用思路_汇报精简版.pptx（仅作公开资料研究参考）','无合作关系，未使用园区真实生产数据']);
}

// 3 gap
{
  const s=pptx.addSlide('CONTENT'); addTitle(s,'02 · 具体堵点','变量已经在线，关键结果仍要等待','AI 补的是 DCS 与离线化验之间的判断窗口');
  const steps=[['DCS 在线变量','持续到达'],['取样与离线化验','结果稍后返回'],['AI 风险窗口','提前组织证据'],['人工确认','决定与留痕']];
  steps.forEach((a,i)=>{const x=0.75+i*3.1;box(s,x,2.15,2.55,1.85,i===2?C.navy2:C.panel,i===2?C.navy2:C.line);s.addText(String(i+1).padStart(2,'0'),{x:x+0.25,y:2.43,w:0.55,h:0.35,fontFace:FONT,fontSize:18,bold:true,color:i===2?C.cyan:C.blue,margin:0});s.addText(a[0],{x:x+0.25,y:2.9,w:2.05,h:0.35,fontFace:FONT,fontSize:21,bold:true,color:i===2?C.white:C.ink,margin:0,fit:'shrink'});s.addText(a[1],{x:x+0.25,y:3.42,w:2.05,h:0.28,fontFace:FONT,fontSize:16,color:i===2?'C7E8EB':C.muted,margin:0});if(i<3)arrow(s,x+2.62,3.05,x+3.02,3.05);});
  s.addText('序安不替代 DCS，也不替代化验；它把判断时间往前移。',{x:1.05,y:4.75,w:11.2,h:0.65,fontFace:FONT,fontSize:29,bold:true,color:C.navy,align:'center',margin:0,fit:'shrink'});
  const candidates=['关键质量软测量','污水出水风险','连续过程偏移'];
  candidates.forEach((t,i)=>pill(s,t,2.02+i*3.15,5.75,2.75,i===1?C.cyan:C.pale,C.navy));
  addFooter(s,'以上为基于公开产业背景提出的 PoC 方向，不是园区已确认需求。');
  notes(s,'DCS 能持续记录温度、压力、流量、液位和设备状态，但部分关键质量结果仍要等待取样和离线化验。序安不替代 DCS，也不替代化验，而是利用这段时间里已经产生的数据，先形成风险判断窗口。这里列出的方向是基于公开资料提出的 PoC 构想，不是园区已经确认的需求。',['docs/submission/序安DCS智能预判平台_磷化工园区背景融合路演提纲_v04_REVIEW.md']);
}

// 4 product chain
{
  const s=pptx.addSlide('CONTENT'); addTitle(s,'03 · 产品链路','预测风险，解释原因，把决定权留给人','五个动作组成可追溯的判断闭环');
  const labels=[['发现','风险或偏移'],['判断','候选与置信'],['解释','变量证据'],['建议','先查什么'],['确认','人审与记录']];
  labels.forEach((a,i)=>{const x=0.72+i*2.52;s.addShape(pptx.ShapeType.ellipse,{x:x+0.58,y:2.22,w:1.08,h:1.08,fill:{color:i===4?C.green:C.navy2},line:{color:i===4?C.green:C.cyan,width:2}});s.addText(String(i+1),{x:x+0.58,y:2.52,w:1.08,h:0.28,fontFace:FONT,fontSize:22,bold:true,color:C.white,align:'center',margin:0});s.addText(a[0],{x,y:3.58,w:2.2,h:0.38,fontFace:FONT,fontSize:23,bold:true,color:C.ink,align:'center',margin:0});s.addText(a[1],{x,y:4.05,w:2.2,h:0.3,fontFace:FONT,fontSize:16,color:C.muted,align:'center',margin:0});if(i<4)arrow(s,x+1.73,2.77,x+2.45,2.77);});
  box(s,1.08,5.15,11.15,0.95,C.pale,C.cyan);s.addText('AI 负责持续读取与组织证据　｜　现场人员负责最终判断　｜　系统负责审计留痕',{x:1.35,y:5.47,w:10.6,h:0.3,fontFace:FONT,fontSize:20,bold:true,color:C.navy,align:'center',margin:0,fit:'shrink'});
  addFooter(s,'当前 Demo 是判断与审计闭环，不是自动控制闭环。');
  notes(s,'序安位于现有 DCS 和人员判断之间。它先预测风险，再告诉操作员为什么这样判断、应该先检查什么。人员可以确认、驳回或补充备注，每一步都能回看。当前 Demo 做的是判断和审计闭环，不是自动控制闭环。',['README.md：当前只读边界','apps/web 用户旅程验收']);
}

// 5 wastewater conceptual demo
{
  const s=pptx.addSlide('CONTENT'); addTitle(s,'04 · 技术验证','公开数据验证预测链路','公开城市污水数据只用于验证“预测—证据—人工确认”');
  box(s,0.72,2.1,7.55,4.25,C.navy2,C.navy2);
  s.addText('从“已发生”看向“可能发生”',{x:1.08,y:2.42,w:4.3,h:0.38,fontFace:FONT,fontSize:22,bold:true,color:C.white,margin:0});
  s.addText('趋势结构示意 · 非真实效果数据',{x:5.05,y:2.48,w:2.72,h:0.26,fontFace:FONT,fontSize:12.5,color:'A7CBD2',align:'right',margin:0});
  // 清晰图表语义：左侧是已观测结果，右侧是模型预测，红色区域才是风险区。
  s.addShape(pptx.ShapeType.rect,{x:1.18,y:3.18,w:6.55,h:0.63,fill:{color:C.red,transparency:82},line:{color:C.red,transparency:100}});
  s.addShape(pptx.ShapeType.line,{x:1.18,y:3.81,w:6.55,h:0,line:{color:C.red,width:1.8,dash:'dash'}});
  s.addText('风险阈值（示意）',{x:1.34,y:3.35,w:1.8,h:0.24,fontFace:FONT,fontSize:12.5,bold:true,color:'FFD6D3',margin:0});
  s.addShape(pptx.ShapeType.line,{x:1.18,y:5.75,w:6.55,h:0,line:{color:'5F8390',width:1.2}});
  s.addShape(pptx.ShapeType.line,{x:1.18,y:3.1,w:0,h:2.65,line:{color:'5F8390',width:1.2}});
  const observed=[[1.28,5.28],[1.95,5.18],[2.62,5.24],[3.29,5.03],[3.96,4.91],[4.63,4.72],[5.30,4.55]];
  const forecast=[[5.30,4.55],[5.88,4.30],[6.46,3.86],[7.04,3.53],[7.60,3.38]];
  for(let i=0;i<observed.length-1;i++) s.addShape(pptx.ShapeType.line,{x:observed[i][0],y:observed[i][1],w:observed[i+1][0]-observed[i][0],h:observed[i+1][1]-observed[i][1],line:{color:C.cyan2,width:3.5}});
  for(let i=0;i<forecast.length-1;i++) s.addShape(pptx.ShapeType.line,{x:forecast[i][0],y:forecast[i][1],w:forecast[i+1][0]-forecast[i][0],h:forecast[i+1][1]-forecast[i][1],line:{color:C.amber,width:3.5,dash:'dash'}});
  s.addShape(pptx.ShapeType.line,{x:5.30,y:3.1,w:0,h:2.65,line:{color:C.white,width:1.4,dash:'dash',transparency:35}});
  s.addShape(pptx.ShapeType.ellipse,{x:5.20,y:4.45,w:0.2,h:0.2,fill:{color:C.white},line:{color:C.white}});
  s.addText('当前时刻',{x:4.76,y:5.88,w:1.12,h:0.25,fontFace:FONT,fontSize:12.5,bold:true,color:C.white,align:'center',margin:0});
  s.addText('已观测结果',{x:1.34,y:5.88,w:1.45,h:0.25,fontFace:FONT,fontSize:12.5,color:C.cyan2,margin:0});
  s.addText('未来预测区间',{x:6.18,y:5.88,w:1.42,h:0.25,fontFace:FONT,fontSize:12.5,color:C.amber,align:'right',margin:0});
  s.addText('尚未越界',{x:4.12,y:4.34,w:1.0,h:0.25,fontFace:FONT,fontSize:13,color:'D2E7EA',margin:0});
  s.addText('预测进入风险区',{x:6.05,y:3.04,w:1.62,h:0.3,fontFace:FONT,fontSize:14,bold:true,color:C.amber,align:'right',margin:0});
  box(s,8.62,2.1,4.0,1.1,C.pale,C.line);s.addText('数据来源',{x:8.92,y:2.36,w:1.3,h:0.28,fontFace:FONT,fontSize:16,bold:true,color:C.blue,margin:0});s.addText('UCI 公开城市污水处理数据',{x:8.92,y:2.72,w:3.25,h:0.28,fontFace:FONT,fontSize:18,bold:true,color:C.ink,margin:0,fit:'shrink'});
  box(s,8.62,3.45,4.0,1.35,C.panel,C.line);s.addText('官网原始记录',{x:8.95,y:3.72,w:1.7,h:0.28,fontFace:FONT,fontSize:16,color:C.muted,margin:0});s.addText('527 条',{x:10.72,y:3.62,w:1.45,h:0.45,fontFace:FONT,fontSize:26,bold:true,color:C.navy,align:'right',margin:0});s.addText('当前演示本地镜像：520 条',{x:8.95,y:4.25,w:3.25,h:0.3,fontFace:FONT,fontSize:16,bold:true,color:C.blue,margin:0});
  box(s,8.62,5.05,4.0,1.3,'FFF6E8','F2C97B');s.addText('重要边界',{x:8.95,y:5.32,w:1.6,h:0.3,fontFace:FONT,fontSize:17,bold:true,color:'9A5E00',margin:0});s.addText('不是贵州企业或息烽园区数据\n不代表真实工厂效果',{x:8.95,y:5.72,w:3.2,h:0.45,fontFace:FONT,fontSize:16,bold:true,color:C.ink,margin:0,fit:'shrink'});
  addFooter(s,'520 与 527 的差异原因须由最终 manifest / 构建报告解释；当前不自行归因。');
  notes(s,'这一页是公开数据技术验证。UCI 城市污水数据用于验证预测滞后结果、展示变量证据和等待人工确认的链路。它不是磷煤化工园区真实数据，也不能被说成园区实际效果。官网记录五百二十七条，当前本地镜像五百二十条，差异不自行归因。',['UCI Water Treatment Plant：https://archive.ics.uci.edu/dataset/106/water+treatment+plant','官网 527 条；当前本地镜像 520 条']);
}

// 6 explain / ask
{
  const s=pptx.addSlide('CONTENT'); addTitle(s,'05 · 证据与交互','AI 的判断必须能被追问','结论、变量趋势、检查建议和人工决定在同一条事件链上');
  s.addImage({path:path.join(ASSET,'操作员AI追问.png'),x:0.72,y:2.05,w:7.55,h:4.5});
  box(s,8.62,2.05,4.0,1.1,C.navy2,C.navy2);s.addText('操作员追问',{x:8.92,y:2.35,w:3.4,h:0.32,fontFace:FONT,fontSize:18,bold:true,color:C.cyan,margin:0});s.addText('“为什么这样判断？”',{x:8.92,y:2.72,w:3.4,h:0.32,fontFace:FONT,fontSize:21,bold:true,color:C.white,margin:0});
  const items=[['01','引用当前事件'],['02','最多三项变量证据'],['03','给出优先检查项'],['04','等待人工确认']];
  items.forEach((a,i)=>{const y=3.42+i*0.72;s.addShape(pptx.ShapeType.ellipse,{x:8.72,y,w:0.45,h:0.45,fill:{color:i===3?C.green:C.cyan},line:{color:i===3?C.green:C.cyan}});s.addText(a[0],{x:8.72,y:y+0.085,w:0.45,h:0.24,fontFace:FONT,fontSize:12,bold:true,color:C.navy,align:'center',margin:0});s.addText(a[1],{x:9.38,y:y+0.06,w:2.95,h:0.28,fontFace:FONT,fontSize:18,bold:true,color:C.ink,margin:0});});
  addFooter(s,'截图为现有真实产品旅程。变量相关性只是排查线索，不等于已确认工艺原因。');
  notes(s,'系统不能只给一个风险分数。它还要指出哪些变量与这次判断关系最大、趋势怎样变化、数据是否完整。操作员可以继续追问，并决定确认还是驳回。变量相关性只是排查线索，不能直接冒充已经确认的工艺原因。',['用户旅程验收 UJ03-01：操作员 AI 追问','当前截图为 TEP 产品链路，不是园区数据']);
}

// 7 TEP
{
  const s=pptx.addSlide('CONTENT'); addTitle(s,'06 · 连续过程验证','TEP：连续过程偏移如何被解释','公开仿真数据 · 多变量偏移 · 故障候选 · 变量证据');
  s.addImage({path:path.join(ASSET,'TEP_偏移捕获.png'),x:0.72,y:2.0,w:5.95,h:3.75});
  s.addImage({path:path.join(ASSET,'TEP_AI证据解释.png'),x:6.85,y:2.0,w:5.75,h:3.75});
  pill(s,'偏移捕获',2.4,5.95,2.55,C.cyan,C.navy);pill(s,'AI 证据解释',8.45,5.95,2.55,C.pale,C.navy);
  addFooter(s,'数据来源：Tennessee Eastman Process 公开仿真。不是贵州企业或息烽园区数据，也不证明真实生产收益。');
  notes(s,'TEP 是第二组公开技术验证，展示连续过程多变量偏移、故障候选和变量证据。它帮助验证异常研判链路，但不是贵州企业或息烽园区数据，也不证明真实生产收益。',['TEP 上游：https://github.com/camaramm/tennessee-eastman-profBraatz','现有真实产品截图']);
}

// 8 application map + official ref
{
  const s=pptx.addSlide('CONTENT'); addTitle(s,'07 · 磷煤化工应用构想','从一个预测目标开始，不做大而全平台','园区公开资料用于理解问题；PoC 必须在正式授权后重新定义');
  const cards=[['关键质量预测','选一个离线化验目标\n建立软测量与风险窗口'],['异常早期预警','对齐 DCS 变量与滞后结果\n先做影子验证'],['过程偏移研判','形成事件、候选、证据\n支持交接与复盘']];
  cards.forEach((a,i)=>{const x=0.72+i*4.14;box(s,x,2.15,3.72,2.45,i===1?C.pale:C.panel,i===1?C.cyan:C.line);s.addText(String(i+1).padStart(2,'0'),{x:x+0.32,y:2.48,w:0.7,h:0.35,fontFace:FONT,fontSize:18,bold:true,color:i===1?C.cyan:C.blue,margin:0});s.addText(a[0],{x:x+0.32,y:3.0,w:3.05,h:0.4,fontFace:FONT,fontSize:23,bold:true,color:C.ink,margin:0,fit:'shrink'});s.addText(a[1],{x:x+0.32,y:3.62,w:3.05,h:0.58,fontFace:FONT,fontSize:17,color:C.text,margin:0,breakLine:false,fit:'shrink'});});
  box(s,0.72,5.02,12.0,1.33,'FFF7EA','F0C77E');
  s.addText('产业写作参考',{x:1.02,y:5.28,w:2.1,h:0.28,fontFace:FONT,fontSize:17,bold:true,color:'9A5E00',margin:0});
  s.addText('贵州省大数据发展管理局公开的“1468”装置磷化工能耗优化大模型案例',{x:3.0,y:5.23,w:8.95,h:0.36,fontFace:FONT,fontSize:18,bold:true,color:C.ink,margin:0,fit:'shrink'});
  s.addText('仅作产业方向与写作参考；无合作关系，未使用其生产数据，公开成效不属于序安。',{x:3.0,y:5.76,w:8.95,h:0.32,fontFace:FONT,fontSize:16,color:C.text,margin:0,fit:'shrink'});
  addFooter(s,'官方来源：https://dsj.guizhou.gov.cn/ztzl/rdzt/jdal/202601/t20260120_89316875.html');
  notes(s,'公开产业资料说明，磷化工中的预测、参数优化和边缘闭环值得继续探索。序安不重复讲一个泛化的磷化工大模型，而是聚焦闭环之前的风险研判、变量证据、人工接管和审计。息烽园区资料和官方案例都只是产业背景与写作参考，不是我们的合作案例，也不证明序安已经在现场运行。',['贵州省大数据发展管理局公开案例，2026-01-20','明确：无合作关系，未使用真实生产数据，公开成效不属于序安']);
}

// 9 boundary
{
  const s=pptx.addSlide('CONTENT'); addTitle(s,'08 · 安全边界','当前只读；未来写回也必须逐道过闸','把“已经实现”和“路线图”明确分开');
  box(s,0.72,2.12,4.0,3.95,C.navy2,C.navy2);pill(s,'当前 Demo',1.15,2.5,1.75,C.cyan,C.navy);s.addText('只读 / 影子建议',{x:1.15,y:3.18,w:3.1,h:0.5,fontFace:FONT,fontSize:28,bold:true,color:C.white,margin:0});s.addText('读取数据\n预测风险\n整理证据\n人工确认\n审计留痕',{x:1.18,y:3.95,w:2.6,h:1.52,fontFace:FONT,fontSize:19,color:'D4EBEE',margin:0,breakLine:false});
  s.addText('不自动写回\nPLC / DCS',{x:3.28,y:4.48,w:1.05,h:0.72,fontFace:FONT,fontSize:17,bold:true,color:C.amber,align:'center',margin:0,fit:'shrink'});
  box(s,5.03,2.12,7.59,3.95,C.panel,C.line);pill(s,'未来路线图',5.42,2.5,1.9,C.amber,C.navy);
  const gates=['人工审批','权限校验','工艺上下限','联锁校验','控制网关','执行回读','审计'];
  gates.forEach((t,i)=>{const row=Math.floor(i/4),col=i%4;const x=5.42+col*1.72,y=3.28+row*1.08;box(s,x,y,1.48,0.72,i===6?C.pale:C.white,i===6?C.cyan:C.line);s.addText(t,{x:x+0.08,y:y+0.23,w:1.32,h:0.22,fontFace:FONT,fontSize:14.5,bold:true,color:C.ink,align:'center',margin:0,fit:'shrink'});});
  s.addText('任何一步失败，都不能显示为执行成功',{x:5.45,y:5.55,w:6.55,h:0.3,fontFace:FONT,fontSize:19,bold:true,color:C.red,align:'center',margin:0});
  addFooter(s,'未来受控写回仅为路线图，不是当前功能或现场承诺。');
  notes(s,'当前 Demo 是只读影子建议。未来是否进入受控写回，需要由真实项目评估，而且必须经过人工审批、权限、工艺上下限、联锁、网关和执行回读。其中任何一步失败，都不能显示为执行成功。',['README.md：系统只提供读侧证据与建议','未来写回架构为路线图，不代表已实现']);
}

// 10 close
{
  const s=pptx.addSlide();s.background={color:C.navy};addLogo(s,0.72,0.6,0.82,0.82);s.addText('序安 · 磷煤化工异常早期预警平台',{x:1.72,y:0.69,w:5.4,h:0.4,fontFace:FONT,fontSize:21,bold:true,color:C.white,margin:0,fit:'shrink'});
  s.addText('一套装置 · 一个目标 · 一条只读数据链',{x:0.75,y:1.75,w:11.9,h:0.72,fontFace:FONT,fontSize:35,bold:true,color:C.white,align:'center',margin:0,fit:'shrink'});
  const labels=['公开资料对齐','正式授权调研','明确预测目标','只读数据核验','影子运行','人工复核'];
  labels.forEach((t,i)=>{const x=0.72+i*2.08;s.addShape(pptx.ShapeType.ellipse,{x:x+0.56,y:3.0,w:0.85,h:0.85,fill:{color:i===5?C.green:C.cyan},line:{color:i===5?C.green:C.cyan}});s.addText(String(i+1),{x:x+0.56,y:3.27,w:0.85,h:0.25,fontFace:FONT,fontSize:18,bold:true,color:C.navy,align:'center',margin:0});s.addText(t,{x:x,y:4.12,w:1.95,h:0.55,fontFace:FONT,fontSize:17,bold:true,color:C.white,align:'center',margin:0,fit:'shrink'});if(i<5)arrow(s,x+1.48,3.42,x+2.02,3.42,C.cyan2);});
  s.addShape(pptx.ShapeType.roundRect,{x:1.05,y:5.35,w:11.22,h:0.95,rectRadius:0.08,fill:{color:C.navy2},line:{color:C.cyan,width:1.4},radius:0.08});
  s.addText('今天展示的是公开资料基础上的应用构想，不代表合作已经发生。',{x:1.42,y:5.66,w:10.5,h:0.32,fontFace:FONT,fontSize:21,bold:true,color:C.white,align:'center',margin:0,fit:'shrink'});
  s.addText('序安先把证据和责任链做扎实，再讨论控制。',{x:2.15,y:6.72,w:9.0,h:0.3,fontFace:FONT,fontSize:18,color:'BFDDE2',align:'center',margin:0});
  notes(s,'如果未来有机会与磷化工园区或企业正式沟通，第一步不是承诺一个大平台，而是选一套装置、一个关键化验目标和一条只读数据链。先让工艺人员验证预测和证据是否有用，再讨论下一阶段。今天引用的园区内容只是公开产业背景，不代表合作已经发生。',['docs/submission/序安DCS智能预判平台_磷化工园区背景融合路演提纲_v04_REVIEW.md']);
}

pptx.writeFile({ fileName: OUTPUT });
