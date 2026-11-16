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

export const CATEGORY_IDS = EXPERIMENT_CATEGORIES.map((item) => item.id);

const BY_ID = new Map(EXPERIMENT_CATEGORIES.map((item) => [item.id, item]));

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
