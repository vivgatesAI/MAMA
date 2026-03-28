const fs = require('fs');
const path = require('path');

const serverFile = path.join(__dirname, 'server.js');
let serverContent = fs.readFileSync(serverFile, 'utf8');

serverContent = serverContent.replace(
    /let systemPrompt = 'You are an elite Medical Affairs AI writer\\.';/g,
    `let systemPrompt = 'You are an elite Medical Affairs AI writer. If a FORMAT TEMPLATE is provided, you MUST structure your entire response to exactly match the headings, sections, and style of the template.';`
);

serverContent = serverContent.replace(
    /const \{ topic, outputType \} = req\.body;/g,
    `const { topic, outputType, template } = req.body;`
);

serverContent = serverContent.replace(
    /case 'press':\n                systemPrompt \+= ' Write a professional Pharmaceutical Press Release announcing these findings to the public and investors in an accessible yet accurate tone\\.';\n                userInstruction = 'Please generate the press release based on this combined data\\.';\n                break;/g,
    `case 'press':
                systemPrompt += ' Write a professional Pharmaceutical Press Release announcing these findings to the public and investors in an accessible yet accurate tone.';
                userInstruction = 'Please generate the press release based on this combined data.';
                break;
            case 'pls':
                systemPrompt += ' Write a Plain Language Summary (PLS) intended for patients and the general public. Use clear, non-jargon language, short sentences, and empathetic tone.';
                userInstruction = 'Please generate the plain language summary based on this combined data.';
                break;`
);

serverContent = serverContent.replace(
    /\}\n\n        \/\/ 2\. Generate Manuscript Text/g,
    `}\n        if (template) {\n            userInstruction += '\\n\\n=== REQUIRED FORMAT TEMPLATE ===\\n' + template;\n        }\n\n        // 2. Generate Manuscript Text`
);

const oldImageLogic = `        // 2. Generate an elegant chart/image for the publication
        let imageUrl = '';
        try {
            const imageResponse = await axios.post('https://api.venice.ai/api/v1/image/generate', {
                model: 'flux-2-max', // Updated to a valid Venice image model
                prompt: \`A clean, professional scientific data visualization line chart for a medical journal, minimalist style, white background. Topic: \${topic}\`,
                width: 1024,
                height: 1024,
                return_binary: false
            }, {
                headers: {
                    'Authorization': \`Bearer \${VENICE_API_KEY}\`,
                    'Content-Type': 'application/json'
                }
            });
            imageUrl = imageResponse.data.images ? imageResponse.data.images[0] : '';
        } catch (imgError) {
             console.error('Image Generation Error:', imgError.response?.data || imgError.message);
        }`;

const newImageLogic = `        // 3. Dynamically determine how many images are needed and generate their prompts
        let imagePrompts = [];
        try {
            const promptDetermineResponse = await axios.post('https://api.venice.ai/api/v1/chat/completions', {
                model: 'kimi-k2-5',
                messages: [
                    { role: 'system', content: 'You are an AI that decides what scientific charts or images are needed for a medical document. Output ONLY a valid JSON array of strings, where each string is a detailed image generation prompt designed for "grok-imagine". Generate between 0 and 5 prompts depending on what is appropriate for the document type (e.g. 0 for abstracts, 5 for full manuscripts). Return ONLY JSON, no markdown formatting.' },
                    { role: 'user', content: \`Document Type: \${outputType}\\n\\nManuscript content:\\n\${manuscriptText.substring(0, 2000)}\\n\\nDetermine the visuals needed and provide the JSON array of prompts.\` }
                ]
            }, {
                headers: { 'Authorization': \`Bearer \${VENICE_API_KEY}\`, 'Content-Type': 'application/json' }
            });
            
            let jsonString = promptDetermineResponse.data.choices[0].message.content.trim();
            if(jsonString.startsWith('\`\`\`json')) jsonString = jsonString.slice(7, -3).trim();
            else if(jsonString.startsWith('\`\`\`')) jsonString = jsonString.slice(3, -3).trim();
            
            imagePrompts = JSON.parse(jsonString);
            if (!Array.isArray(imagePrompts)) imagePrompts = [];
            if (imagePrompts.length > 10) imagePrompts = imagePrompts.slice(0, 10);
            console.log(\`[Images] Determined we need \${imagePrompts.length} images.\`);
        } catch (e) {
            console.error('[Images] Failed to determine image prompts, falling back to 1 default.', e.message);
            imagePrompts = [\`A clean, professional scientific data visualization for a medical journal, minimalist style, white background. Topic: \${topic}\`];
        }

        let imageUrls = [];
        for (let i = 0; i < imagePrompts.length; i++) {
            try {
                const imageResponse = await axios.post('https://api.venice.ai/api/v1/image/generate', {
                    model: 'grok-imagine', 
                    prompt: imagePrompts[i],
                    width: 1024,
                    height: 1024,
                    return_binary: false
                }, {
                    headers: { 'Authorization': \`Bearer \${VENICE_API_KEY}\`, 'Content-Type': 'application/json' }
                });
                if (imageResponse.data.images && imageResponse.data.images[0]) {
                    imageUrls.push({
                        url: imageResponse.data.images[0],
                        prompt: imagePrompts[i]
                    });
                }
            } catch (imgError) {
                 console.error(\`Image Gen Error for prompt \${i}:\`, imgError.response?.data?.error || imgError.message);
            }
        }`;

serverContent = serverContent.replace(oldImageLogic, newImageLogic);
serverContent = serverContent.replace(/imageUrl: imageUrl/g, 'imageUrls: imageUrls');

fs.writeFileSync(serverFile, serverContent, 'utf8');
console.log('server.js updated');

const htmlFile = path.join(__dirname, 'public', 'index.html');
let htmlContent = fs.readFileSync(htmlFile, 'utf8');

const pressRadio = `<label class="cursor-pointer group flex items-start gap-3 p-3 border border-slate-200 rounded-lg hover:border-sky-500 hover:bg-sky-50 transition-all has-[:checked]:border-sky-500 has-[:checked]:bg-sky-50 has-[:checked]:ring-1 has-[:checked]:ring-sky-500">
                            <input type="radio" name="outputType" value="press" class="mt-1 flex-shrink-0 text-sky-600 focus:ring-sky-500 border-gray-300">
                            <div class="flex flex-col">
                                <span class="text-sm font-semibold text-slate-800 group-hover:text-sky-700">Press Release</span>
                                <span class="text-xs text-slate-500 mt-0.5 leading-tight">Public facing announcement</span>
                            </div>
                        </label>`;

const plsRadioAddition = pressRadio + `\n                        <label class="cursor-pointer group flex items-start gap-3 p-3 border border-slate-200 rounded-lg hover:border-sky-500 hover:bg-sky-50 transition-all has-[:checked]:border-sky-500 has-[:checked]:bg-sky-50 has-[:checked]:ring-1 has-[:checked]:ring-sky-500">
                            <input type="radio" name="outputType" value="pls" class="mt-1 flex-shrink-0 text-sky-600 focus:ring-sky-500 border-gray-300">
                            <div class="flex flex-col">
                                <span class="text-sm font-semibold text-slate-800 group-hover:text-sky-700">Plain Language</span>
                                <span class="text-xs text-slate-500 mt-0.5 leading-tight">Patient-friendly summary</span>
                            </div>
                        </label>`;
                        
htmlContent = htmlContent.replace(pressRadio, plsRadioAddition);
htmlContent = htmlContent.replace(/grid-cols-2 gap-3 mb-2/g, 'grid-cols-2 md:grid-cols-3 gap-3 mb-2');

const topicDiv = `<div class="mb-5">
                    <label class="block text-sm font-medium text-slate-700 mb-2">Study Title or Mechanism <span class="text-red-500">*</span></label>
                    <textarea id="topic" rows="5" placeholder="Enter clinical trial title, endpoint data summary, or MOA..." 
                           class="w-full px-4 py-3 rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent text-sm bg-slate-50"></textarea>
                </div>`;

const templateDivAddition = topicDiv + `\n                <div class="mb-5">
                    <label class="block text-sm font-medium text-slate-700 mb-2">Format Template (Optional)</label>
                    <textarea id="template" rows="3" placeholder="Define headers, bullet points, or style guidelines (e.g. 'Must include sections: 1. Background, 2. Mechanism, 3. Safety')..." 
                           class="w-full px-4 py-3 rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent text-sm bg-indigo-50/30"></textarea>
                </div>`;

htmlContent = htmlContent.replace(topicDiv, templateDivAddition);

htmlContent = htmlContent.replace(/if \(outputType === 'press'\) typeLabel = "press release copy";/g, `if (outputType === 'press') typeLabel = "press release copy";
            if (outputType === 'pls') typeLabel = "patient-friendly summary";`);
            
htmlContent = htmlContent.replace(/\{ text: "Generating supplementary data figures \(Flux\)\.\.\.", percent: 90 \},/g, `{ text: "Generating dynamic figures list and executing (Grok-Imagine)...", percent: 90 },`);

htmlContent = htmlContent.replace(
    /body: JSON\.stringify\(\{ \n                        topic: topic,\n                        outputType: outputType,\n                        files: Array\.from/g,
    `body: JSON.stringify({ 
                        topic: topic,
                        outputType: outputType,
                        template: document.getElementById('template') ? document.getElementById('template').value : '',
                        files: Array.from`
);

const oldImgRender = `                if (data.imageUrl) {
                    let imgSource = data.imageUrl.startsWith('http') ? data.imageUrl : 'data:image/png;base64,' + data.imageUrl;
                    imageContainer.innerHTML = '<img src="' + imgSource + '" alt="Figure 1" class="mx-auto border border-slate-200 shadow-sm w-full h-auto rounded mb-2"><p class="text-xs text-slate-500 font-medium">Fig 1. Data Visualization</p>';
                } else {
                    imageContainer.innerHTML = '<p class="text-xs text-slate-400 italic">No image generated.</p>';
                }`;

const newImgRender = `                if (data.imageUrls && data.imageUrls.length > 0) {
                    let htmlAcc = '';
                    data.imageUrls.forEach((imgObj, i) => {
                        let imgSource = imgObj.url.startsWith('http') ? imgObj.url : 'data:image/png;base64,' + imgObj.url;
                        htmlAcc += \`<div class="mb-4">
                            <img src="\${imgSource}" alt="Figure \${i+1}" class="mx-auto border border-slate-200 shadow-sm w-full h-auto rounded mb-2">
                            <p class="text-[10px] text-slate-500 font-medium leading-tight px-2">Fig \${i+1}. \${imgObj.prompt}</p>
                        </div>\`;
                    });
                    imageContainer.innerHTML = htmlAcc;
                } else {
                    imageContainer.innerHTML = '<p class="text-xs text-slate-400 italic">No images required for this document type.</p>';
                }`;

htmlContent = htmlContent.replace(oldImgRender, newImgRender);

htmlContent = htmlContent.replace(
    /const imgContainer = document\.getElementById\('imageContainer'\);\n            const imgEl = imgContainer\.querySelector\('img'\);\n            if \(imgEl\) \{\n                const clonedImg = document\.createElement\('img'\);\n                clonedImg\.src = imgEl\.src;\n                clonedImg\.style\.maxWidth = '100%';\n                clonedImg\.style\.display = 'block';\n                clonedImg\.style\.margin = '20px auto';\n                pdfContainer\.appendChild\(clonedImg\);\n            \}/g,
    `const imgContainer = document.getElementById('imageContainer');
            const imgEls = imgContainer.querySelectorAll('img');
            if (imgEls && imgEls.length > 0) {
                imgEls.forEach(imgEl => {
                    const clonedImg = document.createElement('img');
                    clonedImg.src = imgEl.src;
                    clonedImg.style.maxWidth = '100%';
                    clonedImg.style.display = 'block';
                    clonedImg.style.margin = '20px auto';
                    pdfContainer.appendChild(clonedImg);
                });
            }`
);

fs.writeFileSync(htmlFile, htmlContent, 'utf8');
console.log('index.html updated');
