const express = require('express');
const multer = require('multer');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON
app.use(express.json());  // ✅ Fix: Parse JSON body
app.use(express.urlencoded({ extended: true })); // ✅ Fix: Parse URL-encoded data

// Multer setup for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Function to call OpenAI API
const getAnswerFromLLM = async (question, fileContent) => {
    try {
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-3.5-turbo',
            messages: [
                { role: 'system', content: 'You are an assistant that answers assignment questions.' },
                { role: 'user', content: question },
                { role: 'user', content: fileContent || '' }, // Send file content if available
            ],
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
        });

        return response.data.choices[0].message.content.trim();
    } catch (error) {
        console.error('Error calling LLM API:', error);
        return 'Sorry, I could not generate an answer at the moment.';
    }
};

// API endpoint
app.post('/api', upload.single('file'), async (req, res) => {
    console.log("Received request:", req.body); // Debugging log
    const { question } = req.body;
    const file = req.file;

    if (!question) {
        return res.status(400).json({ error: 'Question is required.' });
    }

    let fileContent = '';
    if (file) {
        if (path.extname(file.originalname) === '.txt') {
            fileContent = file.buffer.toString();
        } else {
            return res.status(400).json({ error: 'Only .txt files are supported for now.' });
        }
    }

    const answer = await getAnswerFromLLM(question, fileContent);
    res.json({ answer });
});

// Start the server only if not in Vercel
if (require.main === module) {
    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    });
}

// Start the server
module.exports = app;
