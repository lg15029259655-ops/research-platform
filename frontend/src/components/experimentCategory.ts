// Classification is based on the experiment's own name, never a conditional
// example from the description. More specific techniques precede broad terms.
export type ExperimentCategory = "bioinformatics" | "molecular" | "histology" | "database" | "cell" | "animal" | "analysis" | "protein" | "metabolism" | "gene" | "microfluidic" | "pathway" | "sample" | "constraint" | "control" | "goal" | "microscope" | "clinical" | "imaging" | "materials" | "device" | "survey" | "interview" | "archive" | "simulation" | "chemistry" | "software" | "education" | "field" | "baseline" | "outcome" | "followup" | "pharmacology" | "microbiology" | "fabrication" | "physics" | "ecology" | "policy" | "economics" | "mathematics" | "generic";

export const BIO_CATEGORY_OPTIONS: ReadonlyArray<readonly [ExperimentCategory, string]> = [
  ["bioinformatics", "生信与数据分析"], ["cell", "细胞实验"], ["animal", "动物实验"], ["molecular", "分子检测"],
  ["histology", "组织病理"], ["sample", "临床与样本"], ["microbiology", "微生物实验"], ["pharmacology", "药物研究"], ["metabolism", "代谢检测"],
];

export const CATEGORY_OPTIONS: ReadonlyArray<readonly [ExperimentCategory, string]> = [
  ["bioinformatics", "生信与数据分析"], ["molecular", "分子检测"], ["histology", "组织病理"],
  ["cell", "细胞实验"], ["protein", "蛋白检测"], ["gene", "基因操作"], ["metabolism", "代谢研究"],
  ["animal", "动物实验"], ["clinical", "临床研究"], ["imaging", "医学影像"], ["microfluidic", "微流控"],
  ["database", "数据来源"], ["analysis", "数据分析"], ["materials", "材料与性能"], ["device", "工程器件"],
  ["simulation", "仿真建模"], ["survey", "问卷调查"], ["interview", "访谈与田野"], ["archive", "文本与档案"],
  ["chemistry", "化学实验"], ["software", "软件与算法"], ["education", "教育与干预"], ["field", "实地观测"],
  ["baseline", "基线评估"], ["outcome", "效果评估"], ["followup", "长期追踪"],
  ["pharmacology", "药物研究"], ["microbiology", "微生物实验"], ["fabrication", "工程制造"], ["physics", "物理测量"],
  ["ecology", "生态研究"], ["policy", "政策与法律"], ["economics", "经济与金融"], ["mathematics", "数学推导"],
  ["pathway", "通路分析"], ["sample", "样本处理"], ["microscope", "显微与成像"], ["control", "对照设置"],
  ["goal", "研究目标"], ["constraint", "研究限制"], ["generic", "通用图形"],
];

// Group by the activity itself. A named computational analysis takes precedence
// over the model mentioned; animal and cell experiments take precedence over
// the molecular target manipulated inside that experiment.
export function biologicalCategory(name: string): ExperimentCategory | null {
  const text = name.toLowerCase();
  if (/差异基因|差异表达|差异分析|生信|生物信息|数据库|免疫浸润|富集分析|通路分析|基因集富集|go富集|蛋白互作网络|ppi网络|网络药理学|生存分析|预后模型|热图|火山图|单细胞.{0,12}(分析|聚类|注释|数据)|转录组.{0,12}(分析|数据)|测序数据.{0,8}(分析|处理)|\bgeo\b|\btcga\b|\bgsea\b|\bkegg\b|\bdeg\b|\bumap\b|\bpca\b|bioinformatic|differential expression|single.cell.{0,15}(analysis|clustering)|enrichment analysis|heatmap|volcano plot/.test(text)) return "bioinformatics";
  if (/动物|小鼠|大鼠|裸鼠|斑马鱼|体内实验|体内模型|移植瘤|成瘤|mouse|mice|murine|animal|xenograft/.test(text)) return "animal";
  if (/细菌培养|细菌生长|微生物培养|微生物鉴定|真菌培养|菌株培养|菌落计数|bacterial culture|microbial culture|fungal culture|colony count/.test(text)) return "microbiology";
  if (/细胞|共培养|免疫细胞|流式|增殖|迁移|侵袭|凋亡|划痕实验|集落形成|克隆形成|\bcell(?:s|ular)?\b|coculture|co.culture|\bcck.?8\b|transwell|flow cytometry/.test(text)) return "cell";
  if (/组织切片|组织病理|病理切片|组织染色|苏木精|伊红|\bh\s*&\s*e\b|\bhe染色|histolog|histopatholog/.test(text)) return "histology";
  if (/药物筛选|药效评价|药代动力学|药物相互作用|药物毒性|pharmacokinetic|drug screening|drug efficacy|drug toxicity/.test(text)) return "pharmacology";
  if (/临床样本|患者样本|组织样本|血液样本|样本处理|样本收集|标本|clinical sample|patient sample|specimen/.test(text)) return "sample";
  if (/蛋白|免疫印迹|免疫组化|免疫荧光|基因敲除|基因敲低|基因过表达|转录组测序|rna测序|western\s*blot|\belisa\b|\bqpcr\b|\bpcr\b|\bcrispr\b|protein|knockout|knockdown|rna.?seq/.test(text)) return "molecular";
  return null;
}

export function effectiveCategory(name: string, override?: string | null, goal = ""): ExperimentCategory {
  const selected = CATEGORY_OPTIONS.find(([key]) => key === override)?.[0];
  if (selected) return selected;
  const biological = biologicalCategory(name);
  if (biological) return biological;
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
  if (/细菌培养|细菌生长|微生物培养|微生物鉴定|真菌培养|菌株培养|菌落计数|bacterial culture|microbial culture|fungal culture|colony count/.test(text)) return "microbiology";
  if (/政策评估|政策分析|法律分析|法规分析|法条|司法判例|policy analysis|policy evaluation|legal analysis|case law/.test(text)) return "policy";
  if (/经济模型|经济增长|市场均衡|金融风险|投资组合|经济计量|economic model|economic growth|financial risk|econometric/.test(text)) return "economics";
  if (/数学证明|定理证明|数学推导|形式化证明|mathematical proof|theorem proof|formal proof/.test(text)) return "mathematics";
  if (/实地观测|野外观测|现场观测|野外采样|实地测量|环境监测|field observation|field measurement|environmental monitoring/.test(text)) return "field";
  if (/生态系统|生物多样性|物种多样性|群落生态|生态修复|ecological restoration|ecosystem|biodiversity/.test(text)) return "ecology";
  if (/医学影像|影像学|磁共振|核磁|超声|放射影像|病理切片|\bmri\b|\bct\b|radiolog|medical imaging/.test(text)) return "imaging";
  if (/动物|小鼠|大鼠|体内实验|体内模型|mouse|mice|murine|xenograft|animal/.test(text)) return "animal";
  if (/蛋白|免疫印迹|免疫组化|免疫荧光|蛋白质组|western\s*blot|\bwb\b|\belisa\b|proteom|protein|phosphorylation/.test(text)) return "protein";
  if (/代谢|糖酵解|脂质组|脂质|metabol|glycoly|lipid|\batp\b/.test(text)) return "metabolism";
  if (/敲除|敲低|过表达|基因|基因组|crispr|knockout|knockdown|sirna|\bqpcr\b|\bpcr\b|gene\b|genomic/.test(text)) return "gene";
  if (/燃料电池|太阳能电池|fuel cell|solar cell/.test(text)) return "materials";
  if (/单细胞|细胞|增殖|迁移|侵袭|凋亡|流式|\bcell(?:s|ular)?\b|viability|\bcck.?8\b|transwell/.test(text)) return "cell";
  if (/基线|前测|baseline|pre.?test/.test(text)) return "baseline";
  if (/长期.{0,5}(追踪|随访)|纵向追踪|随访|longitudinal follow.?up|follow.?up/.test(text)) return "followup";
  if (/效果.{0,5}(验证|评估|评价)|结果.{0,5}(验证|评估|评价)|短期.{0,8}(评估|变化|影响)|学业成就后测|outcome assessment|effect evaluation|post.?test/.test(text)) return "outcome";
  if (/教学干预|教育干预|教学实验|课堂教学|课程改革|学业成就|学业与认知|teaching intervention|educational intervention|classroom instruction|academic achievement/.test(text)) return "education";
  if (/临床试验|临床研究|患者|病人|队列研究|病例对照|随机对照试验|clinical trial|clinical study|patient|cohort study/.test(text)) return "clinical";
  if (/药物筛选|药效评价|药代动力学|药物相互作用|药物毒性|pharmacokinetic|drug screening|drug efficacy|drug toxicity/.test(text)) return "pharmacology";
  if (/数值模拟|仿真|计算模型|有限元|流体模拟|simulation|finite element|computational model/.test(text)) return "simulation";
  if (/机械加工|数控加工|增材制造|3d打印|焊接工艺|精密制造|cnc machining|additive manufacturing|3d printing/.test(text)) return "fabrication";
  if (/光谱测量|光学测量|激光测量|物理测量|粒子探测|光学实验|optical measurement|laser measurement|particle detection|optical experiment/.test(text)) return "physics";
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
