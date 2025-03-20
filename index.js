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

const extractAndFindAnswer = async (zipBuffer) => {
    try {
        const zip = new AdmZip(zipBuffer);
        const zipEntries = zip.getEntries();

        // Find extract.csv inside the ZIP
        let csvFile;
        zipEntries.forEach(entry => {
            // Skip any unwanted macOS metadata files
            if (entry.entryName.startsWith('__MACOSX/')) {
                console.log("Skipping macOS metadata file:", entry.entryName);
                return;
            }

            console.log(`Checking ZIP entry: ${entry.entryName}`);
            if (entry.entryName.toLowerCase().endsWith("extract.csv")) {
                console.log("Found extract.csv in ZIP");
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

            // CSV parsing with error logging
            readableStream
                .pipe(csvParser())
                .on("data", (row) => {
                    console.log("Row data:", row);  // Log each row for debugging
                    if (row.answer) {
                        console.log("Found answer:", row.answer);  // Log if 'answer' is found
                        results.push(row.answer);
                    } else {
                        console.log("No 'answer' column in this row", row);  // Log if 'answer' column is missing
                    }
                })
                .on("end", () => {
                    if (results.length === 0) {
                        console.log("No answers found in CSV");
                    }
                    resolve(results);
                })
                .on("error", (err) => {
                    console.error("Error parsing CSV:", err);
                    reject(err);
                });
        });

    } catch (error) {
        console.error("ZIP extraction error:", error);
        return `Error processing ZIP: ${error.message}`;
    }
};

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
