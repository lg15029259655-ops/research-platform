"""解析完成后的预计算：把"点开再等"变成"点开就有"。

默认关闭（PRECOMPUTE_ON_PARSE=1 才启用）：
- 测试环境不该因为上传 PDF 就烧模型额度；
- 部署方可以按配额决定是否开启。
"""

import logging

from .. import config
from ..services import bailian_service
from . import worker

logger = logging.getLogger(__name__)


def schedule_for_paper(paper_id: str, owner: str) -> None:
    if not config.precompute_enabled():
        return
    try:
        bailian_service.text_config()
    except Exception:  # noqa: BLE001 - 未配置模型时静默跳过
        return
    if "xray" in worker.registered_kinds():
        worker.enqueue_threadsafe("xray", owner, {"paper_id": paper_id})
    if "mindmap" in worker.registered_kinds():
        worker.enqueue_threadsafe("mindmap", owner, {"paper_id": paper_id})
