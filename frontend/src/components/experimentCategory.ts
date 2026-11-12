// Classification is based on the experiment's own name, never a conditional
// example from the description. More specific techniques precede broad terms.
export type ExperimentCategory = "database" | "cell" | "animal" | "analysis" | "protein" | "metabolism" | "gene" | "microfluidic" | "pathway" | "sample" | "constraint" | "control" | "goal" | "microscope" | "generic";

export function experimentCategory(name: string): ExperimentCategory {
  const text = name.toLowerCase();
  if (/微流控|微流体|液滴生成|液滴捕获|droplet|microfluid|lab.on.a.chip/.test(text)) return "microfluidic";
  if (/动物|小鼠|大鼠|体内实验|体内模型|mouse|mice|murine|xenograft|animal/.test(text)) return "animal";
  if (/蛋白|免疫印迹|免疫组化|免疫荧光|蛋白质组|western\s*blot|\bwb\b|\belisa\b|proteom|protein|phosphorylation/.test(text)) return "protein";
  if (/代谢|糖酵解|脂质组|脂质|metabol|glycoly|lipid|\batp\b/.test(text)) return "metabolism";
  if (/敲除|敲低|过表达|基因|基因组|crispr|knockout|knockdown|sirna|\bqpcr\b|\bpcr\b|gene\b|genomic/.test(text)) return "gene";
  if (/单细胞|细胞|增殖|迁移|侵袭|凋亡|流式|cell|viability|\bcck.?8\b|transwell/.test(text)) return "cell";
  if (/数据库|公共数据|geo\b|tcga\b|database|dataset/.test(text)) return "database";
  if (/通路|富集|免疫浸润|pathway|gsea|kegg|\bgo\b/.test(text)) return "pathway";
  if (/样本|标本|预处理|sample/.test(text)) return "sample";
  if (/限制|约束|条件|constraint|limitation/.test(text)) return "constraint";
  if (/对照|control/.test(text)) return "control";
  if (/显微|染色|成像|组织学|microscop|imaging/.test(text)) return "microscope";
  if (/分析|筛选|初筛|统计|预测|验证|评估|热图|火山图|测序|转录组|聚类|降维|整合|数据|pca|umap|tsne|analys|sequenc|rna.?seq|heatmap|volcano/.test(text)) return "analysis";
  if (/目标|假设|问题|goal|hypothesis/.test(text)) return "goal";
  return "generic";
}
