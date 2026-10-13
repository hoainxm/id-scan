"""
Export yolo11n.pt -> yolo11n.onnx (model tìm "person" dùng trong portrait_service).

Chỉ cần chạy lại khi đổi model. Cần cài thêm (không có trong requirements.txt):
    pip install ultralytics onnx onnxslim
Chạy:
    cd BE && python -m tools.export_yolo_onnx
"""

import shutil
from pathlib import Path

from ultralytics import YOLO

BE_DIR = Path(__file__).resolve().parents[1]


def main():
    exported = YOLO(str(BE_DIR / "yolo11n.pt")).export(
        format="onnx", imgsz=640, opset=12, simplify=True, dynamic=False
    )
    target = BE_DIR / "yolo11n.onnx"
    if Path(exported).resolve() != target:
        shutil.move(exported, target)
    print(f"Đã ghi {target}")


if __name__ == "__main__":
    main()
