"""
PDF 첫 페이지 추출 + 병합 + 한국어 OCR (Tesseract 기반, Streamlit Cloud 호환)

필요한 파일 (리포지토리 루트에 함께 두어야 함):
    requirements.txt
        streamlit
        pymupdf
        reportlab
        pypdf
        pytesseract

    packages.txt
        tesseract-ocr
        tesseract-ocr-kor

로컬 실행:
    streamlit run OCR.py
"""

import io
import os
import tempfile

import fitz  # PyMuPDF
import pytesseract
import streamlit as st
from PIL import Image
from pypdf import PdfReader, PdfWriter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


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


def make_searchable_page_pdf(img_bytes: bytes, width: int, height: int, out_path: str):
    """이미지를 배경으로 깔고, Tesseract가 인식한 단어별 위치에 투명 텍스트를 겹쳐
    복사/검색 가능한 1페이지 PDF를 생성"""
    pil_img = Image.open(io.BytesIO(img_bytes))

    # 단어 단위 좌표까지 포함한 상세 인식 결과
    ocr_data = pytesseract.image_to_data(
        pil_img, lang="kor+eng", config="--psm 6",
        output_type=pytesseract.Output.DICT,
    )

    c = canvas.Canvas(out_path, pagesize=(width, height))
    img_reader = ImageReader(io.BytesIO(img_bytes))
    c.drawImage(img_reader, 0, 0, width=width, height=height)

    n_boxes = len(ocr_data["text"])
    for i in range(n_boxes):
        text = ocr_data["text"][i].strip()
        if not text:
            continue
        x = ocr_data["left"][i]
        y = ocr_data["top"][i]
        w = ocr_data["width"][i]
        h = ocr_data["height"][i]

        # PDF 좌표계는 아래에서 위로 증가하므로 y 변환 필요
        text_x = x
        text_y = height - (y + h)

        font_size = max(6, h * 0.8)
        c.setFont("Helvetica", font_size)
        c.setFillAlpha(0)  # 투명 (보이지 않지만 선택/복사 가능)
        c.drawString(text_x, text_y, text)

    c.showPage()
    c.save()


def main():
    st.set_page_config(page_title="PDF 첫페이지 병합 + 한국어 OCR", layout="centered")
    st.title("📄 PDF 첫 페이지 추출 → 병합 → 한국어 OCR")
    st.caption("여러 PDF를 올리면 각 파일의 첫 페이지만 모아 하나의 복사 가능한 PDF로 만들어 드립니다.")

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
        with tempfile.TemporaryDirectory() as tmp_dir:
            progress = st.progress(0.0)
            status = st.empty()

            writer = PdfWriter()
            total = len(uploaded_files)

            for idx, uploaded_file in enumerate(uploaded_files, start=1):
                status.text(f"처리 중 ({idx}/{total}): {uploaded_file.name}")
                pdf_bytes = uploaded_file.read()

                try:
                    img_bytes, w, h = crop_first_page_to_image(pdf_bytes, crop_ratio, zoom)

                    page_pdf_path = os.path.join(tmp_dir, f"page_{idx}.pdf")
                    make_searchable_page_pdf(img_bytes, w, h, page_pdf_path)

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
