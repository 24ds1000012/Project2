const express = require('express');
const multer = require('multer');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Multer setup for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Function to call OpenAI's GPT API (you can substitute this with other LLM APIs)
const getAnswerFromLLM = async (question, fileContent) => {
    try {
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-3.5-turbo', // Or any model you'd like to use
        messages: [
          { role: 'system', content: 'You are an assistant that answers assignment questions.' },
          { role: 'user', content: question },
          { role: 'user', content: fileContent || [] }, // If any file content is provided
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

  // API endpoint to handle POST requests with the question and optional file attachments
app.post('/api', upload.single('file'), async (req, res) => {
    const { question } = req.body;
    const file = req.file;
  
    if (!question) {
      return res.status(400).json({ error: 'Question is required.' });
    }
  
    let fileContent = '';
    if (file) {
      // Assuming text file attachments. You can add more parsing based on file type (e.g., PDF, DOCX)
      if (path.extname(file.originalname) === '.txt') {
        fileContent = file.buffer.toString();
      } else {
        return res.status(400).json({ error: 'Only .txt files are supported for now.' });
      }
    }
  
    // Get the answer from the LLM
    const answer = await getAnswerFromLLM(question, fileContent);
  
    res.json({ answer });
  });
  
  // Start the server
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
