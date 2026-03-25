import streamlit as st
from pathlib import Path

st.set_page_config(page_title="MAMA — Medical Affairs Manuscript AI", page_icon="🧬", layout="wide")

# Elegant French-inspired CSS
st.markdown("""
<style>
    .main {
        background: linear-gradient(135deg, #f8f4f0 0%, #f0e6d9 100%);
        color: #2c2520;
    }
    .stApp {
        background: linear-gradient(135deg, #f8f4f0 0%, #f0e6d9 100%);
    }
    h1, h2, h3 {
        font-family: 'Georgia', serif;
        color: #3a2f1f;
        letter-spacing: -0.5px;
    }
    .stButton>button {
        background: #3a2f1f;
        color: white;
        border-radius: 8px;
        padding: 12px 28px;
        font-weight: 500;
        border: none;
    }
    .upload-section {
        border: 2px dashed #c9b9a0;
        border-radius: 16px;
        padding: 2rem;
        text-align: center;
    }
</style>
""", unsafe_allow_html=True)

st.title("🧬 MAMA")
st.markdown("**Medical Affairs Manuscript AI** — *Élégance et Précision*")

st.markdown("---")

col1, col2 = st.columns([3, 2])

with col1:
    st.subheader("Upload Supporting Documents")
    uploaded_files = st.file_uploader(
        "PDFs, Word documents, CSRs, or references", 
        accept_multiple_files=True,
        type=['pdf', 'docx', 'txt']
    )
    
    topic = st.text_area("Main Topic or Study Title", placeholder="Efficacy of ... in patients with ...")
    
    if st.button("Generate Manuscript", type="primary"):
        st.success("Processing with Venice AI (Nano Banana Pro + Embeddings RAG)...")
        st.info("Generating Full Manuscript, Abstract, Plain Language Summary...")

with col2:
    st.subheader("Output Options")
    st.checkbox("Full Scientific Manuscript", value=True)
    st.checkbox("Structured Abstract", value=True)
    st.checkbox("Plain Language Summary", value=True)
    st.checkbox("Executive Summary", value=True)
    
    st.markdown("**Style**")
    st.radio("Tone", ["Scientific Conservative", "Balanced Academic", "Elegant Narrative"], index=0)

st.markdown("---")
st.caption("Powered by Venice AI • Designed with French elegance • RAG + Embeddings enabled")
