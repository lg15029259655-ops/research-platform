/**
 * 实验流程图的"粗分类"清单。
 *
 * 为什么要粗分类：细胞实验、动物实验下面能列出几十种具体实验，但比赛展示不需要
 * 一实验一图标。同类实验共用一个图标，文字各自不同——工作量降下来，视觉仍然统一。
 * 图片由使用者自己生成并放到 `public/icons/experiments/<id>.png`，代码只留空位。
 */

export type ExperimentCategory = {
  id: string;
  /** 展示名（节点标题旁的文字标签用） */
  name: string;
  /** 占位框里的短标签（空间很小时用） */
  short: string;
  /** 这一类包含哪些具体实验（给 AI 与清单用，不直接展示） */
  includes: string[];
  /** 用于从设计节点/实验步骤文字里推断类别的关键词 */
  keywords: string[];
  /** P0 = 优先生成（覆盖大多数演示），P1 = 有余力再做 */
  priority: "P0" | "P1";
};

export const ICON_DIR = "/icons/experiments";

export const EXPERIMENT_CATEGORIES: ExperimentCategory[] = [
  {
    id: "data_analysis",
    name: "数据分析 · 生信",
    short: "数据分析",
    includes: ["数据库筛选", "差异表达分析", "富集分析", "免疫浸润分析", "单细胞分析", "WGCNA", "预后模型"],
    keywords: ["数据库", "生信", "生物信息", "差异表达", "差异基因", "表达谱", "富集", "免疫浸润", "单细胞", "转录组", "WGCNA", "预后", "GEO", "TCGA", "测序"],
    priority: "P0",
  },
  {
    id: "cell_experiment",
    name: "细胞实验",
    short: "细胞",
    includes: ["细胞培养", "传代", "共培养", "敲低/敲除", "过表达", "增殖", "凋亡", "迁移/侵袭", "克隆形成", "免疫荧光", "转染"],
    keywords: ["细胞", "培养", "传代", "共培养", "敲低", "敲除", "过表达", "增殖", "凋亡", "迁移", "侵袭", "克隆", "转染", "CCK", "流式"],
    priority: "P0",
  },
  {
    id: "animal_experiment",
    name: "动物实验",
    short: "动物",
    includes: ["模型构建", "分组对照", "给药", "活体成像", "取材", "组织切片", "生存分析", "裸鼠成瘤"],
    keywords: ["动物", "小鼠", "大鼠", "裸鼠", "模型构建", "造模", "给药", "取材", "切片", "生存分析", "成瘤"],
    priority: "P0",
  },
  {
    id: "molecular_experiment",
    name: "分子实验",
    short: "分子",
    includes: ["Western blot", "qPCR", "ELISA", "Co-IP", "ChIP", "免疫组化", "质谱"],
    keywords: ["WB", "Western", "qPCR", "PCR", "ELISA", "Co-IP", "ChIP", "免疫组化", "IHC", "质谱", "蛋白表达"],
    priority: "P0",
  },
  {
    id: "clinical_sample",
    name: "临床样本",
    short: "临床",
    includes: ["组织芯片", "病例队列", "随访", "病理评分", "伦理审批"],
    keywords: ["临床", "患者", "病例", "组织芯片", "队列", "随访", "病理", "伦理", "血清样本"],
    priority: "P0",
  },
  {
    id: "imaging",
    name: "影像 / 显微",
    short: "影像",
    includes: ["共聚焦", "电镜", "活细胞成像", "MRI/CT/PET"],
    keywords: ["影像", "共聚焦", "电镜", "显微", "MRI", "CT", "PET", "活体成像"],
    priority: "P1",
  },
  {
    id: "materials_prep",
    name: "材料制备",
    short: "材料",
    includes: ["合成", "制备", "SEM/XRD 表征", "性能与稳定性测试"],
    keywords: ["材料", "合成", "制备", "表征", "SEM", "XRD", "稳定性", "电极", "催化"],
    priority: "P1",
  },
  {
    id: "engineering_test",
    name: "工程 / 仿真",
    short: "工程",
    includes: ["有限元仿真", "样机", "台架测试", "可靠性", "部署验证"],
    keywords: ["仿真", "有限元", "样机", "台架", "可靠性", "部署", "工程", "传感器"],
    priority: "P1",
  },
  {
    id: "modeling_algorithm",
    name: "建模 / 算法",
    short: "建模",
    includes: ["模型构建", "基线对照", "消融实验", "基准测试", "泛化评估"],
    keywords: ["算法", "模型", "训练", "基线", "消融", "基准", "泛化", "神经网络", "评价指标"],
    priority: "P1",
  },
  {
    id: "survey_statistics",
    name: "问卷 / 统计",
    short: "统计",
    includes: ["量表设计", "抽样", "回归模型", "政策数据分析"],
    keywords: ["问卷", "量表", "抽样", "回归", "统计", "政策", "调查"],
    priority: "P1",
  },
  {
    id: "result_conclusion",
    name: "结论 / 验证",
    short: "结论",
    includes: ["假设验证", "结果整合", "边界与外推", "下一步计划"],
    keywords: ["结论", "验证", "整合", "假设", "外推", "边界", "下一步"],
    priority: "P1",
  },
];

// Only specific, recognizable methods override a broad saved workflow category.
export const METHOD_CATEGORIES: ExperimentCategory[] = [
  { id: "western_blot", name: "蛋白印迹", short: "WB", includes: ["Western blot", "蛋白印迹"], keywords: [], priority: "P1" },
  { id: "pcr_assay", name: "PCR 检测", short: "PCR", includes: ["PCR", "qPCR", "RT-PCR"], keywords: [], priority: "P1" },
  { id: "transwell_assay", name: "Transwell 实验", short: "迁移", includes: ["Transwell", "迁移侵袭"], keywords: [], priority: "P1" },
  { id: "flow_cytometry", name: "流式细胞术", short: "流式", includes: ["flow cytometry", "流式细胞术"], keywords: [], priority: "P1" },
  { id: "gene_perturbation", name: "基因扰动研究", short: "基因扰动", includes: ["基因敲低", "基因缺失"], keywords: [], priority: "P1" },
  { id: "immune_interaction", name: "免疫细胞相互作用", short: "细胞互作", includes: ["细胞间调控", "免疫细胞互作"], keywords: [], priority: "P1" },
  { id: "expression_analysis", name: "表达谱分析", short: "表达分析", includes: ["表达谱分析", "表达定位分析"], keywords: [], priority: "P1" },
  { id: "sequencing_lab", name: "测序实验", short: "测序", includes: ["测序建库", "RNA测序"], keywords: [], priority: "P1" },
  { id: "vesicle_lab", name: "细胞外囊泡", short: "囊泡", includes: ["外泌体", "细胞外囊泡"], keywords: [], priority: "P1" },
  { id: "histology_lab", name: "组织病理", short: "病理", includes: ["HE染色", "组织病理"], keywords: [], priority: "P1" },
  { id: "microbiology_lab", name: "微生物实验", short: "微生物", includes: ["细菌培养", "病毒滴度"], keywords: [], priority: "P1" },
  { id: "metabolism_lab", name: "代谢检测", short: "代谢", includes: ["代谢流追踪", "糖酵解"], keywords: [], priority: "P1" },
  { id: "elisa_assay", name: "ELISA 检测", short: "ELISA", includes: ["ELISA", "酶联免疫吸附"], keywords: [], priority: "P1" },
  { id: "ihc_assay", name: "免疫组化", short: "IHC", includes: ["免疫组化", "IHC"], keywords: [], priority: "P1" },
  { id: "cell_proliferation", name: "细胞增殖检测", short: "增殖", includes: ["CCK-8", "EdU"], keywords: [], priority: "P1" },
  { id: "immunofluorescence", name: "免疫荧光", short: "免疫荧光", includes: ["免疫荧光", "immunofluorescence"], keywords: [], priority: "P1" },
];
// Stage illustrations describe the stage title itself, never inferred from the stage number.
export function stageIllustrationCategory(text: string | null | undefined): string | null {
  const value = (text || "").toLowerCase();
  if (/细胞.{0,20}(?:对|与).{0,20}细胞.{0,15}(?:调控|互作|相互作用|功能)|细胞间(?:互作|通讯|调控)|immune cell (?:interaction|communication)/.test(value)) return "immune_interaction";
  if (/(?:缺失|敲低|敲除|沉默|过表达).{0,20}(?:影响|表型|作用|通路)|gene (?:knockdown|knockout)/.test(value)) return "gene_perturbation";
  if (/表达谱.{0,15}(?:分析|定位)|表达.{0,8}定位.{0,8}分析|expression profil/.test(value)) return "expression_analysis";
  return null;
}

export function specificMethodCategory(text: string | null | undefined): string | null {
  const value = (text || "").toLowerCase();
  if (/测序数据.{0,8}(分析|处理)|(?:rna.?seq|sequencing).{0,12}(?:data|analysis)/.test(value)) return null;
  if (/外泌体|细胞外囊泡|胞外囊泡|exosome|extracellular vesicle/.test(value)) return "vesicle_lab";
  if (/单细胞.{0,8}测序|rna测序|测序建库|全基因组测序|高通量测序|rna.?seq|sequencing library/.test(value)) return "sequencing_lab";
  if (/细菌培养|菌落计数|病毒滴度|bacterial culture|viral titer/.test(value)) return "microbiology_lab";
  if (/代谢流追踪|同位素示踪|糖酵解检测|metabolic flux tracing/.test(value)) return "metabolism_lab";
  if (/\belisa\b|酶联免疫吸附/.test(value)) return "elisa_assay";
  if (/免疫组织化学|免疫组化|\bihc\b|immunohistochem/.test(value)) return "ihc_assay";
  if (/组织病理|病理切片|组织切片|\bhe\s*染色|h\s*&\s*e|histopatholog/.test(value)) return "histology_lab";
  if (/\bcck[ -]?8\b|\bedu\b|细胞增殖检测|细胞增殖实验/.test(value)) return "cell_proliferation";
  if (/免疫荧光|immunofluorescen/.test(value)) return "immunofluorescence";
  if (/western\s*blot|蛋白印迹|免疫印迹|\bwb\b/.test(value)) return "western_blot";
  if (/\b(?:rt[- ]?)?q?pcr\b|聚合酶链式反应/.test(value)) return "pcr_assay";
  if (/transwell|迁移侵袭|侵袭迁移/.test(value)) return "transwell_assay";
  if (/flow\s+cytometry|流式细胞|流式检测|流式分析/.test(value)) return "flow_cytometry";
  return null;
}

export const CATEGORY_IDS = EXPERIMENT_CATEGORIES.map((item) => item.id);

const BY_ID = new Map([...EXPERIMENT_CATEGORIES, ...METHOD_CATEGORIES].map((item) => [item.id, item]));

export function categoryById(id: string | null | undefined): ExperimentCategory | null {
  if (!id) return null;
  return BY_ID.get(id) || null;
}

/** 图片位置约定：用户把生成的图片按 id 命名放进 public/icons/experiments/ 即可。 */
export function iconUrl(categoryId: string): string {
  return `${ICON_DIR}/${categoryId}.png`;
}

/** 从任意中文描述里推断所属的粗分类（用于设计沙盘节点自动挂图标）。 */
export function detectCategory(text: string | null | undefined): string | null {
  const content = (text || "").toLowerCase();
  if (!content.trim()) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const category of EXPERIMENT_CATEGORIES) {
    let score = 0;
    for (const keyword of category.keywords) {
      if (content.includes(keyword.toLowerCase())) score += keyword.length >= 3 ? 2 : 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = category.id;
    }
  }
  return bestScore > 0 ? best : null;
}
