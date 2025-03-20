const express = require("express");
const multer = require("multer");
const AdmZip = require("adm-zip");
const path = require("path");
const fs = require("fs");
const csvParser = require("csv-parser");

require("dotenv").config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Function to extract CSV from ZIP and find "answer" column
const extractAndFindAnswer = async (zipBuffer) => {
    try {
        const zip = new AdmZip(zipBuffer);
        const zipEntries = zip.getEntries();

        // Find extract.csv inside the ZIP
        let csvFile;
        zipEntries.forEach(entry => {
            if (entry.entryName.toLowerCase().endsWith("extract.csv")) {
                csvFile = entry.getData().toString("utf8");
            }
        });

        if (!csvFile) {
            throw new Error("extract.csv not found in ZIP.");
        }

        // Parse CSV and find "answer" column
        return new Promise((resolve, reject) => {
            const results = [];
            const readableStream = require("stream").Readable.from(csvFile);
            readableStream
                .pipe(csvParser())
                .on("data", (row) => {
                    if (row.answer) {
                        results.push(row.answer);
                    }
                })
                .on("end", () => resolve(results))
                .on("error", (err) => reject(err));
        });

    } catch (error) {
        console.error("ZIP extraction error:", error);
        return `Error processing ZIP: ${error.message}`;
    }
};

// API endpoint to process ZIP files
app.post("/api", upload.single("file"), async (req, res) => {
    try {
        console.log("Received request:", req.body);
        const { question } = req.body;
        const file = req.file;

        if (!question) {
            return res.status(400).json({ error: "Question is required." });
        }

        let answerValues = [];

        if (file) {
            if (path.extname(file.originalname) === ".zip") {
                answerValues = await extractAndFindAnswer(file.buffer);
            } else {
                return res.status(400).json({ error: "Only .zip files are supported for this operation." });
            }
        }

        res.json({ question, answers: answerValues });
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
