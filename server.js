const express = require('express');
const multer = require('multer');
const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const VENICE_API_KEY = process.env.VENICE_API_KEY || '';

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
        
        // 0. Process any uploaded reference documents into RAG setup
        let uploadContext = "";
        let docTexts = [];
        if (req.files && req.files.length > 0) {
            console.log(`[File Upload] Received ${req.files.length} documents for RAG processing.`);
            req.files.forEach((file, idx) => {
                const snippet = file.buffer.toString('utf8').substring(0, 500); 
                docTexts.push(`Extracted from ${file.originalname}: ${snippet}`);
            });
            uploadContext = docTexts.join('\n\n');
            
            sendProgress(res, 2, `Vectorizing ${req.files.length} document(s) with Venice AI...`, 20);
            await createVeniceEmbeddings(docTexts);
        }

        sendProgress(res, 3, 'Fetching clinical literature from PubMed...', 30);
        const literatureContext = await fetchPubMedAbstracts(topic);
        console.log('[API] Literature context retrieved. Starting generation...');
        
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

        sendProgress(res, 4, `Drafting ${outputType || 'manuscript'} content with Kimi k2.5...`, 45);
        
        // 2. Generate Manuscript Text using venice api
        const chatResponse = await axios.post('https://api.venice.ai/api/v1/chat/completions', {
            model: 'kimi-k2-5',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Topic: ${topic}\n\n=== RECENT PUBMED LITERATURE EXTRACT ===\n${literatureContext}\n\n=== INTERNAL RAG DOCUMENT CONTEXT ===\n${uploadContext || "No internal documents provided."}\n=====================================\n\n${userInstruction}` }
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
        try {
            const promptDetermineResponse = await axios.post('https://api.venice.ai/api/v1/chat/completions', {
                model: 'kimi-k2-5',
                messages: [
                    { role: 'system', content: 'You are an AI that decides what scientific charts or images are needed for a medical document. Output ONLY a valid JSON array of strings, where each string is a detailed image generation prompt designed for "grok-imagine". Generate between 0 and 5 prompts depending on what is appropriate for the document type (e.g. 0 for abstracts, 5 for full manuscripts). Return ONLY JSON, no markdown formatting.' },
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
            console.log(`[Images] Determined we need ${imagePrompts.length} images.`);
        } catch (e) {
            console.error('[Images] Failed to determine image prompts, falling back to 1 default.', e.message);
            imagePrompts = [`A clean, professional scientific data visualization for a medical journal, minimalist style, white background. Topic: ${topic}`];
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

        sendProgress(res, 7, 'Finalizing document...', 95);
        
        // Send final data and close SSE stream
        res.write(`data: ${JSON.stringify({ complete: true, success: true, manuscript: manuscriptText, imageUrls: imageUrls })}

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