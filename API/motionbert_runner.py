"""Windows上でMotionBERTの推論スクリプトを安全に実行するラッパー。"""

import os
import sys
from pathlib import Path

import torch.utils.data


def _use_single_process_data_loader() -> None:
    """Windowsで再帰的なワーカープロセス生成を避ける。"""
    original_data_loader = torch.utils.data.DataLoader

    def create_data_loader(*args, **kwargs):
        kwargs["num_workers"] = 0
        kwargs.pop("prefetch_factor", None)
        kwargs.pop("persistent_workers", None)
        return original_data_loader(*args, **kwargs)

    torch.utils.data.DataLoader = create_data_loader


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("MotionBERT script path is required")

    script_path = Path(sys.argv[1]).resolve()
    if not script_path.is_file():
        raise FileNotFoundError(f"MotionBERT script not found: {script_path}")

    _use_single_process_data_loader()
    sys.argv = [str(script_path), *sys.argv[2:]]
    sys.path.insert(0, str(script_path.parent))
    os.chdir(script_path.parent)

    namespace = {
        "__name__": "__main__",
        "__file__": str(script_path),
        "__package__": None,
        "__cached__": None,
    }
    source = script_path.read_bytes()
    exec(compile(source, str(script_path), "exec"), namespace)


if __name__ == "__main__":
    main()
