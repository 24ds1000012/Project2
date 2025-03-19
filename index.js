const express = require('express');
const multer = require('multer');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const getAnswerFromLLM = async (question, fileContent) => {
    try {
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-3.5-turbo',
            messages: [
                { role: 'system', content: 'You are an assistant that answers assignment questions.' },
                { role: 'user', content: question },
                { role: 'user', content: fileContent || '' },
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
    console.log("Received request:", req.body);
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

// Welcome Route
app.get("/", (req, res) => {
    res.send("Welcome to the Assignment Answer API! Use the /api endpoint.");
});

// ✅ Ensure we export app for Vercel
module.exports = app;
