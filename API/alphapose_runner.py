"""AlphaPoseを現在のPython・NumPy環境で起動する互換ランナー。"""

import os
import runpy
import sys

import numpy as np


def main() -> None:
    """AlphaPoseが参照する旧NumPy型名を補って公式CLIを実行する。"""
    setattr(np, "float", float)
    setattr(np, "int", int)
    sys.path.insert(0, os.getcwd())
    runpy.run_module("scripts.demo_inference", run_name="__main__")


if __name__ == "__main__":
    main()
