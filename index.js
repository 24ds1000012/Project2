const express = require("express");
const multer = require("multer");
const path = require("path");
const { Configuration, OpenAIApi } = require("openai");
const textract = require("textract");
const csvParser = require("csv-parser");
const streamifier = require("streamifier");
const pdfParse = require("pdf-parse");
const xlsx = require("xlsx");
const AdmZip = require("adm-zip");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

const extractTextFromCSV = (fileContent) => {
    return new Promise((resolve, reject) => {
        let extractedText = "";
        const stream = streamifier.createReadStream(fileContent);
        stream
            .pipe(csvParser())
            .on("data", (row) => {
                extractedText += JSON.stringify(row) + "\n"; 
            })
            .on("end", () => resolve(extractedText))
            .on("error", (err) => reject("Error parsing CSV: " + err));
    });
};

const extractTextFromPDF = async (fileContent) => {
    try {
        const data = await pdfParse(fileContent);
        return data.text;
    } catch (error) {
        console.error("Error extracting text from PDF:", error);
        return "";
    }
};

const extractTextFromExcel = async (fileContent) => {
    try {
        const workbook = xlsx.read(fileContent, { type: "buffer" });
        let extractedText = "";
        workbook.SheetNames.forEach((sheetName) => {
            const sheet = workbook.Sheets[sheetName];
            extractedText += xlsx.utils.sheet_to_csv(sheet) + "\n";
        });
        return extractedText || "No data found in the Excel file.";
    } catch (error) {
        console.error("Error extracting text from Excel:", error);
        return "Error processing Excel file.";
    }
};

const extractTextFromDoc = (fileContent) => {
    return new Promise((resolve, reject) => {
        textract.fromBufferWithMime(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            fileContent,
            (err, text) => (err ? reject("Error extracting text from DOCX: " + err) : resolve(text))
        );
    });
};

const extractAndProcessZip = async (zipBuffer) => {
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
                extractedText += fileContent.toString("utf8") + "\n";
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

        return extractedText || "No readable text found in the ZIP file.";
    } catch (error) {
        console.error("Error processing ZIP:", error);
        return `Error processing ZIP: ${error.message}`;
    }
};

const getChatGPTAnswer = async (text, question) => {
    try {
        const messages = [{ role: "user", content: question }];
        if (text) {
            messages.unshift({ role: "system", content: `Use the following data to answer questions:\n${text}` });
        }

        const response = await openai.createChatCompletion({
            model: "gpt-3.5-turbo",
            messages: messages,
            max_tokens: 300,
            temperature: 0.7,
        });

        return response.data.choices[0].message.content.trim();
    } catch (error) {
        console.error("Error with OpenAI API:", error.response ? error.response.data : error.message);
        return "Sorry, I couldn't get an answer from the AI.";
    }
};

app.post("/api", multer().single("file"), async (req, res) => {
    try {
        const { question } = req.body;
        const file = req.file;

        if (!question) {
            return res.status(400).json({ error: "No question provided." });
        }

        let extractedText = "";

        if (file) {
            const fileExt = path.extname(file.originalname).toLowerCase();

            if (fileExt === ".zip") {
                extractedText = await extractAndProcessZip(file.buffer);
            } else if (fileExt === ".pdf") {
                extractedText = await extractTextFromPDF(file.buffer);
            } else if (fileExt === ".csv") {
                extractedText = await extractTextFromCSV(file.buffer);
            } else if (fileExt === ".xlsx" || fileExt === ".xls") {
                extractedText = await extractTextFromExcel(file.buffer);
            } else if (fileExt === ".docx" || fileExt === ".doc") {
                extractedText = await extractTextFromDoc(file.buffer);
            } else {
                return res.status(400).json({ error: "Unsupported file format." });
            }

            if (!extractedText.trim()) {
                return res.json({ question, answers: ["No readable text found in the file."] });
            }
        }

        const chatGPTAnswer = await getChatGPTAnswer(extractedText, question);
        return res.json({ question, answers: [chatGPTAnswer] });

    } catch (error) {
        console.error("Error processing request:", error);
        res.status(500).json({ error: "An unexpected error occurred." });
    }
});

app.post("/ask", async (req, res) => {
    try {
        const { question } = req.body;

        if (!question) {
            return res.status(400).json({ error: "No question provided." });
        }

        const chatGPTAnswer = await getChatGPTAnswer("", question);
        return res.json({ question, answers: [chatGPTAnswer] });

    } catch (error) {
        console.error("Error processing request:", error);
        res.status(500).json({ error: "An unexpected error occurred." });
    }
});

app.get("/", (req, res) => {
    res.send("Welcome to the AI Question Answering API! Use the /api endpoint to ask with files or /ask for general questions.");
});

module.exports = app;
