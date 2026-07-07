"""
PDF 첫 페이지 추출 + 병합 + PaddleOCR 기반 한국어 OCR 자동화 웹앱

설치:
    pip install streamlit pymupdf paddlepaddle paddleocr reportlab pypdf

실행:
    streamlit run app.py

동작 순서:
    1) 여러 개의 PDF 파일을 업로드
    2) 각 PDF의 첫 페이지만 추출 (하단 서명란은 잘라내서 제외)
    3) 잘라낸 페이지 이미지들을 하나의 PDF로 병합
    4) PaddleOCR로 한국어 텍스트 인식 후, 인식된 텍스트를 이미지 위에
       "보이지 않는 레이어"로 삽입하여 복사/검색 가능한 PDF 생성
    5) 결과 PDF 다운로드 버튼 제공

주의:
    - 모든 처리는 로컬(사용자 PC)에서만 이루어지며 외부 서버로 파일이 전송되지 않습니다.
    - 첫 실행 시 PaddleOCR 한국어 모델을 자동으로 다운로드하므로 다소 시간이 걸릴 수 있습니다.
"""

import io
import os
import tempfile

import fitz  # PyMuPDF
import streamlit as st
from paddleocr import PaddleOCR
from pypdf import PdfReader, PdfWriter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


# ------------------------------------------------------------------
# OCR 엔진 로드 (캐시하여 매 실행마다 다시 로드하지 않도록 함)
# ------------------------------------------------------------------
@st.cache_resource(show_spinner="OCR 엔진 초기화 중 (최초 1회, 모델 다운로드 포함)...")
def load_ocr_engine():
    return PaddleOCR(use_angle_cls=True, lang="korean", show_log=False)


def crop_first_page_to_image(pdf_bytes: bytes, crop_ratio: float, zoom: float):
    """PDF 첫 페이지를 열어 하단(crop_ratio 이후)을 잘라내고 고해상도 이미지(PNG bytes)로 변환"""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page = doc[0]
    rect = page.rect
    new_height = rect.height * crop_ratio
    crop_rect = fitz.Rect(rect.x0, rect.y0, rect.x1, rect.y0 + new_height)

    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, clip=crop_rect)
    img_bytes = pix.tobytes("png")
    width, height = pix.width, pix.height
    doc.close()
    return img_bytes, width, height


def make_searchable_page_pdf(img_bytes: bytes, width: int, height: int, ocr_result, out_path: str):
    """이미지를 배경으로 깔고, 인식된 텍스트를 투명 레이어로 겹쳐 복사 가능한 1페이지 PDF 생성"""
    c = canvas.Canvas(out_path, pagesize=(width, height))
    img = ImageReader(io.BytesIO(img_bytes))
    c.drawImage(img, 0, 0, width=width, height=height)

    if ocr_result and ocr_result[0]:
        for line in ocr_result[0]:
            box, (text, conf) = line
            x0, y0 = box[0]
            x2, y2 = box[2]
            text_x = x0
            text_y = height - y2  # PDF 좌표계는 아래에서 위로 증가

            font_size = max(6, (y2 - y0) * 0.8)
            c.setFont("Helvetica", font_size)
            c.setFillAlpha(0)  # 완전 투명 (보이지 않지만 선택/복사는 가능)
            c.drawString(text_x, text_y, text)

    c.showPage()
    c.save()


def main():
    st.set_page_config(page_title="PDF 첫페이지 병합 + 한국어 OCR", layout="centered")
    st.title("📄 PDF 첫 페이지 추출 → 병합 → 한국어 OCR")
    st.caption("여러 PDF를 올리면 각 파일의 첫 페이지만 모아 하나의 복사 가능한 PDF로 만들어 드립니다. 모든 처리는 이 컴퓨터 안에서만 이루어집니다.")

    with st.sidebar:
        st.header("⚙️ 설정")
        crop_ratio = st.slider(
            "상단 유지 비율 (서명란 제거)",
            min_value=0.5, max_value=1.0, value=0.85, step=0.01,
            help="1.0이면 페이지 전체 사용, 낮출수록 하단(서명란 등)을 더 많이 잘라냅니다."
        )
        zoom = st.slider(
            "해상도 배율", min_value=1.5, max_value=4.0, value=3.0, step=0.5,
            help="높을수록 인식률은 좋아지지만 처리 시간이 길어집니다."
        )

    uploaded_files = st.file_uploader(
        "PDF 파일 업로드 (여러 개 선택 가능)",
        type=["pdf"],
        accept_multiple_files=True,
    )

    if uploaded_files:
        st.write(f"업로드된 파일 수: **{len(uploaded_files)}개**")

    if uploaded_files and st.button("🚀 자동 처리 시작", type="primary"):
        ocr_engine = load_ocr_engine()

        with tempfile.TemporaryDirectory() as tmp_dir:
            progress = st.progress(0.0)
            status = st.empty()

            writer = PdfWriter()
            total = len(uploaded_files)

            for idx, uploaded_file in enumerate(uploaded_files, start=1):
                status.text(f"처리 중 ({idx}/{total}): {uploaded_file.name}")

                pdf_bytes = uploaded_file.read()

                try:
                    # 1) 첫 페이지 크롭 → 이미지
                    img_bytes, w, h = crop_first_page_to_image(pdf_bytes, crop_ratio, zoom)

                    # 2) 임시 이미지 파일로 저장 후 PaddleOCR 실행
                    temp_img_path = os.path.join(tmp_dir, f"page_{idx}.png")
                    with open(temp_img_path, "wb") as f:
                        f.write(img_bytes)

                    ocr_result = ocr_engine.ocr(temp_img_path, cls=True)

                    # 3) 텍스트 레이어를 포함한 1페이지짜리 PDF 생성
                    page_pdf_path = os.path.join(tmp_dir, f"page_{idx}.pdf")
                    make_searchable_page_pdf(img_bytes, w, h, ocr_result, page_pdf_path)

                    # 4) 최종 병합 문서에 페이지 추가
                    reader = PdfReader(page_pdf_path)
                    writer.add_page(reader.pages[0])

                except Exception as e:
                    st.warning(f"'{uploaded_file.name}' 처리 중 오류 발생: {e}")

                progress.progress(idx / total)

            status.text("병합 파일 저장 중...")
            result_path = os.path.join(tmp_dir, "결과.pdf")
            with open(result_path, "wb") as f:
                writer.write(f)

            status.text("✅ 완료!")

            with open(result_path, "rb") as f:
                result_bytes = f.read()

            st.success(f"총 {len(writer.pages)}페이지, 복사 가능한 PDF가 완성되었습니다.")
            st.download_button(
                label="📥 결과 PDF 다운로드",
                data=result_bytes,
                file_name="병합_OCR_결과.pdf",
                mime="application/pdf",
            )
    elif not uploaded_files:
        st.info("먼저 PDF 파일들을 업로드해 주세요.")


if __name__ == "__main__":
    main()
