---
name: medaffairs-manuscript
description: Complete toolkit for generating high-quality scientific manuscripts for Medical Affairs using Venice AI. Use when user asks to create, draft, or improve medical publications, congress abstracts, reviews, or when they want an AI medical writer that follows GPP3/ICMJE standards. Integrates venice-api-kit for embeddings (RAG on references), text generation, image/figure creation, and video transcription of advisory boards.
---

# Medaffairs Manuscript

## Workflow

**MAMA** is a complete medical manuscript generation system powered by Venice AI.

### When to Use This Skill
- User wants to draft a scientific manuscript, review article, congress abstract, or case report
- User provides study data, references, target journal, or key messages
- User asks to “write a paper”, “generate manuscript”, “create abstract for ASCO”, or similar
- Need to incorporate PubMed literature, transcribe advisory boards (video), or create figures

### Core Workflow
1. **Input Collection** — Gather clinical data, references (PDFs/DOIs), target journal, key messages
2. **Reference Processing** — Use Venice embeddings to create RAG index (see `embed_references.py`)
3. **Literature Search** — Augment with PubMed-style search when needed
4. **Outline Generation** — Create journal-compliant outline
5. **Manuscript Generation** — Section-by-section writing using Venice (Nano Banana Pro recommended for quality)
6. **Figure & Visuals** — Generate figures/graphs using Venice image models
7. **Compliance Check** — Flag unsubstantiated claims, promotional language
8. **Output** — Deliver Word document + tracked changes + reference list

Use `venice-api-kit` for all generation, embeddings, and transcription steps.

## Scripts (Core Tools)

- `embed_references.py` — Creates Venice embeddings from uploaded papers/references for RAG
- `manuscript_generate.py` — Main orchestrator: generates full manuscripts using Venice (Nano Banana Pro recommended) + RAG
- `pubmed_search.py` — Augments references with real PubMed literature search
- `compliance_check.py` — Scans output for regulatory red flags (GPP3/ICMJE compliance)

## References
- `medical_guidelines.md` — GPP3, ICMJE, CONSORT summaries
- `journal_templates.md` — Common journal formatting rules

## Assets
- `mama-infographic-nanobanana.png` — Whimsical watercolor project overview (generated with Nano Banana Pro)
- `manuscript_template.docx` — Base Word template (to be added)

All Venice API calls must go through the `venice-api-kit` scripts. Use Nano Banana Pro for high-quality medical writing.
