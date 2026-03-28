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

app.post('/api/generate', upload.array('documents'), async (req, res) => {
    try {
        const { topic } = req.body;
        
        // 1. Generate Manuscript Text using venice api
        const chatResponse = await axios.post('https://api.venice.ai/api/v1/chat/completions', {
            model: 'gemini-3-flash-preview',
            messages: [
                { role: 'system', content: 'You are an elite Medical Affairs AI writer. Write a pristine, elegant scientific manuscript based on the provided topic.' },
                { role: 'user', content: `Topic: ${topic}\nPlease generate the executive summary, abstract, and plain language summary.` }
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