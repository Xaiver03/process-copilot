const pptxgen = require('pptxgenjs');
const fs = require('fs');
const path = require('path');

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = '序安';
pptx.company = '序安';
pptx.subject = '磷煤化工园区异常早期预警';
pptx.title = '序安·磷煤化工异常早期预警平台';
pptx.lang = 'zh-CN';
pptx.theme = { headFontFace: 'Source Han Sans SC', bodyFontFace: 'Source Han Sans SC', lang: 'zh-CN' };

const C = { bg:'F7FBFE', white:'FFFFFF', navy:'102A3A', deep:'061B2A', teal:'24839B', cyan:'13C2C2', pale:'EAF7FA', gray:'627987', border:'DCEAF5', amber:'F2A93B', red:'DE5B6D', green:'27AE84' };
const build = path.resolve(__dirname, '..');
const assets = path.join(build, 'assets');
const project = path.resolve(build, '..', '..');
const out = path.join(project, '04_交付成品', '序安_磷煤化工异常早期预警平台_黑客松路演_v14_ZH_REVIEW.pptx');
const scriptOut = path.join(project, 'docs', 'submission', '序安_磷煤化工异常早期预警平台_黑客松路演逐字稿_v14_REVIEW.md');
const logo = path.join(assets, '序安标志_v04.svg');
const hero = path.join(assets, '园区封面主视觉.png');
const processHero = path.join(assets, '过滤异常主视觉.png');
const replayShot = path.join(assets, 'screenshots', '公网在线回放_1440.png');
const notes = [];

function text(slide, value, x, y, w, h, size=20, color=C.navy, bold=false, extra={}) {
  slide.addText(value, {x,y,w,h,fontFace:'Source Han Sans SC',fontSize:size,color,bold,margin:0,fit:'shrink',valign:'mid',paraSpaceAfterPt:0,lineSpacingMultiple:1,...extra});
}
function box(slide,x,y,w,h,fill=C.white,line=C.border,r=0.12){slide.addShape(pptx.ShapeType.roundRect,{x,y,w,h,rectRadius:r,fill:{color:fill},line:{color:line,width:1.2}});}
function dot(slide,x,y,color=C.cyan,r=0.1){slide.addShape(pptx.ShapeType.ellipse,{x:x-r,y:y-r,w:r*2,h:r*2,fill:{color},line:{color}});}
function arrow(slide,x,y,w,color=C.cyan){slide.addShape(pptx.ShapeType.line,{x,y,w,h:0,line:{color,width:2.4,endArrowType:'triangle'}});}
function badge(slide,value,x,y,w,fill=C.pale,color=C.teal){box(slide,x,y,w,0.38,fill,fill);text(slide,value,x+0.1,y+0.02,w-0.2,0.31,12,color,true,{align:'center'});}
function header(slide,kicker,title,sub=''){text(slide,kicker,0.72,0.34,5.5,0.3,12,C.teal,true,{charSpacing:1.6});text(slide,title,0.72,0.75,11.7,0.62,30,C.navy,true);if(sub)text(slide,sub,0.74,1.42,11.5,0.36,16,C.gray);}
function brand(slide,dark=false){slide.addImage({path:logo,x:11.85,y:0.28,w:0.5,h:0.5});text(slide,'序安',12.3,0.36,0.6,0.28,13,dark?C.white:C.navy,true);}
function base(){const s=pptx.addSlide();s.background={color:C.bg};s.addShape(pptx.ShapeType.line,{x:0.72,y:7.08,w:11.9,h:0,line:{color:C.border,width:1}});text(s,'序安·磷煤化工异常早期预警平台',0.72,7.16,5.6,0.18,9,C.gray);text(s,String(pptx._slides.length).padStart(2,'0'),12.15,7.16,0.45,0.18,9,C.gray,true,{align:'right'});return s;}
function note(slide,title,value){slide.addNotes(value);notes.push({title,value});}

// 01 封面
{
 const s=pptx.addSlide();s.background={color:C.deep};s.addImage({path:hero,x:0,y:0,w:13.333,h:7.5});
 s.addShape(pptx.ShapeType.rect,{x:0,y:0,w:8.2,h:7.5,fill:{color:C.deep,transparency:12},line:{color:C.deep,transparency:100}});
 s.addShape(pptx.ShapeType.rect,{x:0,y:0,w:13.333,h:7.5,fill:{color:'00101C',transparency:48},line:{color:'00101C',transparency:100}});
 s.addImage({path:logo,x:0.8,y:0.62,w:0.62,h:0.62});text(s,'序安',1.5,0.73,1.0,0.34,18,C.white,true);badge(s,'黑客松路演 · REVIEW',0.8,1.55,2.4,'12374A',C.cyan);
 text(s,'磷煤化工异常\n早期预警平台',0.8,2.05,7.35,1.62,42,C.white,true);
 text(s,'让异常在事故之前、在化验结果之前被看见',0.82,4.02,7.7,0.55,22,C.cyan,true);
 text(s,'读懂 DCS 时序信号 · 给出原因证据 · 由人确认闭环',0.82,4.77,7.2,0.42,17,C.white);
 text(s,'当前 Demo：只读 / 影子建议',0.82,6.47,3.5,0.34,14,C.white,true);
 note(s,'封面','大家好，我们带来的是“序安·磷煤化工异常早期预警平台”。它不替代 DCS，也不替代操作员。它只做一件很具体的事：持续读取已经存在的过程数据，在化验结果出来之前、在异常演变成事故之前，指出风险正在形成，并把判断依据和处置建议交给人确认。');
}

// 02 时间差
{
 const s=base();header(s,'01 / 园区问题','真正的时间差，不在传感器，在判断');brand(s);
 text(s,'DCS 一直有数据',0.78,2.05,3.2,0.5,27,C.navy,true);text(s,'压力、流量、温度、液位、密度……\n现场变量持续在线。',0.8,2.72,3.35,0.9,19,C.gray);
 arrow(s,4.15,3.08,1.0);text(s,'但关键结论会迟到',5.38,2.05,3.55,0.5,27,C.red,true);text(s,'离线化验、跨装置核对、班组经验判断，\n往往发生在趋势已经形成之后。',5.4,2.72,3.58,0.9,19,C.gray);
 arrow(s,9.0,3.08,0.9,C.amber);box(s,10.12,1.95,2.4,2.1,'FFF5E4',C.amber);text(s,'序安补上\n“提前判断”',10.38,2.27,1.9,0.9,24,C.navy,true,{align:'center'});text(s,'不新增控制权',10.48,3.42,1.7,0.28,14,C.gray,true,{align:'center'});
 s.addShape(pptx.ShapeType.line,{x:0.85,y:5.05,w:11.65,h:0,line:{color:C.border,width:2}});
 ['磷酸生产','煤化工公辅','固废与水系统','下游产品'].forEach((v,i)=>{dot(s,1.45+i*3.02,5.05,i===2?C.amber:C.cyan,0.15);text(s,v,0.65+i*3.02,5.34,1.62,0.34,17,C.navy,true,{align:'center'});});
 text(s,'园区不是四个孤岛：一个环节的偏移，会沿物料、能源和环境链向后传递。',1.1,6.18,11.1,0.43,20,C.navy,true,{align:'center'});
 note(s,'园区问题','磷煤化工现场并不缺传感器，DCS 也一直在采集压力、流量、温度、液位和密度。真正的问题是，很多关键判断依赖离线化验、跨装置核对和老师傅经验。等结论出来时，趋势可能已经形成。序安补的是这段“提前判断”的时间差，而且不增加新的控制权。');
}

// 03 异常故事
{
 const s=pptx.addSlide();s.background={color:C.deep};s.addImage({path:processHero,x:0,y:0,w:13.333,h:7.5});s.addShape(pptx.ShapeType.rect,{x:7.05,y:0,w:6.3,h:7.5,fill:{color:C.deep,transparency:7},line:{color:C.deep,transparency:100}});brand(s,true);
 text(s,'一个异常，往往先表现为\n几条曲线一起“不太对”',7.62,0.98,4.9,1.12,30,C.white,true);
 const items=['过滤压差持续抬升','进料流量开始波动','产品密度偏离惯常关系'];items.forEach((v,i)=>{dot(s,7.9,2.78+i*0.88,i===2?C.amber:C.cyan,0.12);text(s,v,8.22,2.54+i*0.88,3.85,0.48,18,C.white,i===2);});
 box(s,7.62,5.45,4.72,0.95,'12374A',C.cyan);text(s,'单点不一定报警，组合关系已经改变',7.95,5.68,4.05,0.44,20,C.cyan,true,{align:'center'});
 text(s,'示意场景，不代表贵州企业真实数据或既有效果',7.7,6.67,4.55,0.25,11,'B5CAD3',false,{align:'center'});
 note(s,'具体异常','举一个普通观众也能理解的例子。过滤设备可能没有任何一个点立刻越过报警线，但过滤压差在抬升，进料流量开始波动，产品密度也偏离了过去的关系。单看每个点，好像都还能运行；把它们放在一起，异常的轮廓已经出现。这里展示的是典型场景，不是贵州企业的真实数据，也不是我们已经取得的现场效果。');
}

// 04 五步闭环
{
 const s=base();header(s,'02 / 产品闭环','先发现，再把“为什么”讲清楚','五步主链路，操作员始终在环');brand(s);
 const names=['发现','判断','解释','建议','人工确认'];const subs=['未来窗口','候选故障','变量证据','处置顺序','接管与留痕'];
 names.forEach((v,i)=>{const x=0.82+i*2.48;s.addShape(pptx.ShapeType.ellipse,{x,y:2.33,w:1.5,h:1.5,fill:{color:i===4?'FFF5E4':C.pale},line:{color:i===4?C.amber:C.cyan,width:2.2}});text(s,String(i+1).padStart(2,'0'),x+0.48,2.5,0.54,0.25,12,i===4?C.amber:C.teal,true,{align:'center'});text(s,v,x+0.12,2.88,1.26,0.4,22,C.navy,true,{align:'center'});if(i<4)arrow(s,x+1.58,3.08,0.68);text(s,subs[i],x-0.08,4.14,1.66,0.34,15,C.gray,true,{align:'center'});});
 box(s,1.06,5.18,11.16,0.86,C.deep,C.deep);text(s,'机器负责持续看，人负责最终决定；每一次判断、追问和确认都留下审计记录。',1.4,5.4,10.48,0.4,20,C.white,true,{align:'center'});
 note(s,'五步闭环','序安把过程拆成五步。第一，发现未来风险窗口。第二，对故障候选排序。第三，展示哪些变量、哪些时间段支持这个判断。第四，给出处置建议的先后顺序。第五，由操作员确认、驳回或升级。机器负责持续看，人负责最终决定，而且每一步都会留下记录。');
}

// 05 模型分工
{
 const s=base();header(s,'03 / AI 架构','诊断模型做判断，语言模型负责讲明白','语言模型不直接替代过程诊断');brand(s);
 const ns=[['实时变量 / 软测量','DCS、传感器、化验历史'],['异常窗口','预测未来风险区间'],['诊断模型','候选故障排序\n变量贡献'],['语言模型','基于结构化证据\n解释 / 问答'],['操作员','确认、驳回、升级'],['审计','留痕；未来受控写回']];
 ns.forEach((a,i)=>{const x=0.48+i*2.1;box(s,x,2.12,1.75,2.22,i===2?C.deep:(i===4?'FFF5E4':C.white),i===2?C.deep:(i===4?C.amber:C.border));text(s,a[0],x+0.13,2.5,1.49,0.58,18,i===2?C.white:C.navy,true,{align:'center'});text(s,a[1],x+0.14,3.33,1.47,0.65,13,i===2?'CBE9EF':C.gray,false,{align:'center'});if(i<5)arrow(s,x+1.77,3.24,0.28);});
 box(s,1.15,5.22,11.0,0.83,C.pale,C.cyan);text(s,'关键边界：语言模型只能解释已经结构化的证据，不能凭一句话直接控制设备。',1.45,5.44,10.4,0.38,19,C.navy,true,{align:'center'});
 text(s,'真实 llm_enhanced 公网截图待供应商恢复后补入；当前不采用 template-v0.1 旧截图。',2.2,6.42,8.9,0.28,12,C.gray,false,{align:'center'});
 note(s,'模型分工','这里要讲清楚两类模型的分工。过程诊断模型读取实时变量和软测量结果，先发现异常窗口，再给故障候选排序，并计算变量贡献。语言模型拿到这些结构化证据以后，负责把技术判断翻译成人能理解的话，并回答追问。它不能绕过诊断模型，更不能因为一句对话就直接控制设备。');
}

// 06 Demo
{
 const s=base();header(s,'04 / 现场演示','我们现场演示的，不是一张静态截图','从回放到确认，走完一条真实产品路径');brand(s);
 const steps=[['01','选择场景','污水 / TEP 公开验证'],['02','过程回放','变量实时向前推进'],['03','捕获并确认','异常 → 证据 → 人工留痕']];
 steps.forEach((a,i)=>{const y=2.05+i*1.25;badge(s,a[0],0.72,y,0.62,i===2?'FFF5E4':C.pale,i===2?C.amber:C.teal);text(s,a[1],1.58,y-0.01,2.15,0.38,20,C.navy,true);text(s,a[2],1.58,y+0.43,2.52,0.45,14,C.gray);});
 box(s,0.72,5.95,3.4,0.72,C.deep,C.deep);text(s,'当前 Demo：只读 / 影子建议',0.94,6.12,2.95,0.34,17,C.white,true,{align:'center'});
 box(s,4.48,1.98,8.08,4.73,C.white,C.border);s.addImage({path:replayShot,x:4.62,y:2.12,w:7.8,h:4.39});
 badge(s,'PLAYWRIGHT 公网实拍',9.75,6.12,2.42,'12374A',C.cyan);
 note(s,'现场演示','现场演示会走一条完整路径：进入系统，选择公开验证场景，让过程变量开始回放；系统捕获异常窗口，给出候选故障和变量证据；操作员继续追问，并选择确认、驳回或升级。污水场景用来说明如何预测滞后的化验指标，TEP 场景用来说明连续化工过程偏移。它们都是公开技术验证数据，不是贵州企业数据。');
}

// 07 产业参照
{
 const s=base();header(s,'05 / 产业参照','闭环价值已经被证明，安全研判层仍需补齐');brand(s);
 box(s,0.75,1.84,5.7,4.62);badge(s,'贵州官方公开案例',1.05,2.14,2.3);text(s,'“1468”装置\n磷化工能耗优化大模型',1.05,2.74,4.85,0.95,27,C.navy,true);text(s,'公开方向：能耗 / 品质 / 设备预测\nAPC + RTO 参数优化与边缘闭环',1.07,3.92,4.75,0.82,18,C.gray);text(s,'公开成效：能耗降低 2% 以上\n操作频次下降 70% 以上 · 稳定性提升 30% 以上',1.08,5.02,4.78,0.83,16,C.teal,true);
 box(s,6.82,1.84,5.75,4.62,C.deep,C.deep);badge(s,'序安的边界',7.12,2.14,1.75,'12374A',C.cyan);text(s,'补齐“安全异常研判层”',7.12,2.76,4.7,0.5,27,C.white,true);['异常提前发现','故障候选排序','变量证据','人机接管与审计'].forEach((v,i)=>{dot(s,7.26,3.63+i*0.58);text(s,v,7.52,3.41+i*0.58,3.9,0.42,17,C.white,i===0);});text(s,'无合作关系 · 未使用其真实数据 · 公开成效不是序安成果',7.12,5.92,4.82,0.26,12,'B5CAD3',true,{align:'center'});
 text(s,'来源：贵州省大数据发展管理局公开案例，2026-01-20',0.78,6.76,5.6,0.23,11,C.gray);
 note(s,'产业参照','贵州省大数据发展管理局公开的“1468”案例说明，磷化工领域的能耗、品质、设备预测，以及 APC 加 RTO 的闭环优化，确实有产业价值。序安不重复讲一个泛化的“磷化工大模型”，而是补齐闭环之前的安全异常研判层：提前发现、故障候选、变量证据、人机接管和审计。我们与该案例没有合作关系，没有使用贵州企业真实数据，页面中的公开成效也不是序安成果。');
}

// 08 安全边界
{
 const s=base();header(s,'06 / 安全边界','现在只读；未来写回，要过六道闸门');brand(s);
 box(s,0.78,1.85,3.25,4.62,C.deep,C.deep);text(s,'当前 Demo',1.12,2.28,2.5,0.42,22,C.cyan,true,{align:'center'});text(s,'只读数据\n影子建议\n人工确认',1.2,3.0,2.35,1.55,29,C.white,true,{align:'center'});text(s,'不自动写回 PLC / DCS',1.08,5.34,2.66,0.32,16,C.white,true,{align:'center'});arrow(s,4.28,4.08,0.8);
 text(s,'生产版路线图',5.2,1.88,3.0,0.42,24,C.navy,true);const gates=['人工审批','身份与权限','工艺上下限','联锁校验','控制网关','执行回读'];gates.forEach((g,i)=>{const x=5.18+(i%3)*2.43,y=2.72+Math.floor(i/3)*1.48;box(s,x,y,2.03,1.05,i===5?'FFF5E4':C.white,i===5?C.amber:C.border);text(s,String(i+1).padStart(2,'0'),x+0.15,y+0.12,0.4,0.2,10,i===5?C.amber:C.cyan,true);text(s,g,x+0.15,y+0.46,1.73,0.34,17,C.navy,true,{align:'center'});});text(s,'任何一道不通过，就停在建议层。',5.3,6.2,6.74,0.38,20,C.red,true,{align:'center'});
 note(s,'安全边界','当前 Demo 的边界非常明确：只读数据、输出影子建议、由人确认，不自动写回 PLC 或 DCS。未来如果进入生产控制，也不是模型直接下指令，而是必须依次通过人工审批、身份与权限、工艺上下限、联锁校验、控制网关和执行回读。任何一道不通过，就停在建议层。');
}

// 09 PoC
{
 const s=base();header(s,'07 / 落地方式','先用一个装置，证明一个预警闭环','4–8 周只读 PoC；周期以现场数据条件为准');brand(s);
 const cols=[['第 1–2 周','定义问题','选一个装置、一个风险目标\n确认变量与化验标签'],['第 3–4 周','离线验证','清洗历史数据\n回放异常窗口和证据'],['第 5–6 周','影子运行','只读接入 / 文件同步\n与班组判断并行对照'],['第 7–8 周','共同验收','看提前量、误报、可解释性\n决定是否扩大范围']];
 cols.forEach((a,i)=>{const x=0.63+i*3.12;text(s,a[0],x,1.98,2.5,0.28,12,C.cyan,true);s.addShape(pptx.ShapeType.line,{x,y:2.4,w:2.52,h:0,line:{color:i===3?C.amber:C.cyan,width:5}});text(s,a[1],x,2.72,2.52,0.44,23,C.navy,true);text(s,a[2],x,3.44,2.52,1.0,16,C.gray);});box(s,0.75,5.15,11.8,0.95,C.pale,C.cyan);text(s,'最低数据清单：时间戳一致的过程变量、有限化验/事件标签、设备与工艺上下文、明确访问授权。',1.08,5.4,11.14,0.4,18,C.navy,true,{align:'center'});text(s,'PoC 不承诺虚构效果；用共同认可的回放与影子运行结果决定下一步。',2.02,6.4,9.25,0.32,15,C.gray,true,{align:'center'});
 note(s,'PoC','落地不需要一开始覆盖整个园区。我们建议先选一个装置、一个风险目标，确认变量和化验标签；然后做离线历史回放，检查异常窗口和证据；再进行只读影子运行，与班组判断并行对照；最后共同验收提前量、误报和可解释性。四到八周只是建议节奏，实际周期取决于现场数据条件。');
}

// 10 收尾
{
 const s=pptx.addSlide();s.background={color:C.deep};brand(s,true);text(s,'下一步，不是“接管控制”',0.82,0.82,7.2,0.54,20,C.cyan,true);text(s,'而是授权我们先看清\n一个真实问题',0.82,1.62,8.4,1.44,38,C.white,true);box(s,0.82,3.65,6.72,1.45,'12374A',C.cyan);text(s,'一个装置  ×  一个风险目标  ×  一条只读数据链',1.18,4.03,5.98,0.6,23,C.white,true,{align:'center'});text(s,'现场需要共同确认',8.42,1.75,3.55,0.42,19,C.cyan,true);['谁能授权数据','最痛的异常是什么','怎么定义“有用的提前量”'].forEach((v,i)=>{dot(s,8.56,2.72+i*0.78,i===2?C.amber:C.cyan);text(s,v,8.86,2.5+i*0.78,3.42,0.44,18,C.white,true);});text(s,'序安·磷煤化工异常早期预警平台',0.82,6.56,6.8,0.36,17,C.white,true);text(s,'公开验证数据 ≠ 贵州企业真实数据 ｜ 公开案例参照 ≠ 合作关系',7.0,6.56,5.43,0.28,12,'B5CAD3',false,{align:'right'});
 note(s,'收尾','我们今天提出的下一步，不是接管控制，而是请园区授权我们先看清一个真实问题：选一个装置、一个风险目标、建立一条只读数据链。双方先确认谁能授权数据、最痛的异常是什么，以及怎样定义“有用的提前量”。公开验证数据不等于贵州企业真实数据，公开案例参照也不等于合作关系。');
}

fs.mkdirSync(path.dirname(out), {recursive:true});
fs.mkdirSync(path.dirname(scriptOut), {recursive:true});
Promise.resolve(pptx.writeFile({fileName:out})).then(()=>{
 const md=['# 序安·磷煤化工异常早期预警平台｜黑客松路演 v14 逐字稿','','> 与 PPTX 演讲者备注逐页一致；面向普通观众，可直接照读。',''];
 notes.forEach((n,i)=>md.push(`## ${String(i+1).padStart(2,'0')}｜${n.title}`,'',n.value,''));
 fs.writeFileSync(scriptOut,md.join('\n'),'utf8');
 console.log(out);console.log(scriptOut);
});
