const express = require("express");
const multer = require("multer");
const AdmZip = require("adm-zip");
const path = require("path");
const { Configuration, OpenAIApi } = require("openai");
const textract = require("textract");
const csvParser = require("csv-parser");
const streamifier = require("streamifier");
const pdfParse = require("pdf-parse");
const xlsx = require("xlsx");  // Added for Excel support
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize OpenAI API client
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Extract text from CSV files
const extractTextFromCSV = (fileContent) => {
    return new Promise((resolve, reject) => {
        let extractedRows = [];
        const stream = streamifier.createReadStream(fileContent);
        
        stream
            .pipe(csvParser())
            .on("data", (row) => {
                let normalizedRow = {};
                for (const key in row) {
                    const cleanKey = key.replace(/\uFEFF/g, ""); // Remove BOM
                    normalizedRow[cleanKey] = row[key];
                }
                extractedRows.push(normalizedRow);
            })
            .on("end", () => resolve(JSON.stringify(extractedRows)))
            .on("error", (err) => reject("Error parsing CSV: " + err));
    });
};

// Extract text from PDF files
const extractTextFromPDF = async (fileContent) => {
    try {
        const data = await pdfParse(fileContent);
        return data.text;
    } catch (error) {
        console.error("Error extracting text from PDF:", error);
        return "";
    }
};

// Extract text from Excel files (NEW)
const extractTextFromExcel = async (fileContent) => {
    try {
        const workbook = xlsx.read(fileContent, { type: "buffer" });
        let extractedText = "";

        workbook.SheetNames.forEach((sheetName) => {
            const sheet = workbook.Sheets[sheetName];
            const sheetData = xlsx.utils.sheet_to_csv(sheet); // Convert to CSV format
            extractedText += sheetData + "\n";
        });

        return extractedText || "No data found in the Excel file.";
    } catch (error) {
        console.error("Error extracting text from Excel:", error);
        return "Error processing Excel file.";
    }
};

// Extract text from DOCX files
const extractTextFromDoc = (fileContent) => {
    return new Promise((resolve, reject) => {
        textract.fromBufferWithMime(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            fileContent,
            (err, text) => (err ? reject("Error extracting text from DOCX: " + err) : resolve(text))
        );
    });
};

// Process ZIP files and extract answers
const extractAndFindAnswer = async (zipBuffer, question) => {
    try {
        const zip = new AdmZip(zipBuffer);
        const zipEntries = zip.getEntries();
        let extractedText = "";

        for (let entry of zipEntries) {
            if (entry.entryName.startsWith("__MACOSX/")) continue;
            console.log(`Extracting file: ${entry.entryName}`);
            const fileContent = entry.getData();
            const fileExt = path.extname(entry.entryName).toLowerCase();

            if (fileExt === ".txt" || fileExt === ".json") {
                extractedText += fileContent.toString("utf8");
            } else if (fileExt === ".csv") {
                extractedText += await extractTextFromCSV(fileContent);
            } else if (fileExt === ".pdf") {
                extractedText += await extractTextFromPDF(fileContent);
            } else if (fileExt === ".xlsx" || fileExt === ".xls") {
                extractedText += await extractTextFromExcel(fileContent);
            } else if (fileExt === ".docx" || fileExt === ".doc") {
                extractedText += await extractTextFromDoc(fileContent);
            } else {
                console.log(`Unsupported file type: ${fileExt}`);
            }
        }

        if (!extractedText) throw new Error("No readable text found in the ZIP file.");
        return searchForAnswerInText(extractedText, question);
    } catch (error) {
        console.error("Error processing ZIP:", error);
        return [`Error processing ZIP: ${error.message}`];
    }
};

// Search for an answer in extracted text
const searchForAnswerInText = (text, question) => {
    try {
        const rows = JSON.parse(text);
        for (const row of rows) {
            if ("answer" in row) return [row["answer"]];
        }
        return ["No answer found in the document."];
    } catch (error) {
        console.error("Error searching in extracted text:", error);
        return ["Error processing extracted text."];
    }
};

// Query OpenAI API
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

// API endpoint for handling JSON and file uploads
app.post("/api", multer().single("file"), async (req, res) => {
    try {
        const { question } = req.body;
        const file = req.file;

        // ✅ If only a question is provided (ChatGPT answer)
        if (question && !file) {
            const chatGPTAnswer = await getChatGPTAnswer(question);
            return res.json({ question, answers: [chatGPTAnswer] });
        }

        // ✅ If a file is uploaded, process it
        if (!file) return res.status(400).json({ error: "No file uploaded." });

        const fileExt = path.extname(file.originalname).toLowerCase();

        // ✅ Handle ZIP files
        if (fileExt === ".zip") {
            const answerValues = await extractAndFindAnswer(file.buffer, question);
            return res.json({ question, answers: answerValues });
        }

        // ✅ Handle PDF files
        if (fileExt === ".pdf") {
            const extractedText = await extractTextFromPDF(file.buffer);
            const answer = searchForAnswerInText(extractedText, question);
            return res.json({ question, answers: answer });
        }

        // ✅ Handle CSV files
        if (fileExt === ".csv") {
            const extractedText = await extractTextFromCSV(file.buffer);
            const answer = searchForAnswerInText(extractedText, question);
            return res.json({ question, answers: answer });
        }

        // ✅ Handle Excel files (NEW)
        if (fileExt === ".xlsx" || fileExt === ".xls") {
            const extractedText = await extractTextFromExcel(file.buffer);
            const answer = searchForAnswerInText(extractedText, question);
            return res.json({ question, answers: answer });
        }

        return res.status(400).json({ error: "Unsupported file format. Only ZIP, PDF, CSV, XLS, and XLSX are supported." });

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
