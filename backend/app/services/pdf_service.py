import re
from dataclasses import dataclass
from pathlib import Path
from collections.abc import Callable

import pymupdf as fitz


HEADINGS = (
    ("ABSTRACT", re.compile(r"^(abstract|summary|摘要)$", re.I)),
    ("INTRODUCTION", re.compile(r"^(\d+(?:\.\d+)*\.?\s*)?(introduction|background|related work|literature review|引言|背景|相关工作|文献综述)$", re.I)),
    ("METHODS", re.compile(r"^(\d+(?:\.\d+)*\.?\s*)?(materials?\s*(and|&)\s*methods?|methods?|methodology|approach|proposed method|experimental setup|experimental design|study design|data and methods|patients?\s*(and|&)\s*methods?|experimental procedures|model architecture|training|方法|材料与方法|研究设计|模型与方法)$", re.I)),
    ("RESULTS", re.compile(r"^(\d+(?:\.\d+)*\.?\s*)?(results?|findings?|experiments?|evaluation|performance|outcomes?|empirical results|结果|实验结果|性能评估|实证结果)$", re.I)),
    ("DISCUSSION", re.compile(r"^(\d+(?:\.\d+)*\.?\s*)?(discussion|analysis|limitations?|implications|讨论|局限性|分析)$", re.I)),
    ("CONCLUSION", re.compile(r"^(\d+(?:\.\d+)*\.?\s*)?(conclusions?|concluding remarks|future work|结论|总结与展望)$", re.I)),
)
FIGURE = re.compile(r"^(?:Fig(?:ure)?\.?|图)\s*([0-9]+[A-Za-z]?)\s*[.:：-]\s*(.+)", re.I)
TABLE = re.compile(r"^Table\s*([0-9]+[A-Za-z]?)\s*[.:：-]\s*(.+)", re.I)
SUPPLEMENT = re.compile(r"^(?:supplementary|supplemental)(?: information| materials?| data)?$|^supporting information$", re.I)
RESULT_SUBHEADING = re.compile(r"^(?:\d+(?:\.\d+)+\s+.{3,80}|(?:primary|secondary|exploratory)\s+(?:outcomes?|endpoints?|analys[ie]s)|baseline characteristics|safety|efficacy|patient characteristics)$", re.I)
TITLE_NOISE = re.compile(r"copyright|provided proper attribution|permission to|journalistic|scholarly works|^arxiv:|^doi:|https?://|@|^\d+(?:st|nd|rd|th) conference|^HHS Public Access$|^Author Manuscript$|^Published in final edited form", re.I)
RUNNING_HEADERS = re.compile(r"^(HHS Public Access|Author Manuscript|Published in final edited form as:?)$", re.I)


@dataclass
class ParsedUnit:
    kind: str
    heading: str
    text: str
    page_start: int | None
    page_end: int | None


@dataclass
class ParsedPDF:
    title: str
    page_count: int
    units: list[ParsedUnit]
    warning: str | None = None


def classify_heading(line: str) -> str | None:
    candidate = line.strip().rstrip(":：").strip()
    if len(candidate) > 90:
        return None
    for kind, pattern in HEADINGS:
        if pattern.fullmatch(candidate):
            return kind
    return None


def extract_title(page) -> str | None:
    candidates: list[tuple[float, float, str]] = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            words = "".join(span["text"] for span in line["spans"]).strip()
            if not 8 <= len(words) <= 240 or classify_heading(words) or TITLE_NOISE.search(words):
                continue
            if line["bbox"][1] > page.rect.height * 0.58:
                continue
            size = max(span["size"] for span in line["spans"])
            candidates.append((size, line["bbox"][1], words))
    if not candidates:
        return None
    largest = max(item[0] for item in candidates)
    prominent = [item for item in candidates if item[0] >= largest - 0.5]
    prominent.sort(key=lambda item: item[1])
    first = prominent[0]
    title_lines = [first[2]]
    previous_y = first[1]
    for _, y, words in prominent[1:]:
        if 0 < y - previous_y < 36 and sum(map(len, title_lines)) + len(words) < 240:
            title_lines.append(words)
            previous_y = y
    return " ".join(title_lines)


def extract_unlabeled_abstract(page) -> str | None:
    """Recognize a publisher abstract block only when its citation marker is clear.

    Some journals omit an 'Abstract' heading. A long first-page block ending in
    the article DOI is a useful signal; ordinary introductory prose is not.
    """
    for block in page.get_text("blocks"):
        if len(block) < 5 or not isinstance(block[4], str):
            continue
        content = block[4].strip()
        if (500 <= len(content) <= 3500 and
                page.rect.height * .3 <= block[1] <= page.rect.height * .68 and
                block[3] <= page.rect.height * .76 and
                len(re.findall(r"[.!?。！？]", content)) >= 4 and
                re.search(r"https?://doi\.org/10\.\d{4,9}/", content, re.I)):
            return content
    return None


def result_text_units(section: ParsedUnit, page_groups: dict[int, list[str]] | None = None) -> list[ParsedUnit]:
    lines = section.text.splitlines()
    page_ends: list[tuple[int, int]] = []
    total = 0
    for page, page_lines in (page_groups or {}).items():
        total += sum(len(line) + 1 for line in page_lines)
        page_ends.append((total, page))

    def page_at(offset: int) -> int | None:
        return next((page for end, page in page_ends if offset < end), section.page_end)

    def span(start: int, end: int) -> tuple[int | None, int | None]:
        if not page_ends:
            return section.page_start, section.page_end
        return page_at(start), page_at(max(start, end - 1))

    headings = [(index, line) for index, line in enumerate(lines) if RESULT_SUBHEADING.fullmatch(line.strip())]
    if headings:
        parts: list[ParsedUnit] = []
        offsets = [0]
        for line in lines:
            offsets.append(offsets[-1] + len(line) + 1)
        if headings[0][0] > 0:
            end = headings[0][0]
            parts.append(ParsedUnit("RESULTS", "Results 概览", "\n".join(lines[:end]), *span(0, offsets[end])))
        for number, (start, heading) in enumerate(headings):
            end = headings[number + 1][0] if number + 1 < len(headings) else len(lines)
            parts.append(ParsedUnit("RESULTS", heading, "\n".join(lines[start + 1:end]), *span(offsets[start], offsets[end])))
        return parts
    chunks = [section.text[i:i + 5500] for i in range(0, len(section.text), 5500)] or [""]
    return [ParsedUnit("RESULTS", section.heading if len(chunks) == 1 else f"{section.heading} · {number}/{len(chunks)}",
                       chunk, *span((number - 1) * 5500, (number - 1) * 5500 + len(chunk))) for number, chunk in enumerate(chunks, 1)]


def parse_pdf(path: str | Path, on_stage: Callable[[str], None] | None = None) -> ParsedPDF:
    stage = on_stage or (lambda _value: None)
    stage("reading")
    try:
        document = fitz.open(path)
    except Exception as exc:
        raise ValueError("PDF 无法打开或已损坏") from exc
    with document:
        if document.page_count == 0:
            raise ValueError("PDF 没有可读取的页面")
        page_lines = []
        for number, page in enumerate(document, 1):
            lines = [line.strip() for line in page.get_text("text").splitlines()
                     if line.strip() and not RUNNING_HEADERS.fullmatch(line.strip())]
            page_lines.append((number, lines))
        stage("structure")
        # Select the prominent first-page text, not the first long line. Many
        # publisher PDFs begin with copyright notices before the actual title.
        title = extract_title(document[0]) or "标题未识别（请核对原文）"
        units = [ParsedUnit("TITLE", "题目", title if title != "标题未识别（请核对原文）" else "", 1, 1)]
        sections: list[ParsedUnit] = []
        section_pages: dict[int, dict[int, list[str]]] = {}
        current: ParsedUnit | None = None
        figures: dict[str, ParsedUnit] = {}
        tables: dict[str, ParsedUnit] = {}
        supplementary = False
        for page_number, lines in page_lines:
            for line_index, line in enumerate(lines):
                after_main_text = page_number > 1 or (current is not None and current.kind in {"RESULTS", "DISCUSSION", "CONCLUSION"})
                if after_main_text and line.strip().lower() in {"references", "bibliography", "参考文献"}:
                    if current:
                        sections.append(current)
                        current = None
                    supplementary = True
                    continue
                if after_main_text and (SUPPLEMENT.fullmatch(line) or line.strip().lower() in {"appendix", "appendices", "附录"}):
                    supplementary = True
                if supplementary:
                    continue
                # Publisher manuscripts often print section labels in the same
                # font as body text; the exact heading match is less fragile
                # than a size threshold for these short standalone lines.
                heading_kind = classify_heading(line)
                if heading_kind:
                    if current:
                        sections.append(current)
                    current = ParsedUnit(heading_kind, line, "", page_number, page_number)
                    continue
                figure = FIGURE.match(line) if not supplementary else None
                if figure:
                    caption = line
                    for continuation in lines[line_index + 1:line_index + 4]:
                        if caption.rstrip().endswith(".") or classify_heading(continuation) or FIGURE.match(continuation) or TABLE.match(continuation):
                            break
                        caption += " " + continuation
                    figures.setdefault(figure.group(1).lower(), ParsedUnit("FIGURE", f"Figure {figure.group(1)}", caption, page_number, page_number))
                table = TABLE.match(line) if not supplementary else None
                if table:
                    tables.setdefault(table.group(1).lower(), ParsedUnit("TABLE", f"Table {table.group(1)}", line, page_number, page_number))
                if current:
                    current.text += line + "\n"
                    current.page_end = page_number
                    section_pages.setdefault(id(current), {}).setdefault(page_number, []).append(line)
        if current:
            sections.append(current)
        # Reviews may have no standard section headings. Do not call dozens of
        # pages an abstract: retain page-scoped, explicitly unclassified text.
        recovered_body = False
        normalized_sections: list[ParsedUnit] = []
        for section in sections:
            if (section.kind in {"ABSTRACT", "INTRODUCTION"} and len(section.text) >= 10000
                    and section.page_start and section.page_end
                    and section.page_end - section.page_start >= 2):
                recovered_body = True
                for page_number, lines in section_pages.get(id(section), {}).items():
                    text = "\n".join(lines).strip()
                    if text:
                        normalized_sections.append(ParsedUnit("BODY", f"未分类正文 · 第 {page_number} 页", text, page_number, page_number))
            else:
                normalized_sections.append(section)
        sections = normalized_sections
        # Some papers use descriptive headings rather than IMRaD labels and
        # have no explicit abstract heading at all. Preserve readable pages
        # rather than returning only a title; keep the text unclassified.
        if not sections:
            body_pages: list[ParsedUnit] = []
            reached_references = False
            for page_number, lines in page_lines:
                captured: list[str] = []
                for line in lines:
                    if page_number > 1 and line.strip().lower() in {"references", "bibliography", "参考文献"}:
                        reached_references = True
                        break
                    captured.append(line)
                text = "\n".join(captured).strip()
                if len(text) >= 200:
                    body_pages.append(ParsedUnit("BODY", f"未分类原文 · 第 {page_number} 页", text, page_number, page_number))
                if reached_references:
                    break
            if len(body_pages) >= 2:
                sections.extend(body_pages)
                recovered_body = True
        if not any(item.kind == "ABSTRACT" for item in sections):
            recovered = extract_unlabeled_abstract(document[0])
            if recovered:
                sections.append(ParsedUnit("ABSTRACT", "摘要（首页正文块）", recovered, 1, 1))
        stage("figures")
        order = {"ABSTRACT": 0, "INTRODUCTION": 1, "METHODS": 2, "RESULTS": 3, "DISCUSSION": 4, "CONCLUSION": 5, "BODY": 6}
        sections.sort(key=lambda item: (item.page_start or 0, order[item.kind]))
        stage("manifest")
        results_added = False
        for section in sections:
            if section.kind != "RESULTS":
                units.append(section)
                continue
            first_results_section = not results_added
            results_added = True
            # Read figures first, but do not discard tables or non-visual Results.
            visual_units = (list(figures.values()) + list(tables.values())) if first_results_section else []
            if visual_units:
                for item in visual_units:
                    label = item.heading.lower()
                    source_lines = section.text.splitlines()
                    mentions = [i for i, line in enumerate(source_lines) if label in line.lower()]
                    evidence = "\n".join("\n".join(source_lines[max(0, i - 2):i + 4]) for i in mentions[:3])
                    page_text = next((lines for number, lines in page_lines if number == item.page_start), [])
                    caption_at = next((i for i, line in enumerate(page_text) if line.startswith(item.heading + ":") or line.startswith(item.heading + ".")), -1)
                    nearby = "\n".join(page_text[max(0, caption_at - 3):caption_at + 9]) if caption_at >= 0 else ""
                    table_text = ""
                    if item.kind == "TABLE":
                        caption_at = next((i for i, line in enumerate(page_text) if line == item.text), -1)
                        if caption_at >= 0:
                            table_text = "\n".join(page_text[caption_at + 1:caption_at + 21])
                    item.text = f"图注/表注：{item.text}\nResults 相关原文：\n{evidence or '正文中未定位到该图的明确引用。'}\n同页邻近文字：\n{nearby}\n表格页面文字：\n{table_text}"[:7500]
                    units.append(item)
            if section.text.strip():
                units.extend(result_text_units(section, section_pages.get(id(section))))
        if not results_added:
            units.extend(list(figures.values()) + list(tables.values()))
        units.append(ParsedUnit("RECAP", "全文复盘", "", None, None))
        # Count characters rather than lines: a short but readable paper can
        # legitimately contain fewer than twenty extracted lines. Also expose
        # mixed PDFs where only some pages lack a usable text layer.
        scarce_pages = [number for number, lines in page_lines
                        if sum(len(re.sub(r"\s+", "", line)) for line in lines) < 60]
        warnings = []
        if scarce_pages:
            warnings.append(f"有 {len(scarce_pages)} 页可提取文字很少，可能是图片页或扫描页；当前版本未做 OCR，请核对原文。")
        if recovered_body:
            warnings.append("部分正文未识别章节，已按页保留未分类原文；请核对阅读顺序和原文。")
        elif len(sections) < 2 and len(scarce_pages) < document.page_count:
            warnings.append("未可靠识别论文章节；请核对阅读顺序与原文。")
        return ParsedPDF(title, document.page_count, units, " ".join(warnings) or None)


def render_page_png(path: str | Path, page_number: int, max_dimension: int = 1500) -> bytes:
    with fitz.open(path) as document:
        if page_number < 1 or page_number > document.page_count:
            raise ValueError("页码超出范围")
        page = document[page_number - 1]
        scale = min(2.0, max_dimension / max(page.rect.width, page.rect.height))
        return page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False).tobytes("png")


def extract_embedded_images(path: str | Path, *, generation: str | None = None) -> list[dict]:
    """Extract raster assets; vector Figure panels remain available through page rendering."""
    source = Path(path)
    folder = source.parent / "images"
    if generation:
        folder = folder / generation
    results = []
    with fitz.open(source) as document:
        for page_number, page in enumerate(document, 1):
            seen = set()
            for entry in page.get_images(full=True):
                xref = entry[0]
                if xref in seen:
                    continue
                seen.add(xref)
                try:
                    image = document.extract_image(xref)
                except Exception:
                    continue
                extension = image.get("ext", "bin").lower()
                if extension not in {"png", "jpg", "jpeg", "jpx", "tiff", "bmp"}:
                    extension = "bin"
                folder.mkdir(parents=True, exist_ok=True)
                target = folder / f"page-{page_number}-xref-{xref}.{extension}"
                target.write_bytes(image["image"])
                results.append({"page_number": page_number, "xref": xref, "path": str(target),
                                "width": image.get("width", 0), "height": image.get("height", 0)})
    return results
