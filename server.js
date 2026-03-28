const express = require('express');
const multer = require('multer');
const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');
const pdfParse = require('pdf-parse');

dotenv.config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const VENICE_API_KEY = process.env.VENICE_API_KEY || '';

// ============================================
// GRAPH RAG IMPLEMENTATION
// ============================================

class GraphRAG {
    constructor() {
        this.chunks = []; // { id, text, embedding, source, entities: [] }
        this.entities = new Map(); // entity -> { chunks: [], related: Set() }
        this.relationships = []; // { from, to, type, chunkId }
    }

    // Cosine similarity between two vectors
    cosineSimilarity(a, b) {
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    // Smart chunking with overlap
    chunkText(text, chunkSize = 1000, overlap = 200) {
        const chunks = [];
        let start = 0;
        
        while (start < text.length) {
            let end = start + chunkSize;
            
            // Try to break at sentence or paragraph boundary
            const nextPeriod = text.indexOf('. ', end);
            const nextPara = text.indexOf('\n\n', end);
            
            if (nextPeriod !== -1 && nextPeriod < end + 100) {
                end = nextPeriod + 1;
            } else if (nextPara !== -1 && nextPara < end + 200) {
                end = nextPara;
            }
            
            chunks.push(text.substring(start, Math.min(end, text.length)));
            start = end - overlap;
        }
        
        return chunks.filter(c => c.trim().length > 50);
    }
    
    // Page-by-page chunking - each page becomes a chunk
    chunkByPages(pages, maxChunkSize = 4000) {
        const chunks = [];
        
        for (let i = 0; i < pages.length; i++) {
            const pageText = pages[i].trim();
            
            // Skip near-empty pages
            if (pageText.length < 50) continue;
            
            // If page is very long, split it but maintain page metadata
            if (pageText.length > maxChunkSize) {
                const subChunks = this.chunkText(pageText, maxChunkSize, 200);
                subChunks.forEach((subChunk, idx) => {
                    chunks.push({
                        text: subChunk,
                        pageNumber: i + 1,
                        isPartial: subChunks.length > 1,
                        partialIndex: idx + 1,
                        totalPartials: subChunks.length
                    });
                });
            } else {
                chunks.push({
                    text: pageText,
                    pageNumber: i + 1,
                    isPartial: false
                });
            }
        }
        
        return chunks;
    }

    // Extract entities from text using simple patterns + AI for key entities
    async extractEntities(text, chunkId, sourceFile) {
        const entities = [];
        
        // Pattern-based extraction
        const patterns = {
            drug: /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*\s?(?:\([^)]*\))?)(?:\s+(?:inhibitor|agonist|antagonist|therapy|treatment|drug|medication))/gi,
            gene: /\b([A-Z]{2,}[0-9]*)\s*gene\b/gi,
            protein: /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s*protein\b/gi,
            disease: /\b(?:patients?\s+with\s+)?([A-Z][a-z]+(?:\s[A-Z][a-z]+)*(?:\s+disease|disorder|syndrome|cancer|carcinoma|tumor))\b/gi,
            biomarker: /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s*(?:level|concentration|expression)\b/gi,
            trial: /\b(Phase\s+[I1]+[I1\/]*\s+(?:clinical\s+)?trial)\b/gi
        };
        
        for (const [type, regex] of Object.entries(patterns)) {
            const matches = text.match(regex) || [];
            for (const match of matches) {
                const clean = match.trim().replace(/\s+/g, ' ');
                if (clean.length > 3 && clean.length < 100) {
                    entities.push({ name: clean, type, source: sourceFile, chunkId });
                }
            }
        }
        
        return entities;
    }

    // Add documents to the graph
    async addDocuments(documents, embeddings, sendProgressFn) {
        console.log(`[GraphRAG] Adding ${documents.length} documents to graph...`);
        
        for (let i = 0; i < documents.length; i++) {
            const { text, source } = documents[i];
            const embedding = embeddings[i];
            
            // Chunk the document
            const chunks = this.chunkText(text);
            
            for (let j = 0; j < chunks.length; j++) {
                const chunkId = `${source}_chunk_${i}_${j}`;
                
                // Extract entities
                const entities = await this.extractEntities(chunks[j], chunkId, source);
                
                // Store chunk
                this.chunks.push({
                    id: chunkId,
                    text: chunks[j],
                    embedding: embedding.embedding, // Use the Venice embedding
                    source: source,
                    entities: entities.map(e => e.name)
                });
                
                // Build entity index
                for (const entity of entities) {
                    if (!this.entities.has(entity.name)) {
                        this.entities.set(entity.name, { 
                            type: entity.type, 
                            chunks: [], 
                            related: new Set() 
                        });
                    }
                    this.entities.get(entity.name).chunks.push(chunkId);
                }
                
                if (sendProgressFn) {
                    sendProgressFn(2, `Processing chunk ${j + 1}/${chunks.length} from ${source}...`, 
                        20 + Math.floor(((i * chunks.length + j) / (documents.length * chunks.length)) * 10));
                }
            }
        }
        
        // Build relationships between chunks sharing entities
        this.buildRelationships();
        
        console.log(`[GraphRAG] Graph built: ${this.chunks.length} chunks, ${this.entities.size} entities`);
    }

    // Build relationships between chunks
    buildRelationships() {
        for (const [entityName, data] of this.entities) {
            const chunkIds = data.chunks;
            
            // Connect all chunks sharing this entity
            for (let i = 0; i < chunkIds.length; i++) {
                for (let j = i + 1; j < chunkIds.length; j++) {
                    this.relationships.push({
                        from: chunkIds[i],
                        to: chunkIds[j],
                        type: 'SHARES_ENTITY',
                        entity: entityName
                    });
                    
                    // Track related chunks
                    if (!this.entities.get(entityName).related.has(chunkIds[j])) {
                        this.entities.get(entityName).related.add(chunkIds[j]);
                    }
                }
            }
        }
    }

    // Hybrid retrieval: Vector + Graph traversal
    async retrieve(query, queryEmbedding, topK = 5) {
        console.log(`[GraphRAG] Retrieving for query: "${query.substring(0, 100)}..."`);
        
        // 1. Vector similarity search
        const vectorScores = this.chunks.map(chunk => ({
            chunk,
            score: this.cosineSimilarity(queryEmbedding.embedding, chunk.embedding)
        }));
        
        vectorScores.sort((a, b) => b.score - a.score);
        const topVector = vectorScores.slice(0, topK);
        
        // 2. Graph expansion - find related chunks
        const graphExpansion = new Map();
        
        for (const { chunk, score } of topVector) {
            // Add original chunk
            graphExpansion.set(chunk.id, { chunk, score: score * 1.0 });
            
            // Find related chunks via shared entities
            for (const entityName of chunk.entities) {
                const entityData = this.entities.get(entityName);
                if (entityData) {
                    for (const relatedChunkId of entityData.related) {
                        if (!graphExpansion.has(relatedChunkId)) {
                            const relatedChunk = this.chunks.find(c => c.id === relatedChunkId);
                            if (relatedChunk) {
                                const relatedScore = this.cosineSimilarity(queryEmbedding.embedding, relatedChunk.embedding);
                                graphExpansion.set(relatedChunkId, { 
                                    chunk: relatedChunk, 
                                    score: relatedScore * 0.8 // Slightly lower weight for graph neighbors
                                });
                            }
                        }
                    }
                }
            }
        }
        
        // 3. Combine and rank
        const results = Array.from(graphExpansion.values());
        results.sort((a, b) => b.score - a.score);
        
        // Return top results with deduplication
        const seen = new Set();
        const finalResults = [];
        
        for (const result of results) {
            // Deduplicate by content similarity (simple)
            const key = result.chunk.text.substring(0, 100);
            if (!seen.has(key)) {
                seen.add(key);
                finalResults.push(result);
                if (finalResults.length >= topK * 1.5) break; // Get slightly more for diversity
            }
        }
        
        console.log(`[GraphRAG] Retrieved ${finalResults.length} chunks (${topVector.length} vector + ${finalResults.length - topVector.length} graph)`);
        
        return finalResults.slice(0, topK);
    }

    // Generate citation context
    formatContext(results) {
        return results.map((r, i) => {
            const pageInfo = r.chunk.pageNumber ? ` (Page ${r.chunk.pageNumber})` : '';
            return `[Source ${i + 1}: ${r.chunk.source}${pageInfo}]\n${r.chunk.text.substring(0, 800)}...\n(Entities: ${r.chunk.entities.slice(0, 5).join(', ') || 'none'})`;
        }).join('\n\n---\n\n');
    }

    // Get citation map for the response
    getCitationMap(results) {
        return results.map(r => {
            const citation = {
                source: r.chunk.source,
                entities: r.chunk.entities.slice(0, 3),
                relevance: Math.round(r.score * 100) / 100
            };
            if (r.chunk.pageNumber) {
                citation.page = r.chunk.pageNumber;
            }
            return citation;
        });
    }
}

// Global GraphRAG instance (in-memory)
const graphRAG = new GraphRAG();

// Helper to extract text from PDF buffers - with page preservation
async function extractPDFText(buffer, preservePages = true) {
    try {
        const data = await pdfParse(buffer);
        
        if (!preservePages) {
            return { fullText: data.text.substring(0, 10000), pages: null };
        }
        
        // Try to split by form feed (page break character)
        let pages = data.text.split('\f').filter(p => p.trim().length > 0);
        
        // If no form feeds found, estimate pages based on average page size
        // A typical PDF page has ~3000-5000 characters
        if (pages.length === 1 && data.text.length > 8000) {
            const estimatedCharsPerPage = 4500;
            const estimatedPages = Math.ceil(data.text.length / estimatedCharsPerPage);
            pages = [];
            
            for (let i = 0; i < estimatedPages; i++) {
                const start = i * estimatedCharsPerPage;
                const end = Math.min((i + 1) * estimatedCharsPerPage, data.text.length);
                const pageText = data.text.substring(start, end);
                
                // Try to break at paragraph boundary
                const lastPara = pageText.lastIndexOf('\n\n');
                if (lastPara > estimatedCharsPerPage * 0.8 && i < estimatedPages - 1) {
                    pages.push(data.text.substring(start, start + lastPara));
                    // Adjust next page start
                    i--; // Re-process remaining with adjusted start
                    data.text = data.text.substring(0, start) + data.text.substring(start + lastPara).trim();
                } else {
                    pages.push(pageText);
                }
            }
        }
        
        // Clean up pages
        pages = pages.map(p => p.trim()).filter(p => p.length > 100);
        
        console.log(`[PDF] Extracted ${pages.length} pages`);
        return { 
            fullText: data.text.substring(0, 10000), 
            pages: pages 
        };
    } catch (e) {
        console.error('[PDF] Error parsing PDF:', e.message);
        return { fullText: null, pages: null };
    }
}

// Helper function to fetch real clinical literature from PubMed
async function fetchPubMedAbstracts(topic) {
    try {
        console.log(`[PubMed] Searching for: ${topic}`);
        // 1. Search for top 3 article IDs related to the topic
        const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(topic)}&retmode=json&retmax=3&sort=relevance`;
        const searchRes = await axios.get(searchUrl);
        const idList = searchRes.data.esearchresult?.idlist || [];
        
        if (idList.length === 0) return "No direct PubMed literature found. Rely on general medical knowledge.";

        // 2. Fetch the text abstracts for those IDs
        console.log(`[PubMed] Fetching abstracts for IDs: ${idList.join(', ')}`);
        const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${idList.join(',')}&rettype=abstract&retmode=text`;
        const fetchRes = await axios.get(fetchUrl);
        
        return fetchRes.data; // Raw text abstracts
    } catch (e) {
        console.error('[PubMed] Error fetching literature:', e.message);
        return "Failed to retrieve PubMed literature. Rely on general medical knowledge.";
    }
}

// Helper to chunk documents and get Venice Embeddings for true RAG
async function createVeniceEmbeddings(documentTextArray) {
    if (!documentTextArray || documentTextArray.length === 0) return null;
    try {
        console.log('[RAG] Creating Venice embeddings for user documents...');
        // Sending batch of text to be embedded
        const embedRes = await axios.post('https://api.venice.ai/api/v1/embeddings', {
            input: documentTextArray,
            model: 'voyage-2' // Standard embeddings model on Venice
        }, {
            headers: {
                'Authorization': `Bearer ${VENICE_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        
        // In a full DB setup you'd store these vectors. For this one-shot generation
        // we've effectively validated the RAG pipeline capability on Venice.
        console.log(`[RAG] Successfully generated ${embedRes.data.data.length} embeddings vectors.`);
        return embedRes.data.data;
    } catch (e) {
        console.error('[RAG] Error creating embeddings:', e.response?.data || e.message);
        return null;
    }
}

// Progress event emitter helper
function sendProgress(res, step, message, percent) {
    if (res && res.write) {
        res.write(`data: ${JSON.stringify({ step, message, percent })}

`);
    }
}

app.post('/api/generate', upload.array('documents'), async (req, res) => {
    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    try {
        const { topic, outputType, template } = req.body;
        
        sendProgress(res, 1, 'Processing uploaded documents...', 10);
        
        // ============================================
        // GRAPH RAG PROCESSING
        // ============================================
        let ragContext = "";
        let citationMap = [];
        
        if (req.files && req.files.length > 0) {
            console.log(`[GraphRAG] Processing ${req.files.length} documents...`);
            
            // Extract text from all documents - with page preservation for PDFs
            const documents = [];
            const documentsWithPages = []; // Track which docs have page info
            
            for (const file of req.files) {
                let extractedResult = null;
                
                if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
                    sendProgress(res, 1, `Extracting pages from ${file.originalname}...`, 12);
                    extractedResult = await extractPDFText(file.buffer, true); // preservePages = true
                    if (!extractedResult || !extractedResult.fullText) {
                        extractedResult = { fullText: `[Could not extract text from ${file.originalname}]`, pages: null };
                    }
                } else {
                    const text = file.buffer.toString('utf8');
                    extractedResult = { fullText: text, pages: null };
                }
                
                if (extractedResult && extractedResult.fullText && extractedResult.fullText.length > 100) {
                    documents.push({ 
                        text: extractedResult.fullText, 
                        source: file.originalname,
                        pages: extractedResult.pages 
                    });
                    if (extractedResult.pages && extractedResult.pages.length > 0) {
                        documentsWithPages.push(file.originalname);
                    }
                }
            }
            
            if (documents.length > 0) {
                const chunkMode = documentsWithPages.length > 0 ? 'page-based' : 'sliding window';
                sendProgress(res, 2, `Building Graph RAG: ${chunkMode} chunking ${documents.length} documents...`, 18);
                
                // Generate embeddings for all chunks
                const allChunkDocs = [];
                
                for (const doc of documents) {
                    if (doc.pages && doc.pages.length > 0) {
                        // Use page-based chunking for PDFs
                        const pageChunks = graphRAG.chunkByPages(doc.pages, 4000);
                        for (const pageChunk of pageChunks) {
                            allChunkDocs.push({
                                text: pageChunk.text,
                                source: doc.source,
                                pageNumber: pageChunk.pageNumber,
                                isPartial: pageChunk.isPartial
                            });
                        }
                    } else {
                        // Fall back to sliding window for non-PDF files
                        const chunks = graphRAG.chunkText(doc.text);
                        chunks.forEach((chunk, idx) => allChunkDocs.push({ 
                            text: chunk, 
                            source: doc.source,
                            chunkIndex: idx
                        }));
                    }
                }
                
                sendProgress(res, 2, `Embedding ${allChunkDocs.length} chunks with Venice AI...`, 22);
                const chunkTexts = allChunkDocs.map(c => c.text);
                const embeddings = await createVeniceEmbeddings(chunkTexts);
                
                if (embeddings) {
                    sendProgress(res, 2, `Building knowledge graph with entities...`, 25);
                    
                    // Clear previous graph and build new one
                    graphRAG.chunks = [];
                    graphRAG.entities = new Map();
                    graphRAG.relationships = [];
                    
                    // Build chunk documents with embeddings
                    const chunkDocs = [];
                    for (let i = 0; i < allChunkDocs.length; i++) {
                        const chunkInfo = allChunkDocs[i];
                        // Build source label with page info if available
                        let sourceLabel = chunkInfo.source;
                        if (chunkInfo.pageNumber) {
                            sourceLabel = `${chunkInfo.source} (Page ${chunkInfo.pageNumber}${chunkInfo.isPartial ? ` Part ${chunkInfo.partialIndex}/${chunkInfo.totalPartials}` : ''})`;
                        }
                        
                        chunkDocs.push({
                            text: chunkInfo.text,
                            source: sourceLabel
                        });
                    }
                    
                    // Get embeddings for all chunks
                    if (chunkDocs.length > 0) {
                        const chunkTextsForEmbed = chunkDocs.map(c => c.text);
                        const chunkEmbeds = await createVeniceEmbeddings(chunkTextsForEmbed);
                        
                        if (chunkEmbeds) {
                            for (let i = 0; i < chunkDocs.length; i++) {
                                chunkDocs[i].embedding = chunkEmbeds[i];
                            }
                        }
                    }
                    
                    // Build the graph
                    for (const chunkDoc of chunkDocs) {
                        if (chunkDoc.embedding) {
                            await graphRAG.addDocuments([chunkDoc], [chunkDoc.embedding], sendProgress.bind(null, res));
                        }
                    }
                    
                    sendProgress(res, 2, `Graph built: ${graphRAG.chunks.length} chunks, ${graphRAG.entities.size} entities`, 28);
                }
            }
        }

        sendProgress(res, 3, 'Fetching clinical literature from PubMed...', 30);
        
        // Get topic embedding for RAG retrieval
        let topicEmbedding = null;
        try {
            const topicEmbedRes = await axios.post('https://api.venice.ai/api/v1/embeddings', {
                input: [topic],
                model: 'voyage-2'
            }, {
                headers: { 'Authorization': `Bearer ${VENICE_API_KEY}`, 'Content-Type': 'application/json' }
            });
            topicEmbedding = topicEmbedRes.data.data[0];
        } catch (e) {
            console.log('[RAG] Could not get topic embedding, using fallback');
        }
        const literatureContext = await fetchPubMedAbstracts(topic);
        console.log('[API] Literature context retrieved. Starting generation...');
        
        // ============================================
        // RETRIEVE RELEVANT CONTEXT USING GRAPH RAG
        // ============================================
        if (graphRAG.chunks.length > 0 && topicEmbedding) {
            sendProgress(res, 3, 'Retrieving relevant passages via Graph RAG...', 32);
            const relevantChunks = await graphRAG.retrieve(topic, topicEmbedding, 8);
            ragContext = graphRAG.formatContext(relevantChunks);
            citationMap = graphRAG.getCitationMap(relevantChunks);
            console.log(`[GraphRAG] Retrieved ${relevantChunks.length} relevant chunks`);
        }
        
        let systemPrompt = 'You are an elite Medical Affairs AI writer.';
        let userInstruction = `Please generate the manuscript draft including Introduction, Methodology summary, and Conclusion based on this combined data. Cite the authors in-text.`;
        
        switch(outputType) {
            case 'abstract':
                systemPrompt += ' Write a concise, highly structured Congress Abstract (Background, Methods, Results, Conclusion). Limit to 300 words.';
                userInstruction = 'Please generate the structured congress abstract based on this combined data.';
                break;
            case 'summary':
                systemPrompt += ' Write a high-level Executive Summary for internal leadership, highlighting key takeaways and strategic implications.';
                userInstruction = 'Please generate the executive summary based on this combined data.';
                break;
            case 'press':
                systemPrompt += ' Write a professional Pharmaceutical Press Release announcing these findings to the public and investors in an accessible yet accurate tone.';
                userInstruction = 'Please generate the press release based on this combined data.';
                break;
            case 'manuscript':
            default:
                systemPrompt += ' Write a pristine, elegant full scientific manuscript. Synthesize both the PubMed literature and the internal RAG document data provided.';
                userInstruction = 'Please generate the manuscript draft including Introduction, Methodology summary, and Conclusion based on this combined data. Cite the authors in-text.';
                break;
        }
        if (template) {
            userInstruction += '\n\n=== REQUIRED FORMAT TEMPLATE ===\n' + template;
        }
        
        // Add citation instructions
        userInstruction += '\n\n=== CITATION INSTRUCTIONS ===\nWhen referencing uploaded documents, cite using [Source X] format where X is the source number. Include inline citations for specific claims, data, or findings from the provided context.';

        sendProgress(res, 4, `Drafting ${outputType || 'manuscript'} with Graph RAG citations...`, 45);
        
        // Build the context section
        const contextSection = ragContext 
            ? `=== RELEVANT DOCUMENT EXCERPTS (via Graph RAG) ===\n${ragContext}\n\n[Sources identified through semantic similarity + entity graph traversal]`
            : uploadContext || "No internal documents provided.";
        
        // 2. Generate Manuscript Text using venice api
        const chatResponse = await axios.post('https://api.venice.ai/api/v1/chat/completions', {
            model: 'gemini-3-flash-preview',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Topic: ${topic}\n\n=== PUBMED LITERATURE ===\n${literatureContext}\n\n${contextSection}\n=====================================\n\n${userInstruction}` }
            ]
        }, {
            headers: {
                'Authorization': `Bearer ${VENICE_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        
        const manuscriptText = chatResponse.data.choices[0].message.content;
        sendProgress(res, 5, 'Manuscript draft complete. Planning visualizations...', 60);

        // 3. Dynamically determine how many images are needed and generate their prompts
        let imagePrompts = [];
        const SCIENTIFIC_STYLE = "Professional scientific illustration style, clean vector-like aesthetic, white/light gray background, medical journal quality, consistent color palette: deep blue (#1a365d), teal (#38b2ac), soft coral (#ff6b6b), muted gold (#d4a574), lavender (#9f7aea). Minimalist design with clear labels, subtle gradients, 3D rendered appearance but not photorealistic, diagrammatic clarity, NIH/NEJM publication style.";
        
        try {
            const promptDetermineResponse = await axios.post('https://api.venice.ai/api/v1/chat/completions', {
                model: 'gemini-3-flash-preview',
                messages: [
                    { role: 'system', content: `You are an AI that decides what scientific charts or images are needed for a medical document. Output ONLY a valid JSON array of strings, where each string is a detailed image generation prompt. Each prompt should describe a specific scientific visualization needed (diagram, mechanism illustration, data chart, etc.). Generate between 0 and 5 prompts depending on document type. All prompts must include: "${SCIENTIFIC_STYLE}" Return ONLY JSON array, no markdown formatting.` },
                    { role: 'user', content: `Document Type: ${outputType}\n\nManuscript content:\n${manuscriptText.substring(0, 2000)}\n\nDetermine the visuals needed and provide the JSON array of prompts.` }
                ]
            }, {
                headers: { 'Authorization': `Bearer ${VENICE_API_KEY}`, 'Content-Type': 'application/json' }
            });
            
            let jsonString = promptDetermineResponse.data.choices[0].message.content.trim();
            if(jsonString.startsWith('```json')) jsonString = jsonString.slice(7, -3).trim();
            else if(jsonString.startsWith('```')) jsonString = jsonString.slice(3, -3).trim();
            
            imagePrompts = JSON.parse(jsonString);
            if (!Array.isArray(imagePrompts)) imagePrompts = [];
            if (imagePrompts.length > 10) imagePrompts = imagePrompts.slice(0, 10);
            
            // Ensure consistent styling in all prompts
            imagePrompts = imagePrompts.map(prompt => {
                if (!prompt.toLowerCase().includes('scientific illustration')) {
                    return `${prompt}. ${SCIENTIFIC_STYLE}`;
                }
                return prompt;
            });
            
            console.log(`[Images] Determined we need ${imagePrompts.length} images.`);
        } catch (e) {
            console.error('[Images] Failed to determine image prompts, falling back to 1 default.', e.message);
            imagePrompts = [`Professional scientific illustration showing ${topic}, clean vector-like aesthetic with deep blue (#1a365d), teal (#38b2ac), soft coral (#ff6b6b), muted gold (#d4a574), and lavender (#9f7aea) color palette, white background, medical journal quality, minimalist diagrammatic style.`];
        }

        let imageUrls = [];
        for (let i = 0; i < imagePrompts.length; i++) {
            sendProgress(res, 6, `Generating figure ${i + 1} of ${imagePrompts.length} with grok-imagine...`, 65 + Math.floor((i / imagePrompts.length) * 25));
            try {
                const imageResponse = await axios.post('https://api.venice.ai/api/v1/image/generate', {
                    model: 'grok-imagine', 
                    prompt: imagePrompts[i],
                    width: 1024,
                    height: 1024,
                    return_binary: false
                }, {
                    headers: { 'Authorization': `Bearer ${VENICE_API_KEY}`, 'Content-Type': 'application/json' }
                });
                if (imageResponse.data.images && imageResponse.data.images[0]) {
                    imageUrls.push({
                        url: imageResponse.data.images[0],
                        prompt: imagePrompts[i]
                    });
                }
            } catch (imgError) {
                 console.error(`Image Gen Error for prompt ${i}:`, imgError.response?.data?.error || imgError.message);
            }
        }

        sendProgress(res, 7, 'Finalizing document with references...', 95);
        
        // Build references section
        let referencesSection = '';
        if (citationMap.length > 0) {
            const uniqueSources = [...new Set(citationMap.map(c => c.source))];
            referencesSection = '\n\n## References\n\n' + uniqueSources.map((s, i) => {
                const citationsForSource = citationMap.filter(c => c.source === s);
                const avgRelevance = Math.round(citationsForSource.reduce((a, b) => a + b.relevance, 0) / citationsForSource.length * 100);
                const pages = [...new Set(citationsForSource.map(c => c.page).filter(Boolean))];
                const pageStr = pages.length > 0 ? ` (Pages: ${pages.join(', ')})` : '';
                return `[${i + 1}] ${s}${pageStr} - Relevance: ${avgRelevance}%`;
            }).join('\n');
        }
        
        // Send final data and close SSE stream
        res.write(`data: ${JSON.stringify({ complete: true, success: true, manuscript: manuscriptText + referencesSection, imageUrls: imageUrls, citations: citationMap })}

`);
        res.end();

    } catch (error) {
        console.error('Venice API Error:', error.response?.data || error.message);
        res.write(`data: ${JSON.stringify({ error: 'Failed to generate manuscript using Venice AI' })}

`);
        res.end();
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`MAMA Backend running on port ${PORT}`);
});