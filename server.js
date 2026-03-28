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

app.post('/api/generate', upload.array('documents'), async (req, res) => {
    try {
        const { topic } = req.body;
        
        // 0. Fetch real literature context
        const literatureContext = await fetchPubMedAbstracts(topic);
        console.log('[API] Literature context retrieved. Starting generation...');
        
        // 1. Generate Manuscript Text using venice api
        const chatResponse = await axios.post('https://api.venice.ai/api/v1/chat/completions', {
            model: 'gemini-3-flash-preview',
            messages: [
                { role: 'system', content: 'You are an elite Medical Affairs AI writer. Write a pristine, elegant scientific manuscript. You must heavily reference and incorporate the provided valid clinical literature from PubMed in your draft.' },
                { role: 'user', content: `Topic: ${topic}\n\n=== RECENT PUBMED LITERATURE EXTRACT ===\n${literatureContext}\n=====================================\n\nPlease generate the manuscript draft including Introduction, Methodology summary, and Conclusion based on this real data. Cite the authors in-text.` }
            ]
        }, {
            headers: {
                'Authorization': `Bearer ${VENICE_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        
        const manuscriptText = chatResponse.data.choices[0].message.content;

        // 2. Generate an elegant chart/image for the publication
        let imageUrl = '';
        try {
            const imageResponse = await axios.post('https://api.venice.ai/api/v1/image/generate', {
                model: 'flux-2-max', // Updated to a valid Venice image model
                prompt: `A clean, professional scientific data visualization line chart for a medical journal, minimalist style, white background. Topic: ${topic}`,
                width: 1024,
                height: 1024,
                return_binary: false
            }, {
                headers: {
                    'Authorization': `Bearer ${VENICE_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });
            imageUrl = imageResponse.data.images ? imageResponse.data.images[0] : '';
        } catch (imgError) {
             console.error('Image Generation Error:', imgError.response?.data || imgError.message);
        }

        res.json({
            success: true,
            manuscript: manuscriptText,
            imageUrl: imageUrl
        });

    } catch (error) {
        console.error('Venice API Error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to generate manuscript using Venice AI' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`MAMA Backend running on port ${PORT}`);
});