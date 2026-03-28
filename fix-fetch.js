const fs = require('fs');
const path = require('path');

const htmlFile = path.join(__dirname, 'public', 'index.html');
let htmlContent = fs.readFileSync(htmlFile, 'utf8');

const oldFetchStr = `            try {
                const response = await fetch('/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        topic: topic,
                        outputType: outputType,
                        template: document.getElementById('template') ? document.getElementById('template').value : '',
                        files: Array.from(document.getElementById('documents').files).map(f => f.name)
                    })
                });`;

const newFetchStr = `            try {
                const formData = new FormData();
                formData.append('topic', topic);
                formData.append('outputType', outputType);
                if (document.getElementById('template')) {
                    formData.append('template', document.getElementById('template').value);
                }
                
                const fileInput = document.getElementById('documents');
                if (fileInput.files.length > 0) {
                    for (let i = 0; i < fileInput.files.length; i++) {
                        formData.append('documents', fileInput.files[i]);
                    }
                }

                const response = await fetch('/api/generate', {
                    method: 'POST',
                    body: formData
                });`;

htmlContent = htmlContent.replace(oldFetchStr, newFetchStr);
fs.writeFileSync(htmlFile, htmlContent, 'utf8');
console.log('Fixed index.html to use FormData for file uploads.');
