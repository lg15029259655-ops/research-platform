// Classification is based on the experiment's own name, never a conditional
// example from the description. More specific techniques precede broad terms.
export type ExperimentCategory = "database" | "cell" | "animal" | "analysis" | "protein" | "metabolism" | "gene" | "microfluidic" | "pathway" | "sample" | "constraint" | "control" | "goal" | "microscope" | "clinical" | "imaging" | "materials" | "device" | "survey" | "interview" | "archive" | "simulation" | "chemistry" | "software" | "education" | "field" | "baseline" | "outcome" | "followup" | "generic";

export const CATEGORY_OPTIONS: ReadonlyArray<readonly [ExperimentCategory, string]> = [
  ["cell", "细胞实验"], ["protein", "蛋白检测"], ["gene", "基因操作"], ["metabolism", "代谢研究"],
  ["animal", "动物实验"], ["clinical", "临床研究"], ["imaging", "医学影像"], ["microfluidic", "微流控"],
  ["database", "数据来源"], ["analysis", "数据分析"], ["materials", "材料与性能"], ["device", "工程器件"],
  ["simulation", "仿真建模"], ["survey", "问卷调查"], ["interview", "访谈与田野"], ["archive", "文本与档案"],
  ["chemistry", "化学实验"], ["software", "软件与算法"], ["education", "教育与干预"], ["field", "实地观测"],
  ["baseline", "基线评估"], ["outcome", "效果评估"], ["followup", "长期追踪"],
  ["pathway", "通路分析"], ["sample", "样本处理"], ["microscope", "显微与成像"], ["control", "对照设置"],
  ["goal", "研究目标"], ["constraint", "研究限制"], ["generic", "通用图形"],
];

export function effectiveCategory(name: string, override?: string | null, goal = ""): ExperimentCategory {
  const selected = CATEGORY_OPTIONS.find(([key]) => key === override)?.[0];
  if (selected) return selected;
  const automatic = experimentCategory(name);
  // Use the research goal only for explicitly related, otherwise ambiguous
  // intervention/process labels; do not override a named laboratory technique.
  if ((automatic === "generic" || automatic === "analysis") && /教育|教学|课堂|学生|education|teaching|student/i.test(goal) &&
      /干预实施|干预方案|过程保真度|intervention implementation|process fidelity/i.test(name)) return "education";
  return automatic;
}

export function experimentCategory(name: string): ExperimentCategory {
  const text = name.toLowerCase();
  if (/微流控|微流体|液滴生成|液滴捕获|droplet|microfluid|lab.on.a.chip/.test(text)) return "microfluidic";
  if (/问卷|量表调查|问卷调查|survey|questionnaire/.test(text)) return "survey";
  if (/访谈|焦点小组|田野调查|口述史|interview|focus group|ethnograph/.test(text)) return "interview";
  if (/档案|史料|文献研读|文本分析|文献分析|话语分析|历史文献|archive|textual analysis|discourse analysis/.test(text)) return "archive";
  if (/实地观测|野外观测|现场观测|野外采样|实地测量|环境监测|field observation|field measurement|environmental monitoring/.test(text)) return "field";
  if (/医学影像|影像学|磁共振|核磁|超声|放射影像|病理切片|\bmri\b|\bct\b|radiolog|medical imaging/.test(text)) return "imaging";
  if (/动物|小鼠|大鼠|体内实验|体内模型|mouse|mice|murine|xenograft|animal/.test(text)) return "animal";
  if (/蛋白|免疫印迹|免疫组化|免疫荧光|蛋白质组|western\s*blot|\bwb\b|\belisa\b|proteom|protein|phosphorylation/.test(text)) return "protein";
  if (/代谢|糖酵解|脂质组|脂质|metabol|glycoly|lipid|\batp\b/.test(text)) return "metabolism";
  if (/敲除|敲低|过表达|基因|基因组|crispr|knockout|knockdown|sirna|\bqpcr\b|\bpcr\b|gene\b|genomic/.test(text)) return "gene";
  if (/燃料电池|太阳能电池|fuel cell|solar cell/.test(text)) return "materials";
  if (/单细胞|细胞|增殖|迁移|侵袭|凋亡|流式|cell|viability|\bcck.?8\b|transwell/.test(text)) return "cell";
  if (/基线|前测|baseline|pre.?test/.test(text)) return "baseline";
  if (/长期.{0,5}(追踪|随访)|纵向追踪|随访|longitudinal follow.?up|follow.?up/.test(text)) return "followup";
  if (/效果.{0,5}(验证|评估|评价)|结果.{0,5}(验证|评估|评价)|短期.{0,8}(评估|变化|影响)|学业成就后测|outcome assessment|effect evaluation|post.?test/.test(text)) return "outcome";
  if (/教学干预|教育干预|教学实验|课堂教学|课程改革|学业成就|学业与认知|teaching intervention|educational intervention|classroom instruction|academic achievement/.test(text)) return "education";
  if (/临床试验|临床研究|患者|病人|队列研究|病例对照|随机对照试验|clinical trial|clinical study|patient|cohort study/.test(text)) return "clinical";
  if (/数值模拟|仿真|计算模型|有限元|流体模拟|simulation|finite element|computational model/.test(text)) return "simulation";
  if (/软件|算法|程序开发|代码实现|机器学习|深度学习|神经网络|模型训练|software|algorithm|machine learning|deep learning|neural network/.test(text)) return "software";
  if (/材料|合金|陶瓷|薄膜|复合材料|电池|力学性能|material|alloy|ceramic|battery|tensile test/.test(text)) return "materials";
  if (/器件|电路|芯片|传感器|硬件|机械装置|原型机|传动|device|circuit|sensor|hardware|prototype/.test(text)) return "device";
  if (/化学反应|化学合成|化合物合成|化学实验|有机合成|催化反应|滴定|色谱|质谱|chemical reaction|chemical synthesis|organic synthesis|chromatograph|mass spectromet/.test(text)) return "chemistry";
  if (/数据库|公共数据|geo\b|tcga\b|database|dataset/.test(text)) return "database";
  if (/通路|富集|免疫浸润|pathway|gsea|kegg|\bgo\b/.test(text)) return "pathway";
  if (/样本|标本|预处理|sample/.test(text)) return "sample";
  if (/限制|约束|条件|constraint|limitation/.test(text)) return "constraint";
  if (/对照组|对照设置|阴性对照|阳性对照|control group|negative control|positive control/.test(text)) return "control";
  if (/显微|染色|成像|组织学|microscop|imaging/.test(text)) return "microscope";
  if (/分析|筛选|初筛|统计|预测|验证|评估|热图|火山图|测序|转录组|聚类|降维|整合|数据|pca|umap|tsne|analys|sequenc|rna.?seq|heatmap|volcano/.test(text)) return "analysis";
  if (/目标|假设|问题|goal|hypothesis/.test(text)) return "goal";
  return "generic";
}
