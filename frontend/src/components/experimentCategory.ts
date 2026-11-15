// Illustrations describe the main research activity, not an observed result.
export type ExperimentCategory = "bioinformatics" | "cell" | "animal" | "molecular" | "histology" | "sample" | "microbiology" | "pharmacology" | "metabolism" | "sequencing" | "vesicle" | "biochemical" | "microscopy" | "clinical" | "imaging" | "microfluidic" | "analysis" | "control" | "goal" | "constraint" | "baseline" | "outcome" | "followup" | "generic";

export const BIO_CATEGORY_OPTIONS: ReadonlyArray<readonly [ExperimentCategory, string]> = [
  ["bioinformatics", "生信与数据分析"], ["cell", "细胞实验"], ["animal", "动物实验"], ["molecular", "分子检测"],
  ["histology", "组织病理"], ["sample", "临床与样本"], ["microbiology", "微生物实验"], ["pharmacology", "药物研究"], ["metabolism", "代谢检测"],
  ["sequencing", "测序实验"], ["vesicle", "细胞外囊泡"], ["biochemical", "生化检测"], ["microscopy", "显微成像"],
];
export const CATEGORY_OPTIONS: ReadonlyArray<readonly [ExperimentCategory, string]> = [
  ...BIO_CATEGORY_OPTIONS, ["clinical", "临床研究"], ["imaging", "医学影像"], ["microfluidic", "微流控"], ["analysis", "统计分析"],
  ["control", "对照设置"], ["goal", "研究目标"], ["constraint", "研究限制"], ["baseline", "基线评估"],
  ["outcome", "效果评估"], ["followup", "长期随访"], ["generic", "通用图形"],
];

// Specific analyses precede study models; animal and cell experiments precede
// the molecular target manipulated within them. Names without evidence of a
// category use a generic image rather than an unrelated discipline's icon.
export function biologicalCategory(name: string): ExperimentCategory | null {
  const text = name.toLowerCase();
  if (/\b(fuel|solar) cells?\b|燃料电池|太阳能电池/.test(text)) return null;
  if (/代谢流追踪|代谢流示踪|同位素示踪|稳定同位素示踪|metabolic flux tracing|isotope tracing/.test(text)) return "metabolism";
  if (/公共.{0,8}(数据集|数据挖掘)|公共.{0,8}数据.{0,8}(挖掘|分析)|组学.{0,12}(整合|联合|数据|分析)|组学与.{0,12}(整合|联合|数据|分析)|空间转录组.{0,12}(分析|数据|聚类)|16s.{0,12}(分析|数据|多样性)|rna.?seq.{0,20}(analysis|data)|single.cell.{0,20}(data|annotation)|proteomic.{0,15}(analysis|data)|multi.omics.{0,15}(analysis|integration)/.test(text)) return "bioinformatics";
  if (/差异基因|差异表达|差异分析|生信|生物信息|数据库|免疫浸润|富集分析|通路分析|基因集富集|go富集|蛋白互作网络|ppi网络|网络药理学|生存分析|预后模型|热图|火山图|单细胞.{0,12}(分析|聚类|注释|数据)|转录组.{0,12}(分析|数据)|测序数据.{0,8}(分析|处理)|\bgeo\b|\btcga\b|\bgsea\b|\bkegg\b|\bdeg\b|\bumap\b|\bpca\b|bioinformatic|differential expression|single.cell.{0,15}(analysis|clustering)|enrichment analysis|heatmap|volcano plot/.test(text)) return "bioinformatics";
  if (/微流控|微流体|液滴生成|液滴捕获|droplet|microfluid|lab.on.a.chip/.test(text)) return "microfluidic";
  if (/动物|小鼠|大鼠|裸鼠|斑马鱼|体内实验|体内模型|移植瘤|成瘤|mouse|mice|murine|animal|xenograft|zebrafish/.test(text)) return "animal";
  if (/细菌培养|细菌生长|微生物培养|微生物鉴定|真菌培养|菌株培养|菌落计数|病毒感染|病毒滴度|噬菌体|细菌.{0,6}药敏|酵母培养|bacterial culture|microbial culture|fungal culture|colony count|viral infection|viral titer/.test(text)) return "microbiology";
  if (/外泌体|细胞外囊泡|胞外囊泡|exosome|extracellular vesicle/.test(text)) return "vesicle";
  if (/单细胞.{0,8}测序|高通量测序|转录组测序|空间转录组测序|rna测序|建库测序|全基因组测序|宏基因组测序|测序建库|测序实验|single.cell.{0,10}sequencing|whole.genome sequencing|library preparation|rna.?seq/.test(text)) return "sequencing";
  if (/细胞|共培养|条件培养基|培养基转移|培养上清|上清液转移|类器官|免疫细胞|流式|增殖|迁移|侵袭|凋亡|划痕实验|集落形成|克隆形成|细胞毒|\bedu\b|\btunel\b|\bcell(?:s|ular)?\b|conditioned medium|conditioned media|culture supernatant|organoid|coculture|co.culture|\bcck.?8\b|transwell|flow cytometry|wound.healing assay/.test(text)) return "cell";
  if (/组织切片|组织病理|病理切片|组织染色|免疫组化|免疫组织化学|苏木精|伊红|\bihc\b|\bh\s*&\s*e\b|\bhe染色|histolog|histopatholog|immunohistochem/.test(text)) return "histology";
  if (/药物筛选|药效评价|药代动力学|药物相互作用|药物毒性|pharmacokinetic|drug screening|drug efficacy|drug toxicity/.test(text)) return "pharmacology";
  if (/临床样本|患者样本|组织样本|血液样本|样本处理|样本收集|标本|clinical sample|patient sample|specimen/.test(text)) return "sample";
  if (/蛋白|免疫印迹|免疫荧光|免疫共沉淀|染色质免疫沉淀|基因敲除|基因敲低|基因过表达|基因沉默|基因转染|western\s*blot|\belisa\b|\bqpcr\b|\bpcr\b|\bcrispr\b|\bsirna\b|\bshrna\b|\bco.?ip\b|\bchip.?qpcr\b|protein|knockout|knockdown|immunoprecipitation/.test(text)) return "molecular";
  if (/代谢|糖酵解|脂质组|脂质|metabol|glycoly|lipid|\batp\b/.test(text)) return "metabolism";
  if (/生化检测|生化指标|酶活|酶活性|生化测定|酶活测定|biochemical assay|enzyme activity/.test(text)) return "biochemical";
  if (/显微镜|显微成像|共聚焦成像|荧光成像|microscop|confocal imaging/.test(text)) return "microscopy";
  return null;
}

// Retain known historical overrides without keeping non-biological icons.
const LEGACY: Readonly<Record<string, ExperimentCategory>> = {
  database: "bioinformatics", pathway: "bioinformatics", gene: "molecular", protein: "molecular", microscope: "histology",
};
export function effectiveCategory(name: string, override?: string | null, _goal = ""): ExperimentCategory {
  const identified = biologicalCategory(name);
  if (identified) return identified;
  if (override) {
    const mapped = LEGACY[override] ?? CATEGORY_OPTIONS.find(([key]) => key === override)?.[0];
    if (mapped) return mapped;
  }
  return experimentCategory(name);
}
export function experimentCategory(name: string): ExperimentCategory {
  const text = name.toLowerCase();
  if (/微流控|微流体|液滴生成|液滴捕获|droplet|microfluid|lab.on.a.chip/.test(text)) return "microfluidic";
  if (/医学影像|影像学|磁共振|核磁|超声|放射影像|\bmri\b|\bct\b|radiolog|medical imaging/.test(text)) return "imaging";
  if (/临床试验|临床研究|患者|病人|队列研究|病例对照|随机对照试验|clinical trial|clinical study|patient|cohort study/.test(text)) return "clinical";
  if (/样本|标本|预处理|sample/.test(text)) return "sample";
  if (/基线|前测|baseline|pre.?test/.test(text)) return "baseline";
  if (/长期.{0,5}(追踪|随访)|纵向追踪|随访|longitudinal follow.?up|follow.?up/.test(text)) return "followup";
  if (/效果.{0,5}(验证|评估|评价)|结果.{0,5}(验证|评估|评价)|outcome assessment|effect evaluation/.test(text)) return "outcome";
  if (/限制|约束|实施条件|可行性条件|constraint|limitation/.test(text)) return "constraint";
  if (/对照组|对照设置|阴性对照|阳性对照|control group|negative control|positive control/.test(text)) return "control";
  if (/分析|筛选|统计|预测|验证|评估|聚类|降维|数据|analys/.test(text)) return "analysis";
  if (/目标|假设|问题|goal|hypothesis/.test(text)) return "goal";
  return "generic";
}
