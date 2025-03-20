const express = require("express");
const multer = require("multer");
const AdmZip = require("adm-zip");
const path = require("path");
const { Configuration, OpenAIApi } = require("openai");
const textract = require("textract");
const csvParser = require("csv-parser"); // Add the CSV parser library
const streamifier = require("streamifier"); // Add the streamifier library

require("dotenv").config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize OpenAI API client
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);  // Corrected capitalization here

// Helper function to process ZIP and extract answers from various file types
const extractAndFindAnswer = async (zipBuffer, question) => {
    try {
        const zip = new AdmZip(zipBuffer);
        const zipEntries = zip.getEntries();
        let extractedText = '';

        // Loop through each entry in the ZIP file and handle different file types
        for (let entry of zipEntries) {
            if (entry.entryName.startsWith('__MACOSX/')) {
                continue; // Skip macOS metadata files
            }

            console.log(`Extracting file: ${entry.entryName}`);
            const fileContent = entry.getData();

            // Handle different file types based on extension
            const fileExt = path.extname(entry.entryName).toLowerCase();

            if (fileExt === '.txt') {
                extractedText += fileContent.toString("utf8");
            } else if (fileExt === '.json') {
                extractedText += fileContent.toString("utf8");
            } else if (fileExt === '.csv') {
                extractedText += await extractTextFromCSV(fileContent); // Handle CSV files
            } else if (fileExt === '.pdf') {
                extractedText += await extractTextFromPDF(fileContent);
            } else if (fileExt === '.docx' || fileExt === '.doc') {
                extractedText += await extractTextFromDoc(fileContent);
            } else {
                console.log(`Unsupported file type: ${fileExt}`);
            }
        }

        if (!extractedText) {
            throw new Error("No readable text found in the ZIP file.");
        }

        // Now, search for the answer in the extracted text
        const answer = searchForAnswerInText(extractedText, question);
        return answer;

    } catch (error) {
        console.error("Error processing ZIP:", error);
        return `Error processing ZIP: ${error.message}`;
    }
};

// Helper function to extract text from CSV files
const extractTextFromCSV = (fileContent) => {
    return new Promise((resolve, reject) => {
        let extractedText = '';
        
        // Convert the Buffer to a readable stream
        const stream = streamifier.createReadStream(fileContent);
        
        stream
            .pipe(csvParser())
            .on('data', (row) => {
                extractedText += JSON.stringify(row) + '\n'; // Add CSV row as text
            })
            .on('end', () => {
                resolve(extractedText); // Resolve the extracted text after parsing
            })
            .on('error', (err) => {
                reject("Error parsing CSV: " + err); // Reject if CSV parsing fails
            });
    });
};

// Helper function to extract text from PDF files
const extractTextFromPDF = (fileContent) => {
    return new Promise((resolve, reject) => {
        textract.fromBufferWithMime("application/pdf", fileContent, function (err, text) {
            if (err) {
                reject("Error extracting text from PDF: " + err);
            } else {
                resolve(text);
            }
        });
    });
};

// Helper function to extract text from DOCX files
const extractTextFromDoc = (fileContent) => {
    return new Promise((resolve, reject) => {
        textract.fromBufferWithMime("application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileContent, function (err, text) {
            if (err) {
                reject("Error extracting text from DOCX: " + err);
            } else {
                resolve(text);
            }
        });
    });
};

// Helper function to search for an answer in extracted text
const searchForAnswerInText = (text, question) => {
    const regex = new RegExp(question, 'i');
    const matches = text.match(regex);

    if (matches && matches.length > 0) {
        return matches;
    } else {
        return ["No answer found in the document."];
    }
};

// Function to interact with OpenAI API (for non-ZIP questions)
const getChatGPTAnswer = async (question) => {
    try {
        const response = await openai.createChatCompletion({
            model: "gpt-3.5-turbo", 
            messages: [{ role: "user", content: question }],
            max_tokens: 150,
            temperature: 0.7,
        });

        return response.data.choices[0].message.content.trim();
    } catch (error) {
        console.error("Error with OpenAI API:", error.response ? error.response.data : error.message);
        return "Sorry, I couldn't get an answer from the AI.";
    }
};

// API endpoint to handle both JSON and multipart requests
app.post("/api", multer().single("file"), async (req, res) => {
    try {
        const { question } = req.body;
        const file = req.file;

        // Handle the question if it's in JSON (send to ChatGPT)
        if (req.is("application/json") && question) {
            const chatGPTAnswer = await getChatGPTAnswer(question);
            return res.json({
                question,
                answers: [chatGPTAnswer],
            });
        }

        // Handle the file upload request (multipart/form-data) - process ZIP with any file type
        if (file && path.extname(file.originalname) === ".zip") {
            const answerValues = await extractAndFindAnswer(file.buffer, question);
            return res.json({ question, answers: answerValues });
        }

        return res.status(400).json({ error: "Only .zip files are supported for this operation." });

    } catch (error) {
        console.error("Error processing request:", error);
        res.status(500).json({ error: "An unexpected error occurred." });
    }
});

// Root route
app.get("/", (req, res) => {
    res.send("Welcome to the Assignment Answer API! Use the /api endpoint.");
});

// Export for Vercel
module.exports = app;
