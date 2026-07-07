"""
PDF 첫 페이지 추출 + 병합 -> PDF24 OCR 페이지로 연결

이 앱은 OCR 자체는 수행하지 않습니다. 대신:
    1) 여러 PDF를 업로드
    2) 각 PDF의 첫 페이지만 추출 (하단 서명란 등은 잘라내기 옵션으로 제거 가능)
    3) 하나의 PDF로 병합해서 다운로드 제공
    4) PDF24 OCR 페이지로 바로 이동할 수 있는 버튼 제공
       (브라우저 보안 정책상 파일을 자동으로 넘겨줄 수는 없어, 다운로드한 파일을
        PDF24 페이지에 직접 한 번 더 업로드해야 합니다. 그 순서를 화면에 안내합니다.)

필요한 파일 (리포지토리 루트):
    requirements.txt
        streamlit
        pymupdf
        pypdf

로컬 실행:
    streamlit run OCR.py
"""

import os
import tempfile

import fitz  # PyMuPDF
import streamlit as st
from pypdf import PdfReader, PdfWriter

PDF24_OCR_URL = "https://tools.pdf24.org/ko/ocr-pdf"


def extract_first_page_cropped(pdf_bytes: bytes, crop_ratio: float, tmp_dir: str, out_name: str) -> str:
    """PDF 첫 페이지만 추출하고, 하단(crop_ratio 이후, 예: 서명란)을 잘라낸 1페이지 PDF를 저장"""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page = doc[0]
    rect = page.rect

    if crop_ratio < 1.0:
        new_height = rect.height * crop_ratio
        page.set_mediabox(fitz.Rect(rect.x0, rect.y0, rect.x1, rect.y0 + new_height))
        page.set_cropbox(fitz.Rect(rect.x0, rect.y0, rect.x1, rect.y0 + new_height))

    new_doc = fitz.open()
    new_doc.insert_pdf(doc, from_page=0, to_page=0)

    out_path = os.path.join(tmp_dir, out_name)
    new_doc.save(out_path)
    new_doc.close()
    doc.close()
    return out_path


def main():
    st.set_page_config(page_title="PDF 첫페이지 병합 → PDF24 OCR 연결", layout="centered")
    st.title("📄 PDF 첫 페이지 추출 → 병합 → PDF24 OCR로 이동")
    st.caption("여러 PDF의 첫 페이지만 모아 하나의 파일로 만든 뒤, PDF24에서 한국어 OCR을 이어서 진행할 수 있게 도와드립니다.")

    with st.sidebar:
        st.header("⚙️ 설정")
        crop_ratio = st.slider(
            "상단 유지 비율 (서명란 제거)",
            min_value=0.5, max_value=1.0, value=0.85, step=0.01,
            help="1.0이면 페이지 전체 유지, 낮출수록 하단(서명란 등)을 더 많이 잘라냅니다."
        )

    uploaded_files = st.file_uploader(
        "PDF 파일 업로드 (여러 개 선택 가능)",
        type=["pdf"],
        accept_multiple_files=True,
    )

    if uploaded_files:
        st.write(f"업로드된 파일 수: **{len(uploaded_files)}개**")

    if uploaded_files and st.button("📎 첫 페이지 추출 후 병합", type="primary"):
        with tempfile.TemporaryDirectory() as tmp_dir:
            progress = st.progress(0.0)
            status = st.empty()

            writer = PdfWriter()
            total = len(uploaded_files)

            for idx, uploaded_file in enumerate(uploaded_files, start=1):
                status.text(f"처리 중 ({idx}/{total}): {uploaded_file.name}")
                pdf_bytes = uploaded_file.read()

                try:
                    page_path = extract_first_page_cropped(
                        pdf_bytes, crop_ratio, tmp_dir, f"page_{idx}.pdf"
                    )
                    reader = PdfReader(page_path)
                    writer.add_page(reader.pages[0])
                except Exception as e:
                    st.warning(f"'{uploaded_file.name}' 처리 중 오류 발생: {e}")

                progress.progress(idx / total)

            status.text("병합 파일 저장 중...")
            result_path = os.path.join(tmp_dir, "병합_첫페이지.pdf")
            with open(result_path, "wb") as f:
                writer.write(f)

            with open(result_path, "rb") as f:
                result_bytes = f.read()

            status.text("완료!")
            st.session_state["merged_pdf_bytes"] = result_bytes
            st.session_state["merged_page_count"] = len(writer.pages)

    # 병합 결과가 세션에 있으면 다운로드 + PDF24 연결 안내 표시
    if "merged_pdf_bytes" in st.session_state:
        st.success(f"총 {st.session_state['merged_page_count']}페이지, 병합이 완료되었습니다.")

        st.download_button(
            label="📥 1단계: 병합 PDF 다운로드",
            data=st.session_state["merged_pdf_bytes"],
            file_name="병합_첫페이지.pdf",
            mime="application/pdf",
        )

        st.markdown("---")
        st.subheader("2단계: PDF24에서 한국어 OCR 적용")
        st.markdown(
            f"""
            아래 버튼으로 PDF24 OCR 페이지를 새 탭에서 열고, 방금 다운로드한 파일을 그대로 이어서 처리하세요.

            1. 위에서 다운로드한 `병합_첫페이지.pdf` 파일을 PDF24 페이지의 업로드 상자에 끌어다 놓기
            2. 언어 설정에서 **"Korean(한국어)"** 선택
            3. **"OCR 강제(Force OCR)"** 옵션 체크
            4. OCR 시작 버튼 클릭 → 완료되면 결과 파일 다운로드
            """
        )
        st.link_button("🔗 PDF24 OCR 페이지 열기", PDF24_OCR_URL)


if __name__ == "__main__":
    main()
