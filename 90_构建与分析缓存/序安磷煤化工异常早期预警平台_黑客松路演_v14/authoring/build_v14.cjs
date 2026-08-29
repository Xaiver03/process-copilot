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
// 正式品牌事实源：序安“异常边界截获”v04。禁止改回旧眼形标志或 favicon。
const logo = path.join(project, 'apps/web/public/brand/xuanan-anomaly-intercept-v04.svg');
const hero = path.join(assets, '园区封面主视觉.png');
const processHero = path.join(assets, '过滤异常主视觉.png');
const replayShot = path.join(assets, 'screenshots', '公网在线回放_1440.png');
const aiShot = path.join(assets, 'screenshots', '公网DeepSeek_AI研判与证据解释_首屏.png');
const aiStatusShot = path.join(assets, 'screenshots', '公网AI运行状态_全页.png');
const notes = [];

function text(slide, value, x, y, w, h, size=20, color=C.navy, bold=false, extra={}) {
  slide.addText(value, {x,y,w,h,fontFace:'Source Han Sans SC',fontSize:size,color,bold,margin:0,fit:'shrink',valign:'mid',paraSpaceAfterPt:0,lineSpacingMultiple:1,...extra});
}
function box(slide,x,y,w,h,fill=C.white,line=C.border,r=0.12){slide.addShape(pptx.ShapeType.roundRect,{x,y,w,h,rectRadius:r,fill:{color:fill},line:{color:line,width:1.2}});}
function dot(slide,x,y,color=C.cyan,r=0.1){slide.addShape(pptx.ShapeType.ellipse,{x:x-r,y:y-r,w:r*2,h:r*2,fill:{color},line:{color}});}
function arrow(slide,x,y,w,color=C.cyan){slide.addShape(pptx.ShapeType.line,{x,y,w,h:0,line:{color,width:2.4,endArrowType:'triangle'}});}
function badge(slide,value,x,y,w,fill=C.pale,color=C.teal){box(slide,x,y,w,0.38,fill,fill);text(slide,value,x+0.1,y+0.02,w-0.2,0.31,12,color,true,{align:'center'});}
function header(slide,kicker,title,sub=''){text(slide,kicker,0.72,0.34,5.5,0.3,12,C.teal,true,{charSpacing:1.6});text(slide,title,0.72,0.75,11.7,0.62,30,C.navy,true);if(sub)text(slide,sub,0.74,1.42,11.5,0.36,16,C.gray);}
function brand(slide,dark=false){slide.addImage({path:logo,x:11.66,y:0.22,w:0.62,h:0.62});text(slide,'序安',12.24,0.35,0.72,0.3,14,dark?C.white:C.navy,true);}
function base(){const s=pptx.addSlide();s.background={color:C.bg};s.addShape(pptx.ShapeType.line,{x:0.72,y:7.08,w:11.9,h:0,line:{color:C.border,width:1}});text(s,'序安·磷煤化工异常早期预警平台',0.72,7.16,5.6,0.18,9,C.gray);text(s,String(pptx._slides.length).padStart(2,'0'),12.15,7.16,0.45,0.18,9,C.gray,true,{align:'right'});return s;}
function note(slide,title,value){slide.addNotes(value);notes.push({title,value});}

// 01 封面
{
 const s=pptx.addSlide();s.background={color:C.deep};s.addImage({path:hero,x:0,y:0,w:13.333,h:7.5});
 s.addShape(pptx.ShapeType.rect,{x:0,y:0,w:8.2,h:7.5,fill:{color:C.deep,transparency:12},line:{color:C.deep,transparency:100}});
 s.addShape(pptx.ShapeType.rect,{x:0,y:0,w:13.333,h:7.5,fill:{color:'00101C',transparency:48},line:{color:'00101C',transparency:100}});
 s.addImage({path:logo,x:0.8,y:0.56,w:0.82,h:0.82});text(s,'序安',1.68,0.76,1.12,0.38,21,C.white,true);badge(s,'黑客松路演 · REVIEW',0.8,1.55,2.4,'12374A',C.cyan);
 text(s,'磷煤化工异常\n早期预警平台',0.8,2.05,7.35,1.62,42,C.white,true);
 text(s,'让异常在化验结果前被看见',0.82,4.02,7.7,0.55,22,C.cyan,true);
 text(s,'读懂 DCS 时序信号 · 给出原因证据 · 由人确认闭环',0.82,4.77,7.2,0.42,17,C.white);
 text(s,'当前 Demo：只读 / 影子建议',0.82,6.47,3.5,0.34,14,C.white,true);
 note(s,'封面','作品名是“序安·磷煤化工异常早期预警平台”。一句话介绍：让异常在化验结果前被看见。它不替代 DCS，也不替代操作员；它持续读取已经存在的过程数据，在化验结果出来前指出风险，并把判断依据和处置建议交给人确认。');
}

// 02 具体人物与当前损耗
{
 const s=base();header(s,'01 / 谁在用','中控操作员周师傅的一个白班','不讲“广大用户”，只看一个人如何判断');brand(s);
 const day=[['08:00','接班','看 DCS 趋势与交接记录'],['10:20','曲线变怪','来回翻趋势、问上一班'],['11:00','等化验','打电话追结果、跨工段核对'],['11:30','决定处置','靠经验排查，再写交接记录']];
 day.forEach((a,i)=>{const x=0.68+i*3.12;box(s,x,2.05,2.78,2.38,i===2?'FFF5E4':C.white,i===2?C.amber:C.border);text(s,a[0],x+0.22,2.28,0.8,0.3,14,i===2?C.amber:C.cyan,true);text(s,a[1],x+0.22,2.82,2.32,0.4,23,C.navy,true);text(s,a[2],x+0.22,3.45,2.32,0.7,16,C.gray);if(i<3)arrow(s,x+2.82,3.16,0.28);});
 box(s,0.78,5.02,11.75,1.28,C.deep,C.deep);text(s,'没有序安时的具体损耗',1.05,5.22,3.0,0.34,18,C.cyan,true);text(s,'4 处信息反复核对  ·  等待吃掉处置窗口\n高经验人员被重复排查占用  ·  事后证据难还原',4.02,5.14,7.82,0.72,16,C.white,true,{align:'center'});
 note(s,'周师傅的一班','这不是给“广大用户”的抽象平台。我们先服务一个具体人：中控操作员周师傅。他接班后看 DCS 和交接记录；曲线变怪时来回翻趋势、问上一班；关键结果没出来，还要打电话追化验、跨工段核对。损耗很具体：四处信息反复核对，等待吃掉处置窗口，高经验人员被重复排查占用，事后证据又难还原。');
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
 const s=base();header(s,'03 / 真实 AI 链路','诊断模型做判断，DeepSeek 把证据讲明白','公网实测：llm_enhanced / deepseek-v4-flash');brand(s);
 const ns=[['实时变量','DCS / 传感器'],['诊断模型','异常窗口与候选'],['结构化证据','PH-P / PH-E / Q-E'],['DeepSeek','解释、问答、Trace'],['操作员','确认 / 驳回']];
 ns.forEach((a,i)=>{const y=1.92+i*0.92;box(s,0.72,y,4.22,0.68,i===3?C.deep:(i===4?'FFF5E4':C.white),i===3?C.deep:(i===4?C.amber:C.border));text(s,a[0],0.94,y+0.13,1.55,0.3,16,i===3?C.white:C.navy,true);text(s,a[1],2.42,y+0.13,2.2,0.3,14,i===3?C.cyan:C.gray,false,{align:'right'});if(i<4)arrow(s,2.67,y+0.72,0.01);});
 box(s,5.22,1.9,7.33,4.82,C.white,C.border);s.addImage({path:aiShot,x:5.36,y:2.04,w:7.05,h:4.54});badge(s,'PLAYWRIGHT 公网实拍',9.78,6.12,2.35,'12374A',C.cyan);
 text(s,'语言模型只解释当前事件的结构化证据，不直接控制设备。',0.78,6.62,4.2,0.34,13,C.red,true,{align:'center'});
 note(s,'真实 AI 链路','这一页是本轮公网真实截图。过程诊断模型先产生异常窗口、故障候选和变量证据；DeepSeek 只在这些结构化证据上做解释和问答。公网实测返回 llm_enhanced，模型是 deepseek-v4-flash，证据引用为 PH-P、PH-E 和 Q-E，每次调用都有 Trace。这证明解释增强链路已打通，但不代表语言模型可以控制设备。');
}

// 06 Demo
{
 const s=base();header(s,'04 / Demo 复现','评委现在就能自己跑一遍','公网链接 + 演示账号 + 三步操作');brand(s);
 const steps=[['01','登录','https://huagong.finlaw.cloud/demo'],['02','回放','账号 operator-01\n口令 demo-op-2026'],['03','追问并确认','选场景 → 开始回放\n进事件 → 向序安追问']];
 steps.forEach((a,i)=>{const y=2.05+i*1.25;badge(s,a[0],0.72,y,0.62,i===2?'FFF5E4':C.pale,i===2?C.amber:C.teal);text(s,a[1],1.58,y-0.01,2.15,0.38,20,C.navy,true);text(s,a[2],1.58,y+0.43,2.52,0.45,14,C.gray);});
 box(s,0.72,5.95,3.4,0.72,C.deep,C.deep);text(s,'当前 Demo：只读 / 影子建议',0.94,6.12,2.95,0.34,17,C.white,true,{align:'center'});
 box(s,4.48,1.98,8.08,4.73,C.white,C.border);s.addImage({path:replayShot,x:4.62,y:2.12,w:7.8,h:4.39});
 badge(s,'公网用户旅程 11/11 通过',9.3,6.12,2.87,'12374A',C.cyan);
 note(s,'Demo 复现','评委可以现场复现。第一步，打开 https://huagong.finlaw.cloud/demo，用 operator-01 和口令 demo-op-2026 登录。第二步，选择污水出水风险或 TEP 场景，开始过程回放。第三步，进入捕获到的风险事件，向序安追问并做人工确认。2026 年 8 月 30 日公网完整 Playwright 用户旅程 11/11 通过，耗时约 2.6 分钟，覆盖双场景、AI 同链 Trace、人工决策、后台审计和多端无横向溢出。这是 Demo 可复现证据，不是生产验证。当前 Demo 只读，不会向 PLC 或 DCS 发送指令。');
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

// 09 48 小时增量
{
 const s=base();header(s,'07 / 开发边界','48 小时做了什么，哪些不是这次才有','如实区分本次增量与赛前 / 开源基线');brand(s);
 box(s,0.74,1.92,5.72,4.72,C.white,C.border);badge(s,'赛前 / 开源基线',1.02,2.22,2.35);text(s,'不算本次独立从零开发',1.02,2.82,4.92,0.42,22,C.navy,true);['Next.js / FastAPI / PostgreSQL 工程骨架','TEP 与 UCI 公开数据','基础过程回放与只读理念','开源依赖和通用工具链'].forEach((v,i)=>{dot(s,1.15,3.66+i*0.58,C.teal,0.08);text(s,v,1.38,3.45+i*0.58,4.42,0.36,17,C.gray,i===0);});
 box(s,6.82,1.92,5.75,4.72,C.deep,C.deep);badge(s,'本次 48 小时新增 / 重构',7.12,2.22,2.72,'12374A',C.cyan);text(s,'可验证的增量',7.12,2.82,4.72,0.42,23,C.white,true);['磷煤化工异常早期预警定位','污水软测量 + TEP 双场景旅程','DeepSeek 真实在线解释与 Trace','人工确认、影子闸门与公网 Demo','公网 Playwright 用户旅程 11/11 通过'].forEach((v,i)=>{dot(s,7.24,3.56+i*0.54,i===2?C.amber:C.cyan,0.08);text(s,v,7.48,3.35+i*0.54,4.38,0.34,16,C.white,i===2);});
 note(s,'48 小时增量','我们不把开源框架和赛前工作包装成四十八小时内从零完成。赛前和开源基线包括 Next.js、FastAPI、PostgreSQL 工程骨架，TEP 和 UCI 公开数据，基础回放和只读理念。本次四十八小时新增或重构的是：磷煤化工定位、污水与 TEP 双场景旅程、DeepSeek 真实在线解释与 Trace、人工确认和影子闸门，以及公网 Demo 和 Playwright 复现证据。');
}

// 10 技术、数据与授权
{
 const s=base();header(s,'08 / 技术与来源','模型、工具、数据和素材从哪里来','可复现，也可追溯');brand(s);
 const groups=[['模型','污水软测量：随机森林\nTEP：PCA / 梯度提升诊断\n解释：deepseek-v4-flash'],['工具','Next.js · FastAPI · PostgreSQL\nPython · Playwright\nPptxGenJS'],['数据','UCI 城市污水：官网 527 条\n本地镜像 520 条\nTEP 公开仿真数据'],['素材授权','Logo：序安自有资产\n截图：自有公网 Demo 实拍\n主视觉：AI 生成，无企业标识\nSource Han Sans SC：SIL OFL']];
 groups.forEach((a,i)=>{const x=0.7+(i%2)*6.2,y=1.92+Math.floor(i/2)*2.35;box(s,x,y,5.72,1.98,i===3?'FFF5E4':C.white,i===3?C.amber:C.border);text(s,a[0],x+0.28,y+0.23,1.55,0.36,20,i===3?C.amber:C.teal,true);text(s,a[1],x+1.78,y+0.22,3.58,1.45,16,C.navy,i===0);});
 text(s,'公开数据 ≠ 贵州真实生产数据  ·  官方案例引用 ≠ 合作关系',1.35,6.72,10.65,0.3,16,C.red,true,{align:'center'});
 note(s,'技术与来源','模型方面，污水软测量使用随机森林，TEP 使用 PCA 与梯度提升诊断，语言解释使用 deepseek-v4-flash。工具包括 Next.js、FastAPI、PostgreSQL、Python、Playwright 和 PptxGenJS。数据使用 UCI 公开城市污水数据和 TEP 公开仿真数据。Logo 是序安自有资产，截图由我们的公网 Demo 实拍，主视觉由 AI 生成且没有企业标识，中文字体 Source Han Sans SC 采用 SIL OFL 许可。');
}

// 11 PoC
{
 const s=base();header(s,'09 / 落地方式','先用一个装置，证明一个预警闭环','4–8 周只读 PoC；周期以现场数据条件为准');brand(s);
 const cols=[['第 1–2 周','定义问题','选一个装置、一个风险目标\n确认变量与化验标签'],['第 3–4 周','离线验证','清洗历史数据\n回放异常窗口和证据'],['第 5–6 周','影子运行','只读接入 / 文件同步\n与班组判断并行对照'],['第 7–8 周','共同验收','看提前量、误报、可解释性\n决定是否扩大范围']];
 cols.forEach((a,i)=>{const x=0.63+i*3.12;text(s,a[0],x,1.98,2.5,0.28,12,C.cyan,true);s.addShape(pptx.ShapeType.line,{x,y:2.4,w:2.52,h:0,line:{color:i===3?C.amber:C.cyan,width:5}});text(s,a[1],x,2.72,2.52,0.44,23,C.navy,true);text(s,a[2],x,3.44,2.52,1.0,16,C.gray);});box(s,0.75,5.15,11.8,0.95,C.pale,C.cyan);text(s,'最低数据清单：时间戳一致的过程变量、有限化验/事件标签、设备与工艺上下文、明确访问授权。',1.08,5.4,11.14,0.4,18,C.navy,true,{align:'center'});text(s,'PoC 不承诺虚构效果；用共同认可的回放与影子运行结果决定下一步。',2.02,6.4,9.25,0.32,15,C.gray,true,{align:'center'});
 note(s,'PoC','落地不需要一开始覆盖整个园区。我们建议先选一个装置、一个风险目标，确认变量和化验标签；然后做离线历史回放，检查异常窗口和证据；再进行只读影子运行，与班组判断并行对照；最后共同验收提前量、误报和可解释性。四到八周只是建议节奏，实际周期取决于现场数据条件。');
}

// 10 收尾
{
 const s=pptx.addSlide();s.background={color:C.deep};brand(s,true);text(s,'再给 100 天，我们先做什么？',0.82,0.82,7.2,0.54,20,C.cyan,true);text(s,'进入一个获授权装置，\n完成首个目标的只读数据对齐。',0.82,1.62,8.4,1.44,36,C.white,true);box(s,0.82,3.65,6.72,1.45,'12374A',C.cyan);text(s,'一个装置  ×  一个风险目标  ×  一条只读数据链',1.18,4.03,5.98,0.6,23,C.white,true,{align:'center'});text(s,'现场需要共同确认',8.42,1.75,3.55,0.42,19,C.cyan,true);['谁能授权数据','最痛的异常是什么','怎么定义“有用的提前量”'].forEach((v,i)=>{dot(s,8.56,2.72+i*0.78,i===2?C.amber:C.cyan);text(s,v,8.86,2.5+i*0.78,3.42,0.44,18,C.white,true);});text(s,'序安·磷煤化工异常早期预警平台',0.82,6.56,6.8,0.36,17,C.white,true);text(s,'公开验证数据 ≠ 贵州企业真实数据 ｜ 公开案例参照 ≠ 合作关系',7.0,6.56,5.43,0.28,12,'B5CAD3',false,{align:'right'});
 note(s,'100 天的第一件事','如果再给我们一百天，第一件事只有一句话：进入一个获授权装置，完成首个目标的只读数据对齐。我们不会一开始就接管控制，而是先选一个装置、一个风险目标和一条只读数据链。公开验证数据不等于贵州企业真实数据，公开案例参照也不等于合作关系。');
}

fs.mkdirSync(path.dirname(out), {recursive:true});
fs.mkdirSync(path.dirname(scriptOut), {recursive:true});
Promise.resolve(pptx.writeFile({fileName:out})).then(()=>{
 const md=['# 序安·磷煤化工异常早期预警平台｜黑客松路演 v14 逐字稿','','> 与 PPTX 演讲者备注逐页一致；面向普通观众，可直接照读。',''];
 notes.forEach((n,i)=>md.push(`## ${String(i+1).padStart(2,'0')}｜${n.title}`,'',n.value,''));
 fs.writeFileSync(scriptOut,md.join('\n'),'utf8');
 console.log(out);console.log(scriptOut);
});
