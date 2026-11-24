"""Reviewed cards for exact example PDF editions. Pages are PDF page numbers."""

_MAPS = {
    # PMID 39875519, publisher PDF. Entries follow Figures 1–7.
    "33b3c6e8a45dafcc23cae30c9ba9e7d94c6bd858ca966bfe9ea0e7d46f964a28": (
        False, "从 SP1 对 YAP/TEAD 靶基因的调控出发，依次核对蛋白互作、功能验证和临床样本证据。",
        (
            ("SP1 对 YAP 靶基因的调控", "molecular_experiment", ("基因集富集分析", "qPCR", "报告基因检测"), "SP1 敲低影响保守 YAP 靶基因的表达。报告基因实验显示 SP1 正向调节 YAP/TAZ 活性。", (2, 3)),
            ("SP1 与 TEAD4 的结合位点", "data_analysis", ("ChIP-seq", "ChIP-qPCR"), "结合位点分析显示 SP1 与 TEAD4 在部分靶基因附近共占位，ChIP-qPCR 核对了代表性位点。", (3,)),
            ("SP1 与 YAP/TEAD4 蛋白互作", "molecular_experiment", ("免疫共沉淀", "邻近连接实验"), "两种方法均检测到内源 SP1 与 YAP、TAZ、TEAD4 的互作。", (4,)),
            ("PKCζ 对 SP1–TEAD4 互作的作用", "molecular_experiment", ("免疫共沉淀", "磷酸化位点比较", "报告基因检测"), "干预 PKCζ 减弱了血清刺激引起的互作。磷酸化位点突变也降低了报告基因活性。", (5, 6)),
            ("联合用药的体外活性", "cell_experiment", ("细胞活力检测", "克隆形成", "Western blot"), "作者在多个结直肠癌细胞系中观察到联合用药对生长的抑制，并检查了 PARP1 裂解。", (6, 7)),
            ("联合用药的模型验证", "animal_experiment", ("异种移植", "免疫组化", "患者来源类器官"), "异种移植瘤和两种患者来源类器官为联合处理的抑制作用提供了模型证据。", (6, 8)),
            ("VISTA 表达与启动子调控", "molecular_experiment", ("qPCR", "流式细胞术", "ChIP-qPCR", "启动子报告实验"), "敲低 YAP、TAZ 或 SP1 后，作者检测了 VISTA 表达变化，并用启动子报告实验检验调控位点。", (8,)),
            ("CD8⁺ T 细胞共培养验证", "cell_experiment", ("共培养", "流式细胞术", "VISTA 回补"), "作者测量肿瘤细胞凋亡及 T 细胞效应分子，并用 VISTA 回补检验功能关联。", (8,)),
            ("去糖基化与 VISTA 检测", "clinical_sample", ("Western blot", "免疫荧光", "免疫组化"), "去糖基化后，部分样本的 VISTA 可检出信号升高。", (9, 10)),
            ("临床样本中的表达与结局", "clinical_sample", ("组织芯片", "相关分析", "生存分析"), "队列分析对照了通路相关表达和生存结局，得到的是相关性证据。", (9, 11)),
        ),
    ),
    # PMID 35064256, PMC author manuscript.
    "5840af1d77b44b3257c5d303b98c4f4396757170a97e7feff91fb35676f48aa0": (
        True, "按肝发育、再生和纤维化整理综述引用的代表性实验。页码指向综述 PDF。",
        (
            ("部分肝切除与再生", "animal_experiment", ("α-catenin 敲低", "部分肝切除"), "引用研究发现，肝脏 α-catenin 敲低后，部分肝切除伴随 YAP 活化和肝细胞增殖增加。", (3,)),
            ("Lats1/2 缺失与肝细胞分化", "animal_experiment", ("条件性基因缺失", "谱系表型观察"), "引用研究在缺失模型中观察到未成熟胆管细胞积累，并将异常分化与 YAP–TGFβ 信号联系起来。", (6,)),
            ("Hedgehog–YAP 与肝再生", "animal_experiment", ("部分肝切除", "星状细胞信号干预"), "引用研究发现，抑制肝星状细胞的 Hedgehog 信号后，肝细胞核内 YAP 积累减少。", (8,)),
            ("胆管上皮与肝细胞的作用对照", "animal_experiment", ("细胞类型特异性缺失", "急性肝损伤"), "引用研究报告，胆管上皮细胞缺失 Yap/Taz 延迟再生，肝细胞特异性缺失在所述模型中的影响不同。", (8,)),
            ("慢性损伤的单细胞证据", "data_analysis", ("肝损伤模型", "单细胞 RNA 测序"), "综述引用的研究在损伤模型中观察到更多 YAP 活跃的胆管上皮细胞，肝细胞的 YAP 活性也升高。", (8, 9)),
            ("肝细胞 YAP/TAZ 与纤维化", "animal_experiment", ("慢性肝损伤", "纤维化表型比较"), "引用研究显示，肝细胞 YAP 活化加重纤维化，而 YAP/TAZ 缺失降低了同类模型的纤维化程度。", (9,)),
            ("脂肪性肝炎的 TAZ 证据", "clinical_sample", ("人组织样本", "小鼠模型"), "引用研究在人样本和小鼠模型中发现 TAZ 升高，并报告 TAZ 靶向信号与肝星状细胞激活相关。", (9,)),
            ("肝星状细胞的培养与干预", "cell_experiment", ("原代细胞培养", "二维与三维对照"), "引用研究中，维替泊芬抑制纤维化标志物上调，三维培养的肝星状细胞维持较静息的状态。", (10,)),
        ),
    ),
    # PMID 42008043, publisher PDF.
    "390051b17c17152fc7699d8c6b1a95deef9afb1be8512d747af3e43318cd691e": (
        True, "按器官和模型整理综述引用的代表性实验。页码指向综述 PDF。",
        (
            ("肺组织中的 YAP 活性线索", "clinical_sample", ("患者肺组织", "细胞标记共定位"), "综述汇总的 IPF 组织证据显示，呼吸上皮的 YAP 活性增强，并报告了核定位与肺泡细胞标记共现。", (10,)),
            ("肺纤维化动物模型", "animal_experiment", ("肺泡细胞特异性缺失", "纤维化模型"), "引用研究报告，持续的 YAP 活化加重模型中的肺纤维化。综述同时讨论了 TAZ 的不同作用。", (10,)),
            ("梗阻性肾纤维化的机制验证", "animal_experiment", ("单侧输尿管梗阻", "YAP 缺失比较"), "引用研究在梗阻模型中讨论机械信号与 YAP 入核。另一项干预研究报告 YAP 缺失抑制成纤维细胞激活。", (10,)),
            ("巩膜成纤维细胞的信号干预", "cell_experiment", ("成纤维细胞模型", "YAP 抑制"), "引用研究报告 TGF-β2–YAP/SMAD2/3 与纤维化表型相关，YAP 抑制减轻了所述变化。", (11,)),
            ("系统性硬化中的抗纤维化干预", "molecular_experiment", ("药理干预", "信号通路观察"), "综述引用两组研究，分别讨论直接抑制 YAP 和干扰 Akt1/GSK3β/TAZ/YAP 通路后的抗纤维化表现。", (11,)),
            ("肺成纤维细胞的 miR-15a 证据", "cell_experiment", ("肺成纤维细胞", "miRNA 表达干预"), "引用研究报告，miR-15a 表达增强后，YAP1/Twist 和纤维化相关蛋白的表达下降。", (11,)),
            ("YAP/TAZ 缺失与肺损伤表型", "animal_experiment", ("双基因缺失", "肺纤维化表型"), "所引研究在毒物暴露模型中观察到，YAP/TAZ 双缺失小鼠的肺纤维化程度较低。", (11,)),
            ("免疫细胞与成纤维细胞互作", "cell_experiment", ("巨噬细胞共培养", "纤维化标志物"), "引用研究在共培养中观察到纤维化相关信号增强，并报告 YAP 抑制减弱了该反应。", (11,)),
        ),
    ),
}


def prepared_experiments(paper, revision: str) -> dict | None:
    example = _MAPS.get(paper.sha256)
    if example is None:
        return None
    cited, summary, cards = example
    return {
        "paper_id": paper.id, "parse_revision": revision, "summary": summary,
        "generated_by": "prepared", "cited": cited,
        "experiments": [
            {
                "id": f"E{order}", "order": order, "title": title, "category": category,
                "methods": list(methods), "result": result, "inferred": False, "depends_on": [],
                "evidence": [{"page": page} for page in pages],
            }
            for order, (title, category, methods, result, pages) in enumerate(cards, 1)
        ],
    }
