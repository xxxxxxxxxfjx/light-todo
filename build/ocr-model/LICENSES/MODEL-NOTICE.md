# PP-OCRv5 mobile models

Detection and recognition weights come from OnnxOCR
(https://gitee.com/jingsongliujing/OnnxOCR), models/ppocrv5, which repackages
PaddleOCR PP-OCRv5 ONNX models.

- det: PP-OCRv5 mobile detection, 4819576 bytes, sha256 4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae
- rec: PP-OCRv5 mobile recognition, 16631306 bytes, sha256 5825fc7ebf84ae7a412be049820b4d86d77620f204a041697b0494669b1742c5
- dictionary: ppocrv5_dict.txt (18383 entries + appended ASCII space)

Upstream: PaddleOCR, Apache-2.0 (see PaddleOCR-Apache-2.0.txt).
The manifest/model ids keep the light-ocr bundle envelope (PP-OCRv6 small tier)
so the native runtime accepts the bundle; the weights above are PP-OCRv5.
